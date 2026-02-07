import { useEffect, useState } from "react";
import { connectSse, type ServerMessage } from "./sse-client";
import { parseKioskToolCallsData } from "./kiosk-tool-calls";
import styles from "./styles.module.css";

type Mode = "ROOM" | "PERSONAL";
type Phase =
  | "idle"
  | "listening"
  | "waiting_stt"
  | "waiting_chat"
  | "asking_consent"
  | "waiting_inner_task";

type ErrorKind = "sse";

type DebugState = {
  kioskConnected: boolean;
  staffConnected: boolean;
  mode: Mode | null;
  phase: Phase | null;
  lastErrorKind: ErrorKind | null;
  toolCallLastCount: number;
  toolCallTotalCount: number;
  toolCallMessageCount: number;
  toolNamesLast: string[];
  messageCount: number;
};

const isMode = (value: unknown): value is Mode => value === "ROOM" || value === "PERSONAL";

const isPhase = (value: unknown): value is Phase =>
  value === "idle" ||
  value === "listening" ||
  value === "waiting_stt" ||
  value === "waiting_chat" ||
  value === "asking_consent" ||
  value === "waiting_inner_task";

const parseSnapshotState = (data: unknown): { mode: Mode; phase: Phase } | null => {
  if (!data || typeof data !== "object") {
    return null;
  }
  const state = (data as { state?: unknown }).state;
  if (!state || typeof state !== "object") {
    return null;
  }
  const mode = (state as { mode?: unknown }).mode;
  const phase = (state as { phase?: unknown }).phase;
  if (!isMode(mode) || !isPhase(phase)) {
    return null;
  }
  return { mode, phase };
};

const classifyErrorKind = (message: ServerMessage): ErrorKind | null => {
  const t = message.type;
  if (t.includes("error")) {
    return "sse";
  }
  return null;
};

export const DebugPage = () => {
  const [state, setState] = useState<DebugState>({
    kioskConnected: false,
    staffConnected: false,
    mode: null,
    phase: null,
    lastErrorKind: null,
    toolCallLastCount: 0,
    toolCallTotalCount: 0,
    toolCallMessageCount: 0,
    toolNamesLast: [],
    messageCount: 0,
  });

  useEffect(() => {
    const kioskClient = connectSse("/api/v1/kiosk/stream", {
      onSnapshot: (data) => {
        const snapState = parseSnapshotState(data);
        setState((prev) => {
          const next: DebugState = {
            ...prev,
            kioskConnected: true,
          };
          if (snapState) {
            next.mode = snapState.mode;
            next.phase = snapState.phase;
          }
          return next;
        });
      },
      onMessage: (message: ServerMessage) => {
        setState((prev) => ({
          ...prev,
          messageCount: prev.messageCount + 1,
        }));

        if (message.type === "kiosk.command.tool_calls") {
          try {
            const toolCalls = parseKioskToolCallsData(message.data);
            setState((prev) => ({
              ...prev,
              toolCallLastCount: toolCalls.length,
              toolCallTotalCount: prev.toolCallTotalCount + toolCalls.length,
              toolCallMessageCount: prev.toolCallMessageCount + 1,
              toolNamesLast: toolCalls.map((tc) => tc.function.name),
            }));
          } catch {
            setState((prev) => ({
              ...prev,
              lastErrorKind: "sse",
            }));
          }
          return;
        }

        const errorKind = classifyErrorKind(message);
        if (errorKind) {
          setState((prev) => ({
            ...prev,
            lastErrorKind: errorKind,
          }));
        }
      },
      onError: () => {
        setState((prev) => ({
          ...prev,
          kioskConnected: false,
          lastErrorKind: "sse",
        }));
      },
    });

    const staffClient = connectSse("/api/v1/staff/stream", {
      onSnapshot: () => {
        setState((prev) => ({
          ...prev,
          staffConnected: true,
        }));
      },
      onMessage: (message: ServerMessage) => {
        setState((prev) => ({
          ...prev,
          messageCount: prev.messageCount + 1,
        }));

        const errorKind = classifyErrorKind(message);
        if (errorKind) {
          setState((prev) => ({
            ...prev,
            lastErrorKind: errorKind,
          }));
        }
      },
      onError: () => {
        setState((prev) => ({
          ...prev,
          staffConnected: false,
          lastErrorKind: "sse",
        }));
      },
    });

    return () => {
      kioskClient.close();
      staffClient.close();
    };
  }, []);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Debug</h1>
        <div className={styles.label}>DEV-only diagnostics</div>
      </header>

      <main className={styles.debugLayout}>
        <section className={styles.debugSection}>
          <h2 className={styles.debugSectionTitle}>Connection</h2>
          <dl className={styles.debugDl}>
            <dt>Kiosk SSE</dt>
            <dd>{state.kioskConnected ? "connected" : "disconnected"}</dd>
            <dt>Staff SSE</dt>
            <dd>{state.staffConnected ? "connected" : "disconnected"}</dd>
          </dl>
        </section>

        <section className={styles.debugSection}>
          <h2 className={styles.debugSectionTitle}>State</h2>
          <dl className={styles.debugDl}>
            <dt>Mode</dt>
            <dd>{state.mode ?? (state.kioskConnected ? "unknown" : "-")}</dd>
            <dt>Phase</dt>
            <dd>{state.phase ?? (state.kioskConnected ? "unknown" : "-")}</dd>
          </dl>
        </section>

        <section className={styles.debugSection}>
          <h2 className={styles.debugSectionTitle}>Errors</h2>
          <dl className={styles.debugDl}>
            <dt>Last error kind</dt>
            <dd>{state.lastErrorKind ?? "none"}</dd>
          </dl>
        </section>

        <section className={styles.debugSection}>
          <h2 className={styles.debugSectionTitle}>Tool Calls</h2>
          <dl className={styles.debugDl}>
            <dt>Last count</dt>
            <dd>{state.toolCallLastCount}</dd>
            <dt>Last names</dt>
            <dd>{state.toolNamesLast.length > 0 ? state.toolNamesLast.join(", ") : "-"}</dd>
            <dt>Total calls</dt>
            <dd>{state.toolCallTotalCount}</dd>
            <dt>Tool messages</dt>
            <dd>{state.toolCallMessageCount}</dd>
          </dl>
        </section>

        <section className={styles.debugSection}>
          <h2 className={styles.debugSectionTitle}>Messages</h2>
          <dl className={styles.debugDl}>
            <dt>Total received</dt>
            <dd>{state.messageCount}</dd>
          </dl>
        </section>
      </main>
    </div>
  );
};
