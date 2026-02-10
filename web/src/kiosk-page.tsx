import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { postFormData, postJson } from "./api";
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
import { DevDebugLink } from "./dev-debug-link";

const SILENT_WAV_DATA_URI =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=";

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
  const [audioError, setAudioError] = useState<string | null>(null);
  const [isAudioUnlocked, setIsAudioUnlocked] = useState(false);
  const [needsAudioUnlock, setNeedsAudioUnlock] = useState(false);
  const isAudioUnlockedRef = useRef(false);
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

  const performGestureAudioUnlock = useCallback(() => {
    // Best-effort: perform an actual unlock action in the user-gesture call stack.
    // Different browsers gate either HTMLAudioElement.play() or AudioContext.resume().
    const isJsdom =
      typeof navigator !== "undefined" && typeof navigator.userAgent === "string"
        ? navigator.userAgent.toLowerCase().includes("jsdom")
        : false;
    try {
      // Avoid creating extra Audio instances in jsdom tests (HTMLMediaElement.play is not implemented).
      if (!isJsdom && typeof Audio === "function") {
        const a = new Audio(SILENT_WAV_DATA_URI);
        a.volume = 0;
        void a
          .play()
          .then(() => {
            try {
              a.pause();
            } catch {
              // ignore
            }
          })
          .catch(() => {
            // ignore
          });
      }
    } catch {
      // ignore
    }

    try {
      const AudioContextCtor = (window as unknown as { AudioContext?: typeof AudioContext })
        .AudioContext;
      const WebkitAudioContextCtor = (
        window as unknown as { webkitAudioContext?: typeof AudioContext }
      ).webkitAudioContext;
      const Ctor = AudioContextCtor ?? WebkitAudioContextCtor;
      if (Ctor) {
        const ctx = new Ctor();
        void ctx
          .resume()
          .then(async () => {
            try {
              await ctx.close();
            } catch {
              // ignore
            }
          })
          .catch(async () => {
            try {
              await ctx.close();
            } catch {
              // ignore
            }
          });
      }
    } catch {
      // ignore
    }
  }, []);

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
    setNeedsAudioUnlock(false);
    performGestureAudioUnlock();
  }, [performGestureAudioUnlock]);

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
        if (motionId !== "idle" && motionId !== "greeting" && motionId !== "cheer") {
          return;
        }
        devMotionSeqRef.current += 1;
        setMotion({ motionId, motionInstanceId: `dev-${devMotionSeqRef.current}` });
      };
    }

    const client = connectSse("/api/v1/kiosk/stream", {
      onSnapshot: (data) => {
        setSnapshot(data as KioskSnapshot);
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
            setNeedsAudioUnlock(true);
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
          setNeedsAudioUnlock(false);
        }
      },
      onError: (error) => {
        setStreamError(error.message);
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
  }, [playTts, stopTtsAudio]);

  const mode = snapshot?.state.mode ?? null;
  const personalName = snapshot?.state.personal_name ?? null;
  const phase = snapshot?.state.phase ?? null;
  const isConsentVisible = snapshot?.state.consent_ui_visible ?? false;
  const shouldShowRecording = isRecording || phase === "listening";

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

  const modeText =
    mode === "PERSONAL" ? `PERSONAL${personalName ? ` (${personalName})` : ""}` : "ROOM";

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
    if (/^https?:\/\//i.test(stageBgEnv)) {
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
        <DevDebugLink isDev={import.meta.env.DEV as boolean} />
      </header>

      <main className={styles.kioskLayout}>
        <section className={styles.kioskStage} aria-label="Mascot stage" style={stageStyle}>
          <VrmAvatar
            vrmUrl={vrmUrl}
            expression={vrmExpression}
            mouthOpen={mouthOpen}
            motion={motion}
          />
        </section>

        <section className={styles.kioskOverlay} aria-label="Kiosk overlay">
          <div className={styles.kioskStatusRow}>
            <div className={styles.kioskBadge}>Mode: {modeText}</div>
            <div className={styles.kioskBadge}>Phase: {phase ?? "-"}</div>
          </div>

          {!isAudioUnlocked || needsAudioUnlock ? (
            <div className={styles.audioUnlockPill} aria-live="polite">
              おとをだすには 1かい タップしてね
            </div>
          ) : null}

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

          {streamError ? (
            <div className={styles.errorText} role="alert">
              {toKidFriendlyError("stream", streamError)}
            </div>
          ) : null}
          {audioError ? (
            <div className={styles.errorText} role="alert">
              {toKidFriendlyError("audio", audioError)}
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
            setNeedsAudioUnlock(true);
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
