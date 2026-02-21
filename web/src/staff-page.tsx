import { useCallback, useEffect, useRef, useState } from "react";
import { getJson, postEmpty, postJson, readJson } from "./api";
import { connectSse, type ServerMessage } from "./sse-client";
import styles from "./styles.module.css";
import { DevDebugLink } from "./dev-debug-link";
import { readViteInt } from "./env";

type Phase =
  | "idle"
  | "listening"
  | "waiting_stt"
  | "waiting_chat"
  | "asking_consent"
  | "waiting_inner_task";

type StaffSnapshot = {
  state: {
    phase: Phase;
  };
  pending: {
    count: number;
    session_summary_count: number;
  };
};

type PendingItem = {
  id: string;
  title: string;
  summary_json: unknown;
  status: "pending" | "confirmed";
  created_at_ms: number;
  expires_at_ms: number | null;
};

type StaffView = "logged_out" | "locked" | "logged_in";

const INACTIVITY_LOCK_MS = readViteInt({
  name: "VITE_STAFF_INACTIVITY_LOCK_MS",
  defaultValue: 180_000,
  min: 10_000,
  max: 24 * 60 * 60 * 1000,
});
const KEEPALIVE_INTERVAL_MS = readViteInt({
  name: "VITE_STAFF_KEEPALIVE_INTERVAL_MS",
  defaultValue: 30_000,
  min: 1_000,
  max: 5 * 60 * 1000,
});

const isPendingListData = (data: unknown): data is { items: PendingItem[] } => {
  if (!data || typeof data !== "object") {
    return false;
  }
  const record = data as Record<string, unknown>;
  return Array.isArray(record.items);
};

const INTERACTIVE_TAGS = new Set(["input", "textarea", "select", "button", "a"]);

const isInteractiveElement = (el: Element | null): boolean => {
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (INTERACTIVE_TAGS.has(tag)) return true;
  if (el.getAttribute("role") === "button") return true;
  const ce = el.getAttribute("contenteditable");
  if (ce !== null && ce !== "false") return true;
  return false;
};

const getPhaseCategory = (phase: Phase): "idle" | "active" | "waiting" => {
  if (phase === "idle") return "idle";
  if (phase === "listening") return "active";
  return "waiting";
};

const getPhaseLabel = (phase: Phase): string => {
  switch (phase) {
    case "idle":
      return "Idle";
    case "listening":
      return "Listening";
    case "waiting_stt":
      return "Waiting (STT)";
    case "waiting_chat":
      return "Waiting (Chat)";
    case "asking_consent":
      return "Asking Consent";
    case "waiting_inner_task":
      return "Waiting (Task)";
  }
};

const formatTimestampUtc = (timestampMs: number | null): string => {
  if (timestampMs === null) {
    return "-";
  }
  if (!Number.isFinite(timestampMs)) {
    throw new Error(`Invalid timestamp value: ${String(timestampMs)}`);
  }
  const date = new Date(timestampMs);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp value: ${String(timestampMs)}`);
  }
  return date.toISOString();
};

const formatSummary = (summaryJson: unknown): string => {
  if (typeof summaryJson === "string") {
    return summaryJson;
  }
  const encoded = JSON.stringify(summaryJson);
  return typeof encoded === "string" ? encoded : "null";
};

const renderTimestampText = (timestampMs: number | null): string => {
  try {
    return formatTimestampUtc(timestampMs);
  } catch (error) {
    return (error as Error).message;
  }
};

export const StaffPage = () => {
  const [view, setView] = useState<StaffView>("logged_out");
  const [passcode, setPasscode] = useState("");

  const [snapshot, setSnapshot] = useState<StaffSnapshot | null>(null);
  const [pendingItems, setPendingItems] = useState<PendingItem[]>([]);

  const [authError, setAuthError] = useState<string | null>(null);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isPttHeld, setIsPttHeld] = useState(false);
  const [lastActivityAtMs, setLastActivityAtMs] = useState(() => Date.now());

  const isPttHeldRef = useRef(false);

  const activitySeqRef = useRef(0);
  const keepaliveSeqRef = useRef(0);

  const markActivity = useCallback(() => {
    activitySeqRef.current += 1;
    setLastActivityAtMs(Date.now());
  }, []);

  const setIsPttHeldSafe = useCallback((isHeld: boolean) => {
    isPttHeldRef.current = isHeld;
    setIsPttHeld(isHeld);
  }, []);

  const sendStaffEvent = useCallback(
    async (
      type:
        | "STAFF_PTT_DOWN"
        | "STAFF_PTT_UP"
        | "STAFF_FORCE_ROOM"
        | "STAFF_EMERGENCY_STOP"
        | "STAFF_RESUME",
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
    },
    [],
  );

  const releasePtt = useCallback(() => {
    if (!isPttHeldRef.current) {
      return;
    }
    markActivity();
    setIsPttHeldSafe(false);
    void sendStaffEvent("STAFF_PTT_UP");
  }, [markActivity, setIsPttHeldSafe, sendStaffEvent]);

  const refreshPending = async () => {
    setPendingError(null);
    try {
      const res = await getJson("/api/v1/staff/session-summaries/pending");
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

  const mutatePending = async (id: string, action: "confirm" | "deny") => {
    setActionError(null);
    try {
      const res = await postEmpty(`/api/v1/staff/session-summaries/${id}/${action}`);
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
      setIsPttHeld(false);
      return;
    }
    const client = connectSse("/api/v1/staff/stream", {
      onSnapshot: (data) => {
        setSnapshot(data as StaffSnapshot);
      },
      onMessage: (message: ServerMessage) => {
        if (message.type !== "staff.session_summaries_pending_list") {
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
      },
    });
    return () => {
      client.close();
    };
  }, [view]);

  /* Space key PTT: keyrepeat guard, input focus guard, blur/visibility release */
  useEffect(() => {
    if (view !== "logged_in") {
      return;
    }

    const isSpaceKey = (e: KeyboardEvent) => e.code === "Space" || e.key === " ";

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isSpaceKey(e)) return;

      const el = document.activeElement as HTMLElement | null;
      if (isInteractiveElement(el)) return;

      if (e.repeat) {
        if (isPttHeldRef.current) e.preventDefault();
        return;
      }

      if (!isPttHeldRef.current) {
        e.preventDefault();
        markActivity();
        setIsPttHeldSafe(true);
        void sendStaffEvent("STAFF_PTT_DOWN");
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!isSpaceKey(e)) return;
      if (!isPttHeldRef.current) return;
      e.preventDefault();
      releasePtt();
    };

    const handleBlurOrVisibility = () => {
      releasePtt();
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
  }, [view, markActivity, setIsPttHeldSafe, sendStaffEvent, releasePtt]);

  const title = view === "logged_in" ? "STAFF" : view === "locked" ? "STAFF (Locked)" : "STAFF";

  const phase = snapshot?.state.phase ?? null;
  const phaseText = phase ? getPhaseLabel(phase) : "-";
  const phaseCategory = phase ? getPhaseCategory(phase) : "idle";
  const pendingCountText = snapshot ? String(snapshot.pending.session_summary_count) : "-";

  return (
    <div className={styles.staffPage}>
      <header className={styles.staffHeader}>
        <h1 className={styles.staffHeaderTitle}>{title}</h1>
        <DevDebugLink isDev={import.meta.env.DEV as boolean} />
      </header>

      {view !== "logged_in" ? (
        <main>
          <div className={styles.loginCard}>
            <h2>Login</h2>
            <div className={styles.staffFormRow}>
              <label className={styles.staffFormLabel}>
                Passcode
                <input
                  className={styles.staffTextInput}
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  type="password"
                  autoComplete="current-password"
                />
              </label>
            </div>
            <div className={styles.staffFormRow}>
              <button
                type="button"
                className={styles.staffPrimaryButton}
                onClick={() => void submitLogin()}
                disabled={passcode.length === 0}
              >
                Sign in
              </button>
            </div>
            {authError ? <div className={styles.staffErrorText}>{authError}</div> : null}
          </div>
        </main>
      ) : (
        <main className={styles.staffLayout}>
          <section>
            <div className={styles.staffStatusGrid}>
              <div className={styles.statusCard}>
                <div className={styles.statusCardLabel}>Phase</div>
                <div className={styles.statusCardValue}>
                  {phase ? (
                    <span
                      className={`${styles.phaseDot} ${
                        phaseCategory === "idle"
                          ? styles.phaseDotIdle
                          : phaseCategory === "active"
                            ? styles.phaseDotActive
                            : styles.phaseDotWaiting
                      }`}
                      aria-hidden="true"
                    />
                  ) : null}
                  Phase: {phaseText}
                </div>
              </div>
              <div className={styles.statusCard}>
                <div className={styles.statusCardLabel}>Pending</div>
                <div className={styles.statusCardValue}>Pending: {pendingCountText}</div>
              </div>
            </div>
          </section>

          <section className={styles.staffControls}>
            <div className={styles.staffControlGrid}>
              <button
                type="button"
                className={isPttHeld ? styles.pttButtonActive : styles.pttButton}
                aria-pressed={isPttHeld}
                onPointerDown={() => {
                  markActivity();
                  setIsPttHeldSafe(true);
                  void sendStaffEvent("STAFF_PTT_DOWN");
                }}
                onPointerUp={() => {
                  releasePtt();
                }}
                onPointerCancel={() => {
                  releasePtt();
                }}
                onPointerLeave={() => {
                  releasePtt();
                }}
              >
                {isPttHeld ? (
                  <>
                    <span aria-hidden="true">🎙️ </span>
                    話しています...
                  </>
                ) : (
                  "Push to talk"
                )}
              </button>

              <button
                type="button"
                className={styles.staffSecondaryButton}
                onClick={() => {
                  markActivity();
                  void sendStaffEvent("STAFF_FORCE_ROOM");
                }}
              >
                Force ROOM
              </button>
              <button
                type="button"
                className={styles.staffSecondaryButton}
                onClick={() => {
                  markActivity();
                  void sendStaffEvent("STAFF_RESUME");
                }}
              >
                Resume
              </button>
            </div>

            <hr className={styles.controlSeparator} />

            <button
              type="button"
              className={styles.staffDangerButton}
              onClick={() => {
                markActivity();
                void sendStaffEvent("STAFF_EMERGENCY_STOP");
              }}
            >
              <span aria-hidden="true">⚠️ </span>
              Emergency stop
            </button>

            {actionError ? <div className={styles.staffErrorText}>{actionError}</div> : null}
          </section>

          <section className={styles.staffPending}>
            <div className={styles.pendingHeader}>
              <h2>Pending</h2>
              <button
                type="button"
                className={styles.staffSecondaryButton}
                onClick={() => {
                  markActivity();
                  void refreshPending();
                }}
              >
                Refresh
              </button>
            </div>

            {pendingError ? <div className={styles.staffErrorText}>{pendingError}</div> : null}

            {pendingItems.length === 0 ? (
              <div className={styles.staffLabel}>No pending items.</div>
            ) : (
              <div className={styles.pendingList}>
                {pendingItems.map((item) => (
                  <div key={item.id} className={styles.pendingCard}>
                    <div className={styles.pendingTitle}>{item.title}</div>
                    <div className={styles.pendingQuote}>{formatSummary(item.summary_json)}</div>
                    <div className={styles.staffLabel}>
                      Created: {renderTimestampText(item.created_at_ms)}
                    </div>
                    <div className={styles.staffLabel}>
                      Deadline: {renderTimestampText(item.expires_at_ms)}
                    </div>
                    <div className={styles.pendingActions}>
                      <button
                        type="button"
                        className={styles.staffConfirmButton}
                        onClick={() => {
                          markActivity();
                          void mutatePending(item.id, "confirm");
                        }}
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        className={styles.denyButton}
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
