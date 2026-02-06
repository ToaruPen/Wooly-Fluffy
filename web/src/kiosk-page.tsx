import { useCallback, useEffect, useRef, useState } from "react";
import { postFormData, postJson } from "./api";
import { convertRecordingBlobToWavFile } from "./kiosk-audio";
import { startPttSession, type PttSession } from "./kiosk-ptt";
import { connectSse, type ServerMessage } from "./sse-client";
import { AudioPlayer } from "./components/audio-player";
import { VrmAvatar, type ExpressionLabel } from "./components/vrm-avatar";
import { parseExpressionLabel } from "./kiosk-expression";
import {
  parseKioskPlayMotionData,
  type MotionId,
  type PlayMotionCommand,
} from "./kiosk-play-motion";
import { parseKioskToolCallsData, type ToolCallLite } from "./kiosk-tool-calls";
import styles from "./styles.module.css";

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
  const [ttsWav, setTtsWav] = useState<ArrayBuffer | null>(null);
  const [ttsPlayId, setTtsPlayId] = useState(0);
  const ttsPlayIdRef = useRef(0);
  const [mouthOpen, setMouthOpen] = useState(0);
  const [motion, setMotion] = useState<PlayMotionCommand | null>(null);
  const lastPlayedMotionInstanceIdRef = useRef<string | null>(null);
  const devMotionSeqRef = useRef(0);
  const pttSessionRef = useRef<PttSession | null>(null);
  const pttStartRef = useRef<Promise<PttSession> | null>(null);
  const ttsGenerationRef = useRef(0);
  const lastPlayedSayIdRef = useRef<string | null>(null);
  const toolCallsRef = useRef<ToolCallLite[]>([]);

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

          if (lastPlayedSayIdRef.current === sayId) {
            return;
          }
          lastPlayedSayIdRef.current = sayId;

          setAudioError(null);
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

  return (
    <div className={styles.page} data-wf-tool-calls-count={toolCallsCount}>
      <header className={styles.header}>
        <h1>KIOSK</h1>
        <div className={styles.label}>Stream: /api/v1/kiosk/stream</div>
        <div className={styles.label}>TTS: VOICEVOX / 四国めたん</div>
      </header>

      <main className={styles.kioskLayout}>
        <section className={styles.kioskStage} aria-label="Mascot stage">
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

          {shouldShowRecording ? <div className={styles.recordingPill}>Recording</div> : null}

          {speech ? (
            <div className={styles.speechBubble}>
              <div className={styles.speechText}>{speech.text}</div>
            </div>
          ) : null}

          {streamError ? <div className={styles.errorText}>SSE error: {streamError}</div> : null}
          {audioError ? <div className={styles.errorText}>Audio error: {audioError}</div> : null}
        </section>

        {isConsentVisible ? (
          <div className={styles.modalBackdrop}>
            <div className={styles.modal} role="dialog" aria-label="Consent">
              <div className={styles.modalTitle}>覚えていい？</div>
              <div className={styles.modalActions}>
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={() => void sendConsent("yes")}
                >
                  はい
                </button>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => void sendConsent("no")}
                >
                  いいえ
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
          setMouthOpen(0);
          setTtsWav(null);
          setAudioError(message);
        }}
      />
    </div>
  );
};
