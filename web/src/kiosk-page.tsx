import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { postFormData, postJson, postJsonWithTimeout } from "./api";
import { convertRecordingBlobToWavFile } from "./kiosk-audio";
import { startPttSession, type PttSession } from "./kiosk-ptt";
import { connectSse, type ServerMessage } from "./sse-client";
import { AudioPlayer, AUDIO_ERROR_PLAY_BLOCKED } from "./components/audio-player";
import { VrmAvatar, type ExpressionLabel } from "./components/vrm-avatar";
import { parseExpressionLabel } from "./kiosk-expression";
import {
  parseKioskPlayMotionData,
  type MotionId,
  type PlayMotionCommand,
} from "./kiosk-play-motion";
import { parseKioskToolCallsData, type ToolCallLite } from "./kiosk-tool-calls";
import styles from "./styles.module.css";
import { performGestureAudioUnlock } from "./audio-unlock";

const INTERACTIVE_TAGS = new Set(["input", "textarea", "select", "button", "a"]);

const KIOSK_PTT_EVENT_TIMEOUT_MS = 3_000;

const isInteractiveElement = (el: Element | null): boolean => {
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (INTERACTIVE_TAGS.has(tag)) return true;
  if (el.getAttribute("role") === "button") return true;
  const ce = el.getAttribute("contenteditable");
  if (ce !== null && ce !== "false") return true;
  return false;
};

const toKidFriendlyError = (prefix: "stream" | "audio", _raw: string): string => {
  if (prefix === "stream") {
    return "つながらないよ… もういちどためしてね";
  }
  return "おとがでないみたい… すこしまってね";
};

type Mode = "ROOM" | "PERSONAL";
type Phase =
  | "idle"
  | "listening"
  | "waiting_stt"
  | "waiting_chat"
  | "asking_consent"
  | "waiting_inner_task";

type KioskSnapshot = {
  state: {
    mode: Mode;
    personal_name: string | null;
    phase: Phase;
    consent_ui_visible: boolean;
  };
};

type SpeakState = {
  sayId: string;
  text: string;
  expression: ExpressionLabel;
};

const isSpeakData = (
  data: unknown,
): data is { say_id: string; text: string; expression?: unknown } => {
  if (!data || typeof data !== "object") {
    return false;
  }
  const record = data as Record<string, unknown>;
  return typeof record.say_id === "string" && typeof record.text === "string";
};

const isRecordStopData = (data: unknown): data is { stt_request_id: string } => {
  if (!data || typeof data !== "object") {
    return false;
  }
  const record = data as Record<string, unknown>;
  return typeof record.stt_request_id === "string";
};

export const KioskPage = () => {
  const [snapshot, setSnapshot] = useState<KioskSnapshot | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [speech, setSpeech] = useState<SpeakState | null>(null);
  const [toolCallsCount, setToolCallsCount] = useState(0);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [streamConnection, setStreamConnection] = useState<"connected" | "reconnecting">(
    "connected",
  );
  const [audioError, setAudioError] = useState<string | null>(null);
  const [isAudioUnlocked, setIsAudioUnlocked] = useState(false);
  const [isAudioUnlockNeeded, setIsAudioUnlockNeeded] = useState(false);
  const isAudioUnlockedRef = useRef(false);

  const [pttError, setPttError] = useState<string | null>(null);
  const [isKioskPttDown, setIsKioskPttDown] = useState(false);
  const [isKioskPttButtonHeld, setIsKioskPttButtonHeld] = useState(false);
  const isMountedRef = useRef(false);
  const isKioskPttSpaceHeldRef = useRef(false);
  const isKioskPttButtonHeldRef = useRef(false);
  const isKioskPttDownRef = useRef(false);
  const isKioskPttStateUncertainRef = useRef(false);
  const isStreamConnectedRef = useRef(true);
  const isKioskPttSendingRef = useRef(false);
  const kioskPttInFlightPromiseRef = useRef<Promise<boolean> | null>(null);
  const kioskPttRetryTimeoutIdRef = useRef<number | null>(null);
  const [ttsWav, setTtsWav] = useState<ArrayBuffer | null>(null);
  const [ttsPlayId, setTtsPlayId] = useState(0);
  const ttsPlayIdRef = useRef(0);
  const [mouthOpen, setMouthOpen] = useState(0);
  const [motion, setMotion] = useState<PlayMotionCommand | null>(() => ({
    motionId: "idle",
    motionInstanceId: "boot-1",
  }));
  const lastPlayedMotionInstanceIdRef = useRef<string | null>(null);
  const devMotionSeqRef = useRef(0);
  const pttSessionRef = useRef<PttSession | null>(null);
  const pttStartRef = useRef<Promise<PttSession> | null>(null);
  const ttsGenerationRef = useRef(0);
  const lastPlayedSayIdRef = useRef<string | null>(null);
  const toolCallsRef = useRef<ToolCallLite[]>([]);
  const pendingTtsTextRef = useRef<string | null>(null);
  const pendingSayIdRef = useRef<string | null>(null);
  const lastSpokenTextRef = useRef<string | null>(null);
  const lastSpokenSayIdRef = useRef<string | null>(null);

  const sendKioskEvent = useCallback(async (type: "KIOSK_PTT_DOWN" | "KIOSK_PTT_UP") => {
    try {
      const res = await postJsonWithTimeout(
        "/api/v1/kiosk/event",
        { type },
        KIOSK_PTT_EVENT_TIMEOUT_MS,
      );
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  const flushKioskPtt = useCallback(() => {
    if (!isMountedRef.current) {
      return;
    }
    if (isKioskPttSendingRef.current) {
      return;
    }
    const shouldBeDown = isKioskPttSpaceHeldRef.current || isKioskPttButtonHeldRef.current;
    const shouldSendPttUpWhileDisconnected =
      !shouldBeDown && (isKioskPttDownRef.current || isKioskPttStateUncertainRef.current);
    if (!isStreamConnectedRef.current && !shouldSendPttUpWhileDisconnected) {
      return;
    }
    if (isKioskPttDownRef.current === shouldBeDown && !isKioskPttStateUncertainRef.current) {
      return;
    }

    const type: "KIOSK_PTT_DOWN" | "KIOSK_PTT_UP" = shouldBeDown
      ? "KIOSK_PTT_DOWN"
      : "KIOSK_PTT_UP";
    isKioskPttSendingRef.current = true;
    let didSucceed = false;
    const sendPromise = sendKioskEvent(type);
    kioskPttInFlightPromiseRef.current = sendPromise;
    void sendPromise
      .then((isOk) => {
        if (!isMountedRef.current) {
          return;
        }
        if (!isOk) {
          setPttError("Network error");
          isKioskPttStateUncertainRef.current = true;
          // Treat DOWN/UP failures as "state unknown" and retry to converge.
          // Duplicate DOWN is safe (server ignores if already listening).
          if (kioskPttRetryTimeoutIdRef.current === null) {
            kioskPttRetryTimeoutIdRef.current = window.setTimeout(() => {
              kioskPttRetryTimeoutIdRef.current = null;
              if (isMountedRef.current) {
                flushKioskPtt();
              }
            }, 250);
          }
          return;
        }

        didSucceed = true;
        setPttError(null);
        isKioskPttStateUncertainRef.current = false;
        isKioskPttDownRef.current = shouldBeDown;
        setIsKioskPttDown(shouldBeDown);
      })
      .finally(() => {
        if (kioskPttInFlightPromiseRef.current === sendPromise) {
          kioskPttInFlightPromiseRef.current = null;
        }
        isKioskPttSendingRef.current = false;

        // If the desired state changed while sending (e.g. quick press+release), flush once more.
        if (didSucceed && isMountedRef.current) {
          flushKioskPtt();
        }
      });
  }, [sendKioskEvent]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      const timeoutId = kioskPttRetryTimeoutIdRef.current;
      kioskPttRetryTimeoutIdRef.current = null;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }

      const inFlight = kioskPttInFlightPromiseRef.current;
      const isPttPossiblyDown =
        isKioskPttSpaceHeldRef.current ||
        isKioskPttButtonHeldRef.current ||
        isKioskPttDownRef.current ||
        isKioskPttStateUncertainRef.current;
      const shouldSendFinalPttUpOnUnmount = isPttPossiblyDown || inFlight !== null;
      if (shouldSendFinalPttUpOnUnmount) {
        if (inFlight) {
          void inFlight.finally(() => {
            void sendKioskEvent("KIOSK_PTT_UP");
          });
        } else {
          void sendKioskEvent("KIOSK_PTT_UP");
        }
      }

      flushKioskPtt();
    };
  }, [flushKioskPtt, sendKioskEvent]);

  const stopTtsAudio = useCallback(() => {
    ttsGenerationRef.current += 1;
    setTtsWav(null);
    setMouthOpen(0);
  }, []);

  const playTts = useCallback(
    async (text: string) => {
      stopTtsAudio();
      const generation = ttsGenerationRef.current;
      try {
        const res = await postJson("/api/v1/kiosk/tts", { text });
        if (!res.ok) {
          if (ttsGenerationRef.current !== generation) {
            return;
          }
          setAudioError(`HTTP ${res.status}`);
          return;
        }

        if (ttsGenerationRef.current !== generation) {
          return;
        }

        const wav = await res.arrayBuffer();

        if (ttsGenerationRef.current !== generation) {
          return;
        }

        ttsPlayIdRef.current = generation;
        setTtsPlayId(generation);
        setTtsWav(wav);
      } catch {
        if (ttsGenerationRef.current !== generation) {
          return;
        }
        stopTtsAudio();
        setAudioError("Network error");
      }
    },
    [stopTtsAudio],
  );

  const unlockAudio = useCallback(() => {
    if (isAudioUnlockedRef.current) {
      return;
    }
    isAudioUnlockedRef.current = true;
    setIsAudioUnlocked(true);
    setIsAudioUnlockNeeded(false);
    performGestureAudioUnlock();
  }, []);

  useEffect(() => {
    const isSpaceKey = (e: KeyboardEvent) => e.code === "Space" || e.key === " ";

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isSpaceKey(e)) return;
      if (!isStreamConnectedRef.current) return;

      const el = document.activeElement as HTMLElement | null;
      if (isInteractiveElement(el)) return;

      if (e.repeat) {
        if (isKioskPttSpaceHeldRef.current) e.preventDefault();
        return;
      }

      if (!isKioskPttSpaceHeldRef.current) {
        e.preventDefault();
        isKioskPttSpaceHeldRef.current = true;
        flushKioskPtt();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!isSpaceKey(e)) return;
      if (!isKioskPttSpaceHeldRef.current) return;
      e.preventDefault();
      isKioskPttSpaceHeldRef.current = false;
      flushKioskPtt();
    };

    const handleBlurOrVisibility = () => {
      if (!isKioskPttSpaceHeldRef.current && !isKioskPttButtonHeldRef.current) {
        return;
      }
      isKioskPttSpaceHeldRef.current = false;
      isKioskPttButtonHeldRef.current = false;
      setIsKioskPttButtonHeld(false);
      flushKioskPtt();
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlurOrVisibility);
    document.addEventListener("visibilitychange", handleBlurOrVisibility);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlurOrVisibility);
      document.removeEventListener("visibilitychange", handleBlurOrVisibility);
    };
  }, [flushKioskPtt]);

  useEffect(() => {
    if (isAudioUnlocked) {
      return;
    }

    const handleUnlock = () => {
      unlockAudio();
    };

    window.addEventListener("pointerdown", handleUnlock, { passive: true });
    window.addEventListener("click", handleUnlock, { passive: true });
    window.addEventListener("touchstart", handleUnlock, { passive: true });
    window.addEventListener("keydown", handleUnlock);
    return () => {
      window.removeEventListener("pointerdown", handleUnlock);
      window.removeEventListener("click", handleUnlock);
      window.removeEventListener("touchstart", handleUnlock);
      window.removeEventListener("keydown", handleUnlock);
    };
  }, [isAudioUnlocked, unlockAudio]);

  useEffect(() => {
    if (!isAudioUnlocked) {
      return;
    }
    const pending = pendingTtsTextRef.current;
    if (!pending) {
      return;
    }

    const pendingSayId = pendingSayIdRef.current;
    if (pendingSayId) {
      lastPlayedSayIdRef.current = pendingSayId;
    }
    pendingTtsTextRef.current = null;
    pendingSayIdRef.current = null;
    void playTts(pending);
  }, [isAudioUnlocked, playTts]);

  useEffect(() => {
    const ignoreStopError = (_err: unknown) => undefined;

    if (import.meta.env.DEV) {
      const w = window as Window & {
        __wfPlayMotion?: (motionId: MotionId) => void;
      };
      w.__wfPlayMotion = (motionId) => {
        if (
          motionId !== "idle" &&
          motionId !== "greeting" &&
          motionId !== "cheer" &&
          motionId !== "thinking"
        ) {
          return;
        }
        devMotionSeqRef.current += 1;
        setMotion({ motionId, motionInstanceId: `dev-${devMotionSeqRef.current}` });
      };
    }

    const client = connectSse("/api/v1/kiosk/stream", {
      onSnapshot: (data) => {
        setSnapshot(data as KioskSnapshot);
        if (!isStreamConnectedRef.current) {
          isStreamConnectedRef.current = true;
          setStreamConnection("connected");
        }
        setStreamError(null);
        flushKioskPtt();
      },
      onMessage: (message: ServerMessage) => {
        if (message.type === "kiosk.command.record_start") {
          setAudioError(null);
          setIsRecording(true);
          if (pttSessionRef.current || pttStartRef.current) {
            return;
          }
          const startPromise = startPttSession();
          pttStartRef.current = startPromise;
          void startPromise
            .then((session) => {
              if (pttStartRef.current !== startPromise) {
                return;
              }
              pttSessionRef.current = session;
            })
            .catch((err: unknown) => {
              if (pttStartRef.current !== startPromise) {
                return;
              }
              setAudioError(err instanceof Error ? err.message : "Failed to start recording");
              setIsRecording(false);
              pttSessionRef.current = null;
            })
            .finally(() => {
              if (pttStartRef.current === startPromise) {
                pttStartRef.current = null;
              }
            });
          return;
        }

        if (message.type === "kiosk.command.record_stop") {
          const data = message.data;
          if (!isRecordStopData(data)) {
            setAudioError("Invalid record_stop message");
            setIsRecording(false);

            const session = pttSessionRef.current;
            const startPromise = pttStartRef.current;
            pttSessionRef.current = null;
            pttStartRef.current = null;
            const sessionPromise = session ? Promise.resolve(session) : startPromise;
            if (sessionPromise) {
              void sessionPromise.then((s) => s.stop()).catch(ignoreStopError);
            }
            return;
          }

          setIsRecording(false);
          const session = pttSessionRef.current;
          const startPromise = pttStartRef.current;
          pttSessionRef.current = null;
          pttStartRef.current = null;
          const sessionPromise = session ? Promise.resolve(session) : startPromise;
          if (!sessionPromise) {
            setAudioError("Not recording");
            return;
          }

          const sttRequestId = data.stt_request_id;
          void sessionPromise
            .then((s) => s.stop())
            .then(async (blob: Blob) => {
              const file = await convertRecordingBlobToWavFile({
                blob,
                fileName: `${sttRequestId}.wav`,
              });

              const form = new FormData();
              form.append("stt_request_id", sttRequestId);
              form.append("audio", file);

              const res = await postFormData("/api/v1/kiosk/stt-audio", form);
              if (!res.ok) {
                setAudioError(`HTTP ${res.status}`);
              }
            })
            .catch((err: unknown) => {
              setAudioError(err instanceof Error ? err.message : "Failed to upload audio");
            });
          return;
        }

        if (message.type === "kiosk.command.speak") {
          const data = message.data;
          if (!isSpeakData(data)) {
            return;
          }
          const sayId = data.say_id;
          const text = data.text;
          const expression = parseExpressionLabel((data as Record<string, unknown>).expression);
          lastSpokenSayIdRef.current = sayId;
          lastSpokenTextRef.current = text;
          setSpeech((prev: SpeakState | null) => {
            if (
              prev &&
              prev.sayId === sayId &&
              prev.text === text &&
              prev.expression === expression
            ) {
              return prev;
            }
            return { sayId, text, expression };
          });

          setAudioError(null);

          if (!isAudioUnlockedRef.current) {
            if (pendingSayIdRef.current === sayId) {
              return;
            }
            pendingTtsTextRef.current = text;
            pendingSayIdRef.current = sayId;
            setIsAudioUnlockNeeded(true);
            return;
          }

          if (lastPlayedSayIdRef.current === sayId) {
            return;
          }
          lastPlayedSayIdRef.current = sayId;

          void playTts(text);
          return;
        }

        if (message.type === "kiosk.command.tool_calls") {
          const toolCalls = parseKioskToolCallsData(message.data);
          toolCallsRef.current = toolCalls;
          setToolCallsCount(toolCalls.length);
          return;
        }

        if (message.type === "kiosk.command.play_motion") {
          const parsed = parseKioskPlayMotionData(message.data);
          if (!parsed) {
            return;
          }
          if (lastPlayedMotionInstanceIdRef.current === parsed.motionInstanceId) {
            return;
          }
          lastPlayedMotionInstanceIdRef.current = parsed.motionInstanceId;
          setMotion(parsed);
          return;
        }

        if (message.type === "kiosk.command.stop_output") {
          setSpeech(null);
          stopTtsAudio();
          setAudioError(null);
          pendingTtsTextRef.current = null;
          pendingSayIdRef.current = null;
          setIsAudioUnlockNeeded(false);
        }
      },
      onError: (error) => {
        setStreamError(error.message);
        isStreamConnectedRef.current = false;
        setStreamConnection("reconnecting");

        const isPossiblyDown =
          isKioskPttSpaceHeldRef.current ||
          isKioskPttButtonHeldRef.current ||
          isKioskPttDownRef.current ||
          isKioskPttStateUncertainRef.current;

        if (isPossiblyDown) {
          isKioskPttStateUncertainRef.current = true;
        }
        isKioskPttSpaceHeldRef.current = false;
        isKioskPttButtonHeldRef.current = false;
        isKioskPttDownRef.current = false;
        setIsKioskPttButtonHeld(false);
        setIsKioskPttDown(false);
        flushKioskPtt();
      },
    });

    return () => {
      if (import.meta.env.DEV) {
        const w = window as Window & {
          __wfPlayMotion?: (motionId: MotionId) => void;
        };
        delete w.__wfPlayMotion;
      }
      const session = pttSessionRef.current;
      const startPromise = pttStartRef.current;
      pttSessionRef.current = null;
      pttStartRef.current = null;
      const sessionPromise = session ? Promise.resolve(session) : startPromise;
      if (sessionPromise) {
        void sessionPromise.then((s) => s.stop()).catch(ignoreStopError);
      }
      stopTtsAudio();
      client.close();
    };
  }, [flushKioskPtt, playTts, stopTtsAudio]);

  const phase = snapshot?.state.phase ?? null;
  const isConsentVisible = snapshot?.state.consent_ui_visible ?? false;
  const shouldShowRecording = isRecording || phase === "listening";
  const isStreamConnected = streamConnection === "connected";
  const isPttAvailable = isStreamConnected;
  const isLocalPttActive = isPttAvailable && (isKioskPttDown || isKioskPttButtonHeld);
  const hasKioskErrors = Boolean(streamError || pttError || audioError);
  const pttButtonLabel = !isPttAvailable
    ? "つながるまで まってね"
    : isLocalPttActive
      ? "はなして とめる"
      : "おして はなす";

  const sendConsent = async (answer: "yes" | "no") => {
    setConsentError(null);
    try {
      const res = await postJson("/api/v1/kiosk/event", { type: "UI_CONSENT_BUTTON", answer });
      if (!res.ok) {
        setConsentError(`HTTP ${res.status}`);
      }
    } catch {
      setConsentError("Network error");
    }
  };

  const vrmExpression: ExpressionLabel = speech?.expression ?? "neutral";
  const vrmUrl = import.meta.env.VITE_VRM_URL ?? "/assets/vrm/mascot.vrm";

  const stageBgEnv = import.meta.env.VITE_KIOSK_STAGE_BG_URL as string | undefined;
  const defaultStageBgUrl = "/assets/stage-bg/kenney-uncolored-hills.png";
  const stageBgUrl = (() => {
    if (stageBgEnv === "") {
      return null;
    }
    if (!stageBgEnv) {
      return defaultStageBgUrl;
    }
    // Avoid runtime loading of external assets; keep the kiosk self-contained.
    if (/^https?:\/\//i.test(stageBgEnv) || /^\/\//.test(stageBgEnv)) {
      return defaultStageBgUrl;
    }
    return stageBgEnv;
  })();
  const stageStyle = {
    "--wf-kiosk-stage-bg": stageBgUrl ? `url(${JSON.stringify(stageBgUrl)})` : "none",
  } as CSSProperties;

  const consentDialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isConsentVisible) {
      return;
    }
    consentDialogRef.current?.querySelector("button")?.focus();
  }, [isConsentVisible]);

  const handleConsentKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab") {
      return;
    }
    const focusable = e.currentTarget.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  return (
    <div className={styles.page} data-wf-tool-calls-count={toolCallsCount}>
      <header className={styles.header}>
        <h1>KIOSK</h1>
      </header>

      <main className={styles.kioskLayout}>
        <div className={styles.kioskStageFrame}>
          <section className={styles.kioskStage} aria-label="Mascot stage" style={stageStyle}>
            <VrmAvatar
              vrmUrl={vrmUrl}
              expression={vrmExpression}
              mouthOpen={mouthOpen}
              motion={motion}
            />
          </section>

          <section className={styles.kioskOverlay} aria-label="Kiosk overlay">
            {shouldShowRecording ? (
              <div className={styles.recordingPill} aria-live="polite">
                <span className={styles.recordingDot} aria-hidden="true" />
                きいてるよ
              </div>
            ) : null}

            {speech ? (
              <div className={styles.speechBubble}>
                <div className={styles.speechText}>{speech.text}</div>
              </div>
            ) : null}
          </section>
        </div>

        <section className={styles.kioskControls} aria-label="Kiosk controls">
          {!isAudioUnlocked || isAudioUnlockNeeded || !isPttAvailable ? (
            <div className={styles.kioskNoticeStack}>
              {!isAudioUnlocked || isAudioUnlockNeeded ? (
                <div className={styles.audioUnlockPill} aria-live="polite">
                  おとをだすには 1かい タップしてね
                </div>
              ) : null}

              {!isPttAvailable ? (
                <div className={styles.connectionPill} role="status" aria-live="polite">
                  つながるまで ちょっとまってね
                </div>
              ) : null}
            </div>
          ) : null}

          <button
            type="button"
            className={
              !isPttAvailable
                ? styles.kioskPttButtonDisabled
                : isLocalPttActive
                  ? styles.kioskPttButtonActive
                  : styles.kioskPttButton
            }
            disabled={!isPttAvailable}
            aria-pressed={isLocalPttActive}
            onPointerDown={() => {
              if (!isPttAvailable) {
                return;
              }
              isKioskPttButtonHeldRef.current = true;
              setIsKioskPttButtonHeld(true);
              flushKioskPtt();
            }}
            onPointerUp={() => {
              isKioskPttButtonHeldRef.current = false;
              setIsKioskPttButtonHeld(false);
              flushKioskPtt();
            }}
            onPointerCancel={() => {
              isKioskPttButtonHeldRef.current = false;
              setIsKioskPttButtonHeld(false);
              flushKioskPtt();
            }}
            onPointerLeave={() => {
              isKioskPttButtonHeldRef.current = false;
              setIsKioskPttButtonHeld(false);
              flushKioskPtt();
            }}
          >
            {pttButtonLabel}
          </button>

          {isPttAvailable ? (
            <div className={styles.kioskPttHint} aria-live="polite">
              {isLocalPttActive ? "はなすと そうしんするよ" : "ながおしで おはなししてね"}
            </div>
          ) : null}

          {hasKioskErrors ? (
            <div className={styles.kioskErrorStack}>
              {streamError ? (
                <div className={styles.errorText} role="alert">
                  {toKidFriendlyError("stream", streamError)}
                </div>
              ) : null}
              {pttError ? (
                <div className={styles.errorText} role="alert">
                  {toKidFriendlyError("stream", pttError)}
                </div>
              ) : null}
              {audioError ? (
                <div className={styles.errorText} role="alert">
                  {toKidFriendlyError("audio", audioError)}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        {isConsentVisible ? (
          <div className={styles.modalBackdrop}>
            <div
              ref={consentDialogRef}
              className={styles.modal}
              role="dialog"
              aria-label="Consent"
              onKeyDown={handleConsentKeyDown}
            >
              <div className={styles.modalTitle}>覚えていい？</div>
              <div className={styles.modalActions}>
                <button
                  type="button"
                  className={styles.kioskConsentYes}
                  onClick={() => void sendConsent("yes")}
                >
                  <span aria-hidden="true">⭕ </span>
                  おぼえて！
                </button>
                <button
                  type="button"
                  className={styles.kioskConsentNo}
                  onClick={() => void sendConsent("no")}
                >
                  <span aria-hidden="true">❌ </span>
                  やめておく
                </button>
              </div>
              {consentError ? (
                <div className={styles.errorText}>Failed to send: {consentError}</div>
              ) : null}
            </div>
          </div>
        ) : null}
      </main>

      <AudioPlayer
        wav={ttsWav}
        playId={ttsPlayId}
        onLevel={(playId, level) => {
          if (ttsPlayIdRef.current !== playId) {
            return;
          }
          setMouthOpen(level);
        }}
        onEnded={(playId) => {
          if (ttsPlayIdRef.current !== playId) {
            return;
          }
          setMouthOpen(0);
          setTtsWav(null);
        }}
        onError={(playId, message) => {
          if (ttsPlayIdRef.current !== playId) {
            return;
          }
          if (message === AUDIO_ERROR_PLAY_BLOCKED) {
            const pending = lastSpokenTextRef.current;
            const pendingSayId = lastSpokenSayIdRef.current;
            if (pending) {
              pendingTtsTextRef.current = pending;
              pendingSayIdRef.current = pendingSayId;
            }
            setMouthOpen(0);
            setTtsWav(null);
            isAudioUnlockedRef.current = false;
            setIsAudioUnlocked(false);
            setIsAudioUnlockNeeded(true);
            return;
          }

          setMouthOpen(0);
          setTtsWav(null);
          setAudioError(message);
        }}
      />
    </div>
  );
};
