import { useEffect, useState } from "react";
import { postJson } from "./api";
import { connectSse, type ServerMessage } from "./sse-client";
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
};

const isSpeakData = (data: unknown): data is { say_id: string; text: string } => {
  if (!data || typeof data !== "object") {
    return false;
  }
  const record = data as Record<string, unknown>;
  return typeof record.say_id === "string" && typeof record.text === "string";
};

export const KioskPage = () => {
  const [snapshot, setSnapshot] = useState<KioskSnapshot | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [speech, setSpeech] = useState<SpeakState | null>(null);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);

  useEffect(() => {
    const client = connectSse("/api/v1/kiosk/stream", {
      onSnapshot: (data) => {
        setSnapshot(data as KioskSnapshot);
      },
      onMessage: (message: ServerMessage) => {
        if (message.type === "kiosk.command.record_start") {
          setIsRecording(true);
          return;
        }

        if (message.type === "kiosk.command.record_stop") {
          setIsRecording(false);
          return;
        }

        if (message.type === "kiosk.command.speak") {
          const data = message.data;
          if (!isSpeakData(data)) {
            return;
          }
          const sayId = data.say_id;
          const text = data.text;
          setSpeech((prev) => {
            if (prev && prev.sayId === sayId) {
              return prev;
            }
            return { sayId, text };
          });
          return;
        }

        if (message.type === "kiosk.command.stop_output") {
          setSpeech(null);
        }
      },
      onError: (error) => {
        setStreamError(error.message);
      }
    });

    return () => {
      client.close();
    };
  }, []);

  const mode = snapshot?.state.mode ?? null;
  const personalName = snapshot?.state.personal_name ?? null;
  const phase = snapshot?.state.phase ?? null;
  const consentVisible = snapshot?.state.consent_ui_visible ?? false;
  const showRecording = isRecording || phase === "listening";

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

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>KIOSK</h1>
        <div className={styles.label}>Stream: /api/v1/kiosk/stream</div>
      </header>

      <main className={styles.kioskLayout}>
        <section className={styles.kioskStage} aria-label="Mascot stage">
          <div className={styles.kioskStagePlaceholder}>
            <div className={styles.kioskStageTitle}>Mascot Stage</div>
            <div className={styles.kioskStageHint}>Model (2D/3D) will be rendered here.</div>
          </div>
        </section>

        <section className={styles.kioskOverlay} aria-label="Kiosk overlay">
          <div className={styles.kioskStatusRow}>
            <div className={styles.kioskBadge}>Mode: {modeText}</div>
            <div className={styles.kioskBadge}>Phase: {phase ?? "-"}</div>
          </div>

          {showRecording ? <div className={styles.recordingPill}>Recording</div> : null}

          {speech ? (
            <div className={styles.speechBubble}>
              <div className={styles.speechText}>{speech.text}</div>
            </div>
          ) : null}

          {streamError ? <div className={styles.errorText}>SSE error: {streamError}</div> : null}
        </section>

        {consentVisible ? (
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
    </div>
  );
};
