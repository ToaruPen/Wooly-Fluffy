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
const SEGMENT_TTS_PREFETCH_LIMIT = 3;
const SEGMENT_UTTERANCE_ID_HISTORY_LIMIT = 128;

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

const isSseTransportError = (error: Error): boolean => error.message === "SSE connection error";

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

const isSpeechStartData = (
  data: unknown,
): data is { utterance_id: string; chat_request_id: string } => {
  if (!data || typeof data !== "object") {
    return false;
  }
  const record = data as Record<string, unknown>;
  return typeof record.utterance_id === "string" && typeof record.chat_request_id === "string";
};

const isSpeechSegmentData = (
  data: unknown,
): data is {
  utterance_id: string;
  chat_request_id: string;
  segment_index: number;
  text: string;
  is_last: boolean;
} => {
  if (!data || typeof data !== "object") {
    return false;
  }
  const record = data as Record<string, unknown>;
  return (
    typeof record.utterance_id === "string" &&
    typeof record.chat_request_id === "string" &&
    Number.isInteger(record.segment_index) &&
    Number(record.segment_index) >= 0 &&
    typeof record.text === "string" &&
    typeof record.is_last === "boolean"
  );
};

type SegmentQueueItem =
  | { status: "pending"; text: string }
  | { status: "fetching"; text: string }
  | { status: "ready"; text: string; wav: ArrayBuffer }
  | { status: "failed"; text: string; error: string };

type SegmentQueueState = {
  generation: number;
  utteranceId: string | null;
  items: Map<number, SegmentQueueItem>;
  activeFetches: number;
  nextPlayIndex: number;
  isPlaying: boolean;
  firstSegmentReceivedAtMs: number | null;
  firstPlaybackStartedAtMs: number | null;
};

type PlayingSegmentState = {
  generation: number;
  index: number;
  text: string;
  wav: ArrayBuffer;
};

type DevSpeechProbe = {
  utterance_id: string;
  first_segment_received_at_ms: number;
  first_playback_started_at_ms: number;
  ttfa_ms: number;
};

const createSegmentQueueState = (): SegmentQueueState => ({
  generation: 0,
  utteranceId: null,
  items: new Map<number, SegmentQueueItem>(),
  activeFetches: 0,
  nextPlayIndex: 0,
  isPlaying: false,
  firstSegmentReceivedAtMs: null,
  firstPlaybackStartedAtMs: null,
});

export const KioskPage = () => {
  const [snapshot, setSnapshot] = useState<KioskSnapshot | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [speech, setSpeech] = useState<SpeakState | null>(null);
  const [toolCallsCount, setToolCallsCount] = useState(0);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [streamConnection, setStreamConnection] = useState<"connected" | "reconnecting" | "error">(
    "reconnecting",
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
  const isStreamConnectedRef = useRef(false);
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
  const currentPlaybackSourceRef = useRef<"speak" | "segment" | null>(null);
  const playingSegmentRef = useRef<PlayingSegmentState | null>(null);
  const segmentQueueRef = useRef<SegmentQueueState>(createSegmentQueueState());
  const segmentUtteranceIdsRef = useRef<Set<string>>(new Set());
  const pendingSegmentEndUtteranceIdRef = useRef<string | null>(null);
  const sseClientRef = useRef<{ close: () => void; reconnect: () => void } | null>(null);

  const rememberSegmentUtteranceId = useCallback((utteranceId: string) => {
    const known = segmentUtteranceIdsRef.current;
    if (known.has(utteranceId)) {
      return;
    }
    known.add(utteranceId);
    while (known.size > SEGMENT_UTTERANCE_ID_HISTORY_LIMIT) {
      const first = known.values().next();
      /* v8 ignore next 3 -- Set.size > limit guarantees non-empty iterator */
      if (first.done) {
        break;
      }
      known.delete(first.value);
    }
  }, []);

  const finalizeEndedSegmentUtteranceIfIdle = useCallback(() => {
    const endedUtteranceId = pendingSegmentEndUtteranceIdRef.current;
    if (!endedUtteranceId) {
      return;
    }
    const queue = segmentQueueRef.current;
    /* v8 ignore next 3 -- speech.end handler pre-filters mismatched utteranceId */
    if (queue.utteranceId !== endedUtteranceId) {
      return;
    }
    if (queue.items.size > 0 || queue.activeFetches > 0 || queue.isPlaying) {
      return;
    }
    queue.utteranceId = null;
    pendingSegmentEndUtteranceIdRef.current = null;
  }, []);

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
      .then((isOk: boolean) => {
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
    ttsPlayIdRef.current += 1;
    setTtsPlayId(ttsPlayIdRef.current);
    setTtsWav(null);
    setMouthOpen(0);
    currentPlaybackSourceRef.current = null;
    playingSegmentRef.current = null;
    segmentQueueRef.current.isPlaying = false;
  }, []);

  const pushDevSpeechProbe = useCallback((probe: DevSpeechProbe) => {
    if (!import.meta.env.DEV) {
      return;
    }
    const w = window as Window & {
      __wfSpeechTtfaProbe?: { latest?: DevSpeechProbe; history: DevSpeechProbe[] };
    };
    if (!w.__wfSpeechTtfaProbe) {
      w.__wfSpeechTtfaProbe = { history: [] };
    }
    w.__wfSpeechTtfaProbe.latest = probe;
    w.__wfSpeechTtfaProbe.history.push(probe);
  }, []);

  const resetSegmentQueue = useCallback(
    (utteranceId: string | null) => {
      stopTtsAudio();
      const queue = segmentQueueRef.current;
      queue.generation += 1;
      queue.utteranceId = utteranceId;
      queue.items.clear();
      queue.activeFetches = 0;
      queue.nextPlayIndex = 0;
      queue.isPlaying = false;
      queue.firstSegmentReceivedAtMs = null;
      queue.firstPlaybackStartedAtMs = null;
      pendingSegmentEndUtteranceIdRef.current = null;
    },
    [stopTtsAudio],
  );

  const fetchTtsWav = useCallback(async (text: string): Promise<ArrayBuffer> => {
    const res = await postJson("/api/v1/kiosk/tts", { text });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.arrayBuffer();
  }, []);

  const maybePlayNextSegment = useCallback(() => {
    const queue = segmentQueueRef.current;
    if (queue.isPlaying) {
      return;
    }
    if (!isAudioUnlockedRef.current) {
      if (queue.items.size > 0) {
        setIsAudioUnlockNeeded(true);
      }
      return;
    }

    while (true) {
      const item = queue.items.get(queue.nextPlayIndex);
      if (!item) {
        finalizeEndedSegmentUtteranceIfIdle();
        return;
      }
      if (item.status === "failed") {
        setAudioError(item.error);
        queue.items.delete(queue.nextPlayIndex);
        queue.nextPlayIndex += 1;
        continue;
      }
      if (item.status !== "ready") {
        return;
      }

      queue.items.delete(queue.nextPlayIndex);
      const playingIndex = queue.nextPlayIndex;
      queue.nextPlayIndex += 1;
      queue.isPlaying = true;
      currentPlaybackSourceRef.current = "segment";
      playingSegmentRef.current = {
        generation: queue.generation,
        index: playingIndex,
        text: item.text,
        wav: item.wav,
      };
      ttsPlayIdRef.current += 1;
      setTtsPlayId(ttsPlayIdRef.current);
      setAudioError(null);
      setTtsWav(item.wav);

      if (queue.firstPlaybackStartedAtMs === null) {
        queue.firstPlaybackStartedAtMs = Date.now();
        if (queue.utteranceId && queue.firstSegmentReceivedAtMs !== null) {
          pushDevSpeechProbe({
            utterance_id: queue.utteranceId,
            first_segment_received_at_ms: queue.firstSegmentReceivedAtMs,
            first_playback_started_at_ms: queue.firstPlaybackStartedAtMs,
            ttfa_ms: queue.firstPlaybackStartedAtMs - queue.firstSegmentReceivedAtMs,
          });
        }
      }
      return;
    }
  }, [finalizeEndedSegmentUtteranceIfIdle, pushDevSpeechProbe]);

  const pumpSegmentFetches = useCallback(() => {
    const queue = segmentQueueRef.current;
    while (queue.activeFetches < SEGMENT_TTS_PREFETCH_LIMIT) {
      let nextEntry: [number, SegmentQueueItem] | null = null;
      for (const entry of queue.items.entries()) {
        const [index, item] = entry;
        if (item.status !== "pending") {
          continue;
        }
        /* v8 ignore next -- Map iteration order makes index < nextEntry[0] unreachable */
        if (!nextEntry || index < nextEntry[0]) {
          nextEntry = [index, item];
        }
      }
      if (!nextEntry) {
        break;
      }

      const [segmentIndex, item] = nextEntry;
      queue.items.set(segmentIndex, { status: "fetching", text: item.text });
      queue.activeFetches += 1;
      const generation = queue.generation;

      void fetchTtsWav(item.text)
        .then((wav: ArrayBuffer) => {
          const latest = segmentQueueRef.current;
          // Stale-generation guard: queue was reset while the fetch was in flight.
          /* v8 ignore next 3 */
          if (latest.generation !== generation) {
            return;
          }
          const current = latest.items.get(segmentIndex);
          // Stale-item guard: item was consumed or replaced during the fetch.
          /* v8 ignore next 3 */
          if (!current || current.status !== "fetching") {
            return;
          }
          latest.items.set(segmentIndex, { status: "ready", text: item.text, wav });
          setAudioError(null);
        })
        .catch((error: unknown) => {
          const latest = segmentQueueRef.current;
          // Stale-generation guard: queue was reset while the fetch was in flight.
          /* v8 ignore next 3 */
          if (latest.generation !== generation) {
            return;
          }
          // Stale-item guard: item was consumed or replaced during the fetch.
          /* v8 ignore next 4 */
          const current = latest.items.get(segmentIndex);
          if (!current || current.status !== "fetching") {
            return;
          }
          /* v8 ignore next -- defensive non-Error fallback */
          const message = error instanceof Error ? error.message : "Network error";
          latest.items.set(segmentIndex, { status: "failed", text: item.text, error: message });
        })
        .finally(() => {
          const latest = segmentQueueRef.current;
          if (latest.generation === generation) {
            latest.activeFetches = Math.max(0, latest.activeFetches - 1);
          }
          pumpSegmentFetches();
          maybePlayNextSegment();
          finalizeEndedSegmentUtteranceIfIdle();
        });
    }
  }, [fetchTtsWav, finalizeEndedSegmentUtteranceIfIdle, maybePlayNextSegment]);

  const enqueueSpeechSegment = useCallback(
    (data: { utterance_id: string; segment_index: number; text: string }) => {
      const queue = segmentQueueRef.current;
      if (queue.utteranceId === null || queue.utteranceId !== data.utterance_id) {
        return false;
      }

      const latest = segmentQueueRef.current;
      if (data.segment_index < latest.nextPlayIndex) {
        return false;
      }
      if (latest.items.has(data.segment_index)) {
        return false;
      }
      if (latest.firstSegmentReceivedAtMs === null) {
        latest.firstSegmentReceivedAtMs = Date.now();
      }
      latest.items.set(data.segment_index, {
        status: "pending",
        text: data.text,
      });
      setAudioError(null);
      pumpSegmentFetches();
      maybePlayNextSegment();
      return true;
    },
    [maybePlayNextSegment, pumpSegmentFetches],
  );

  const playTts = useCallback(
    async (text: string) => {
      stopTtsAudio();
      const generation = ttsGenerationRef.current;
      try {
        const wav = await fetchTtsWav(text);

        if (ttsGenerationRef.current !== generation) {
          return;
        }

        currentPlaybackSourceRef.current = "speak";
        ttsPlayIdRef.current += 1;
        setTtsPlayId(ttsPlayIdRef.current);
        setTtsWav(wav);
      } catch (error: unknown) {
        if (ttsGenerationRef.current !== generation) {
          return;
        }
        stopTtsAudio();
        /* v8 ignore next -- defensive non-Error fallback */
        setAudioError(error instanceof Error ? error.message : "Network error");
      }
    },
    [fetchTtsWav, stopTtsAudio],
  );

  const maybePlayPendingSpeak = useCallback(() => {
    // Defensive guard: audio can be locked between segment playback start and end
    // due to browser race conditions. Unreachable in jsdom.
    /* v8 ignore next 3 */
    if (!isAudioUnlockedRef.current) {
      return;
    }
    const queue = segmentQueueRef.current;
    if (queue.isPlaying || queue.items.size > 0) {
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
  }, [playTts]);

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
    maybePlayNextSegment();
    maybePlayPendingSpeak();
  }, [isAudioUnlocked, maybePlayNextSegment, maybePlayPendingSpeak]);

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
        isStreamConnectedRef.current = true;
        setStreamConnection("connected");
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
              void sessionPromise.then((s: PttSession) => s.stop()).catch(ignoreStopError);
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
            .then((s: PttSession) => s.stop())
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
          if (segmentUtteranceIdsRef.current.has(sayId)) {
            return;
          }
          if (lastPlayedSayIdRef.current === sayId) {
            return;
          }
          if (
            segmentQueueRef.current.utteranceId !== null ||
            segmentQueueRef.current.items.size > 0 ||
            segmentQueueRef.current.isPlaying
          ) {
            return;
          }
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

          lastPlayedSayIdRef.current = sayId;

          void playTts(text);
          return;
        }

        if (message.type === "kiosk.command.speech.start") {
          const data = message.data;
          if (!isSpeechStartData(data)) {
            return;
          }
          pendingTtsTextRef.current = null;
          pendingSayIdRef.current = null;
          if (segmentQueueRef.current.utteranceId !== data.utterance_id) {
            resetSegmentQueue(data.utterance_id);
          }
          rememberSegmentUtteranceId(data.utterance_id);
          return;
        }

        if (message.type === "kiosk.command.speech.segment") {
          const data = message.data;
          if (!isSpeechSegmentData(data)) {
            return;
          }
          if (!enqueueSpeechSegment(data)) {
            return;
          }
          rememberSegmentUtteranceId(data.utterance_id);
          setSpeech({
            sayId: data.utterance_id,
            text: data.text,
            expression: "neutral",
          });
          return;
        }

        if (message.type === "kiosk.command.speech.end") {
          const data = message.data;
          if (!isSpeechStartData(data)) {
            return;
          }
          if (segmentQueueRef.current.utteranceId !== data.utterance_id) {
            return;
          }
          pendingSegmentEndUtteranceIdRef.current = data.utterance_id;
          finalizeEndedSegmentUtteranceIfIdle();
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
          resetSegmentQueue(null);
          setAudioError(null);
          pendingTtsTextRef.current = null;
          pendingSayIdRef.current = null;
          setIsAudioUnlockNeeded(false);
        }
      },
      onError: (error) => {
        if (!isSseTransportError(error)) {
          return;
        }
        setStreamError(error.message);
        isStreamConnectedRef.current = false;
        setStreamConnection("error");

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
    sseClientRef.current = client;

    const utteranceIds = segmentUtteranceIdsRef.current;
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
        void sessionPromise.then((s: PttSession) => s.stop()).catch(ignoreStopError);
      }
      resetSegmentQueue(null);
      utteranceIds.clear();
      client.close();
      sseClientRef.current = null;
    };
  }, [
    enqueueSpeechSegment,
    finalizeEndedSegmentUtteranceIfIdle,
    flushKioskPtt,
    playTts,
    rememberSegmentUtteranceId,
    resetSegmentQueue,
  ]);

  const phase = snapshot?.state.phase ?? null;
  const isConsentVisible = snapshot?.state.consent_ui_visible ?? false;
  const shouldShowRecording = isRecording || phase === "listening";
  const isStreamConnected = streamConnection === "connected";
  const isPttAvailable = isStreamConnected;
  const isReconnecting = streamConnection === "reconnecting";
  const isStreamError = streamConnection === "error";
  const isLocalPttActive = isPttAvailable && (isKioskPttDown || isKioskPttButtonHeld);
  const hasKioskErrors = Boolean(streamError || pttError || audioError);
  const pttButtonLabel = isLocalPttActive ? "はなして とめる" : "おして はなす";

  const handleReconnect = () => {
    const client = sseClientRef.current;
    /* c8 ignore next -- defensive: button only renders after SSE error, so client is always set */
    if (!client) return;
    setStreamConnection("reconnecting");
    setStreamError(null);
    client.reconnect();
  };

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
          {!isAudioUnlocked || isAudioUnlockNeeded ? (
            <div className={styles.kioskNoticeStack}>
              <div className={styles.audioUnlockPill} aria-live="polite">
                おとをだすには 1かい タップしてね
              </div>
            </div>
          ) : null}

          {isReconnecting ? (
            <div className={styles.connectionPill} role="status" aria-live="polite">
              <span className={styles.reconnectingSpinner} aria-hidden="true" />
              つなぎなおしているよ…
            </div>
          ) : null}

          {isStreamError ? (
            <div className={styles.kioskErrorStack}>
              <div className={styles.errorText} role="alert">
                {/* c8 ignore next -- streamError is always set when isStreamError is true */}
                {toKidFriendlyError("stream", streamError ?? "connection error")}
              </div>
              <button type="button" className={styles.reconnectButton} onClick={handleReconnect}>
                もういちどつなぐ
              </button>
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

          {hasKioskErrors && !isStreamError ? (
            <div className={styles.kioskErrorStack}>
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
          if (currentPlaybackSourceRef.current === "segment") {
            segmentQueueRef.current.isPlaying = false;
            playingSegmentRef.current = null;
          }
          setMouthOpen(0);
          setTtsWav(null);
          if (currentPlaybackSourceRef.current === "segment") {
            maybePlayNextSegment();
            finalizeEndedSegmentUtteranceIfIdle();
            maybePlayPendingSpeak();
          }
        }}
        onError={(playId, message) => {
          if (ttsPlayIdRef.current !== playId) {
            return;
          }
          if (currentPlaybackSourceRef.current === "segment") {
            segmentQueueRef.current.isPlaying = false;
          }
          if (message === AUDIO_ERROR_PLAY_BLOCKED) {
            if (currentPlaybackSourceRef.current === "segment") {
              const playing = playingSegmentRef.current;
              const queue = segmentQueueRef.current;
              if (playing && playing.generation === queue.generation) {
                queue.nextPlayIndex = Math.min(queue.nextPlayIndex, playing.index);
                queue.items.set(playing.index, {
                  status: "ready",
                  text: playing.text,
                  wav: playing.wav,
                });
              }
              playingSegmentRef.current = null;
            } else {
              const pending = lastSpokenTextRef.current;
              const pendingSayId = lastSpokenSayIdRef.current;
              if (pending) {
                pendingTtsTextRef.current = pending;
                pendingSayIdRef.current = pendingSayId;
              }
            }
            setMouthOpen(0);
            setTtsWav(null);
            isAudioUnlockedRef.current = false;
            setIsAudioUnlocked(false);
            setIsAudioUnlockNeeded(true);
            return;
          }

          playingSegmentRef.current = null;
          setMouthOpen(0);
          setTtsWav(null);
          setAudioError(message);
          if (currentPlaybackSourceRef.current === "segment") {
            maybePlayNextSegment();
            finalizeEndedSegmentUtteranceIfIdle();
            maybePlayPendingSpeak();
          }
        }}
      />
    </div>
  );
};
