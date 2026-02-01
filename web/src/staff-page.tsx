import { useCallback, useEffect, useRef, useState } from "react";
import { getJson, postEmpty, postJson, readJson } from "./api";
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

type StaffSnapshot = {
  state: {
    mode: Mode;
    personal_name: string | null;
    phase: Phase;
  };
  pending: {
    count: number;
  };
};

type PendingItem = {
  id: string;
  personal_name: string;
  kind: "likes" | "food" | "play" | "hobby";
  value: string;
  source_quote?: string;
  status: "pending" | "confirmed" | "rejected" | "deleted";
  created_at_ms: number;
  expires_at_ms: number | null;
};

type StaffView = "logged_out" | "locked" | "logged_in";

const INACTIVITY_LOCK_MS = 180_000;
const KEEPALIVE_INTERVAL_MS = 30_000;

const isPendingListData = (data: unknown): data is { items: PendingItem[] } => {
  if (!data || typeof data !== "object") {
    return false;
  }
  const record = data as Record<string, unknown>;
  return Array.isArray(record.items);
};

export const StaffPage = () => {
  const [view, setView] = useState<StaffView>("logged_out");
  const [passcode, setPasscode] = useState("");

  const [snapshot, setSnapshot] = useState<StaffSnapshot | null>(null);
  const [pendingItems, setPendingItems] = useState<PendingItem[]>([]);

  const [authError, setAuthError] = useState<string | null>(null);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pttHeld, setPttHeld] = useState(false);
  const [lastActivityAtMs, setLastActivityAtMs] = useState(() => Date.now());

  const pttHeldRef = useRef(false);

  const activitySeqRef = useRef(0);
  const keepaliveSeqRef = useRef(0);

  const markActivity = useCallback(() => {
    activitySeqRef.current += 1;
    setLastActivityAtMs(Date.now());
  }, []);

  const setPttHeldSafe = (next: boolean) => {
    pttHeldRef.current = next;
    setPttHeld(next);
  };

  const releasePtt = () => {
    if (!pttHeldRef.current) {
      return;
    }
    markActivity();
    setPttHeldSafe(false);
    void sendStaffEvent("STAFF_PTT_UP");
  };

  const refreshPending = async () => {
    setPendingError(null);
    try {
      const res = await getJson("/api/v1/staff/pending");
      if (res.status === 401) {
        setView("locked");
        return;
      }
      if (!res.ok) {
        setPendingError(`HTTP ${res.status}`);
        return;
      }
      const body = await readJson<{ items: PendingItem[] }>(res);
      setPendingItems(body.items);
    } catch {
      setPendingError("Network error");
    }
  };

  const sendStaffEvent = async (
    type:
      | "STAFF_PTT_DOWN"
      | "STAFF_PTT_UP"
      | "STAFF_FORCE_ROOM"
      | "STAFF_EMERGENCY_STOP"
      | "STAFF_RESUME"
  ) => {
    setActionError(null);
    try {
      const res = await postJson("/api/v1/staff/event", { type });
      if (res.status === 401) {
        setView("locked");
        return;
      }
      if (!res.ok) {
        setActionError(`HTTP ${res.status}`);
      }
    } catch {
      setActionError("Network error");
    }
  };

  const mutatePending = async (id: string, action: "confirm" | "deny") => {
    setActionError(null);
    try {
      const res = await postEmpty(`/api/v1/staff/pending/${id}/${action}`);
      if (res.status === 401) {
        setView("locked");
        return;
      }
      if (!res.ok) {
        setActionError(`HTTP ${res.status}`);
        return;
      }
      await refreshPending();
    } catch {
      setActionError("Network error");
    }
  };

  const submitLogin = async () => {
    setAuthError(null);
    setActionError(null);
    try {
      const res = await postJson("/api/v1/staff/auth/login", { passcode });
      if (!res.ok) {
        setAuthError(res.status === 401 ? "Unauthorized" : `HTTP ${res.status}`);
        return;
      }
      setView("logged_in");
      setPasscode("");
      setSnapshot(null);
      setPendingItems([]);
      markActivity();
      await refreshPending();
    } catch {
      setAuthError("Network error");
    }
  };

  useEffect(() => {
    if (view !== "logged_in") {
      return;
    }

    const onActivity = () => {
      markActivity();
    };

    window.addEventListener("pointerdown", onActivity);
    window.addEventListener("keydown", onActivity);

    return () => {
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("keydown", onActivity);
    };
  }, [view, markActivity]);

  useEffect(() => {
    if (view !== "logged_in") {
      return;
    }

    const now = Date.now();
    const elapsedMs = now - lastActivityAtMs;
    const remainingMs = Math.max(0, INACTIVITY_LOCK_MS - elapsedMs);

    const timeoutId = window.setTimeout(() => {
      setView("locked");
    }, remainingMs);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [view, lastActivityAtMs]);

  useEffect(() => {
    if (view !== "logged_in") {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (activitySeqRef.current === keepaliveSeqRef.current) {
        return;
      }
      keepaliveSeqRef.current = activitySeqRef.current;

      void (async () => {
        try {
          const res = await postEmpty("/api/v1/staff/auth/keepalive");
          if (res.status === 401) {
            setView("locked");
            return;
          }
          if (!res.ok) {
            setActionError(`HTTP ${res.status}`);
          }
        } catch {
          setActionError("Network error");
        }
      })();
    }, KEEPALIVE_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [view]);

  useEffect(() => {
    if (view !== "logged_in") {
      setPttHeld(false);
      return;
    }
    const client = connectSse("/api/v1/staff/stream", {
      onSnapshot: (data) => {
        setSnapshot(data as StaffSnapshot);
      },
      onMessage: (message: ServerMessage) => {
        if (message.type !== "staff.pending_list") {
          return;
        }
        const data = message.data;
        if (!isPendingListData(data)) {
          return;
        }
        setPendingItems(data.items);
      },
      onError: (error) => {
        setActionError(error.message);
      }
    });
    return () => {
      client.close();
    };
  }, [view]);

  const title = view === "logged_in" ? "STAFF" : view === "locked" ? "STAFF (Locked)" : "STAFF";

  const modeText = snapshot
    ? snapshot.state.mode === "PERSONAL"
      ? `PERSONAL${snapshot.state.personal_name ? ` (${snapshot.state.personal_name})` : ""}`
      : "ROOM"
    : "-";

  const phaseText = snapshot ? snapshot.state.phase : "-";
  const pendingCountText = snapshot ? String(snapshot.pending.count) : "-";

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>{title}</h1>
        <div className={styles.label}>Stream: /api/v1/staff/stream</div>
      </header>

      {view !== "logged_in" ? (
        <main className={styles.content}>
          <h2>Login</h2>
          <div className={styles.formRow}>
            <label className={styles.formLabel}>
              Passcode
              <input
                className={styles.textInput}
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                type="password"
                autoComplete="current-password"
              />
            </label>
          </div>
          <div className={styles.formRow}>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => void submitLogin()}
              disabled={passcode.length === 0}
            >
              Sign in
            </button>
          </div>
          {authError ? <div className={styles.errorText}>{authError}</div> : null}
        </main>
      ) : (
        <main className={styles.staffLayout}>
          <section className={styles.staffStatus}>
            <div className={styles.staffStatusRow}>
              <div className={styles.kioskBadge}>Mode: {modeText}</div>
              <div className={styles.kioskBadge}>Phase: {phaseText}</div>
              <div className={styles.kioskBadge}>Pending: {pendingCountText}</div>
            </div>
          </section>

          <section className={styles.staffControls}>
            <div className={styles.staffControlGrid}>
              <button
                type="button"
                className={pttHeld ? styles.pttButtonActive : styles.pttButton}
                aria-pressed={pttHeld}
                onPointerDown={() => {
                  markActivity();
                  setPttHeldSafe(true);
                  void sendStaffEvent("STAFF_PTT_DOWN");
                }}
                onPointerUp={() => {
                  releasePtt();
                }}
                onPointerCancel={() => {
                  releasePtt();
                }}
                onPointerOut={() => {
                  releasePtt();
                }}
              >
                Push to talk
              </button>

              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => {
                  markActivity();
                  void sendStaffEvent("STAFF_FORCE_ROOM");
                }}
              >
                Force ROOM
              </button>
              <button
                type="button"
                className={styles.dangerButton}
                onClick={() => {
                  markActivity();
                  void sendStaffEvent("STAFF_EMERGENCY_STOP");
                }}
              >
                Emergency stop
              </button>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => {
                  markActivity();
                  void sendStaffEvent("STAFF_RESUME");
                }}
              >
                Resume
              </button>
            </div>

            {actionError ? <div className={styles.errorText}>{actionError}</div> : null}
          </section>

          <section className={styles.staffPending}>
            <div className={styles.pendingHeader}>
              <h2>Pending</h2>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => {
                  markActivity();
                  void refreshPending();
                }}
              >
                Refresh
              </button>
            </div>

            {pendingError ? <div className={styles.errorText}>{pendingError}</div> : null}

            {pendingItems.length === 0 ? (
              <div className={styles.label}>No pending items.</div>
            ) : (
              <div className={styles.pendingList}>
                {pendingItems.map((item) => (
                  <div key={item.id} className={styles.pendingCard}>
                    <div className={styles.pendingTitle}>
                      {item.personal_name} / {item.kind} / {item.value}
                    </div>
                    {item.source_quote ? (
                      <div className={styles.pendingQuote}>{item.source_quote}</div>
                    ) : null}
                    <div className={styles.pendingActions}>
                      <button
                        type="button"
                        className={styles.primaryButton}
                        onClick={() => {
                          markActivity();
                          void mutatePending(item.id, "confirm");
                        }}
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        className={styles.dangerButton}
                        onClick={() => {
                          markActivity();
                          void mutatePending(item.id, "deny");
                        }}
                      >
                        Deny
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </main>
      )}
    </div>
  );
};
