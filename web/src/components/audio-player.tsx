import { useEffect, useRef } from "react";

type AudioPlayerProps = {
  wav: ArrayBuffer | null;
  playId: number;
  onEnded?: (playId: number) => void;
  onError?: (playId: number, code: AudioErrorCode) => void;
  onLevel?: (playId: number, level: number) => void;
};

export const AUDIO_ERROR_UNSUPPORTED = "audio_unsupported";
export const AUDIO_ERROR_PLAY_BLOCKED = "audio_play_blocked";
export const AUDIO_ERROR_PLAY_FAILED = "audio_play_failed";

type AudioErrorCode =
  | typeof AUDIO_ERROR_UNSUPPORTED
  | typeof AUDIO_ERROR_PLAY_BLOCKED
  | typeof AUDIO_ERROR_PLAY_FAILED;

export const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export const computeRmsFromByteTimeDomainData = (data: Uint8Array) => {
  if (data.length === 0) {
    return 0;
  }

  let sum = 0;
  for (let i = 0; i < data.length; i += 1) {
    const centered = (data[i] - 128) / 128;
    sum += centered * centered;
  }
  const mean = sum / data.length;
  return Math.sqrt(mean);
};

export const smoothValue = (prev: number, target: number, attack: number, release: number) => {
  const a = clamp01(attack);
  const r = clamp01(release);
  const t = clamp01(target);
  const p = clamp01(prev);
  const factor = t > p ? a : r;
  return clamp01(p + (t - p) * factor);
};

type Runtime = {
  audio: HTMLAudioElement;
  url: string;
  audioContext: AudioContext | null;
  analyser: AnalyserNode | null;
  source: MediaElementAudioSourceNode | null;
  rafId: number | null;
  currentLevel: number;
};

const stopRuntime = async (
  runtime: Runtime | null,
  playId: number,
  onLevel?: (playId: number, level: number) => void,
) => {
  if (!runtime) {
    return;
  }

  if (runtime.rafId !== null) {
    cancelAnimationFrame(runtime.rafId);
  }

  try {
    runtime.audio.pause();
  } catch {
    // ignore
  }

  try {
    URL.revokeObjectURL(runtime.url);
  } catch {
    // ignore
  }

  try {
    runtime.source?.disconnect();
  } catch {
    // ignore
  }

  try {
    runtime.analyser?.disconnect();
  } catch {
    // ignore
  }

  if (runtime.audioContext) {
    try {
      await runtime.audioContext.close();
    } catch {
      // ignore
    }
  }

  onLevel?.(playId, 0);
};

export const AudioPlayer = ({ wav, playId, onEnded, onError, onLevel }: AudioPlayerProps) => {
  const runtimeRef = useRef<Runtime | null>(null);
  const onEndedRef = useRef<AudioPlayerProps["onEnded"]>(onEnded);
  const onErrorRef = useRef<AudioPlayerProps["onError"]>(onError);
  const onLevelRef = useRef<AudioPlayerProps["onLevel"]>(onLevel);

  useEffect(() => {
    onEndedRef.current = onEnded;
    onErrorRef.current = onError;
    onLevelRef.current = onLevel;
  }, [onEnded, onError, onLevel]);

  useEffect(() => {
    void stopRuntime(runtimeRef.current, playId, onLevelRef.current);
    runtimeRef.current = null;

    if (!wav) {
      return;
    }

    if (typeof URL.createObjectURL !== "function" || typeof Audio !== "function") {
      onErrorRef.current?.(playId, AUDIO_ERROR_UNSUPPORTED);
      return;
    }

    const url = URL.createObjectURL(new Blob([wav], { type: "audio/wav" }));
    const audio = new Audio(url);

    const runtime: Runtime = {
      audio,
      url,
      audioContext: null,
      analyser: null,
      source: null,
      rafId: null,
      currentLevel: 0,
    };
    runtimeRef.current = runtime;

    audio.onended = () => {
      if (runtimeRef.current !== runtime) {
        return;
      }
      onLevelRef.current?.(playId, 0);
      onEndedRef.current?.(playId);
      void stopRuntime(runtime, playId, onLevelRef.current);
      if (runtimeRef.current === runtime) {
        runtimeRef.current = null;
      }
    };

    const AudioContextCtor = (window as unknown as { AudioContext?: typeof AudioContext })
      .AudioContext;

    if (AudioContextCtor) {
      try {
        const audioContext = new AudioContextCtor();
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;

        runtime.audioContext = audioContext;
        runtime.analyser = analyser;

        const setupWebAudio = async () => {
          try {
            await audioContext.resume();
          } catch {
            try {
              await audioContext.close();
            } catch {
              // ignore
            }
            if (runtimeRef.current === runtime) {
              runtime.audioContext = null;
              runtime.analyser = null;
              runtime.source = null;
            }
            return;
          }

          if (runtimeRef.current !== runtime) {
            try {
              await audioContext.close();
            } catch {
              // ignore
            }
            return;
          }

          const isRunning = audioContext.state === "running";
          if (!isRunning) {
            try {
              await audioContext.close();
            } catch {
              // ignore
            }
            runtime.audioContext = null;
            runtime.analyser = null;
            runtime.source = null;
            return;
          }

          const source = audioContext.createMediaElementSource(audio);
          source.connect(analyser);
          analyser.connect(audioContext.destination);

          runtime.source = source;

          const buffer = new Uint8Array(analyser.fftSize);
          const tick = () => {
            if (runtimeRef.current !== runtime) {
              return;
            }
            analyser.getByteTimeDomainData(buffer);
            const rms = computeRmsFromByteTimeDomainData(buffer);
            const next = smoothValue(runtime.currentLevel, rms, 0.65, 0.25);
            runtime.currentLevel = next;
            onLevelRef.current?.(playId, next);
            runtime.rafId = requestAnimationFrame(tick);
          };
          runtime.rafId = requestAnimationFrame(tick);
        };

        void setupWebAudio();
      } catch {
        // If WebAudio fails, still attempt to play audio.
      }
    }

    void audio
      .play()
      .then(() => undefined)
      .catch((err: unknown) => {
        if (runtimeRef.current !== runtime) {
          return;
        }

        const name =
          err &&
          typeof err === "object" &&
          "name" in err &&
          typeof (err as { name?: unknown }).name === "string"
            ? (err as { name: string }).name
            : "";

        const isLikelyAutoplayBlocked = name === "NotAllowedError" || name === "SecurityError";

        onErrorRef.current?.(
          playId,
          isLikelyAutoplayBlocked ? AUDIO_ERROR_PLAY_BLOCKED : AUDIO_ERROR_PLAY_FAILED,
        );
        void stopRuntime(runtime, playId, onLevelRef.current);
        if (runtimeRef.current === runtime) {
          runtimeRef.current = null;
        }
      });

    return () => {
      void stopRuntime(runtime, playId, onLevelRef.current);
      if (runtimeRef.current === runtime) {
        runtimeRef.current = null;
      }
    };
  }, [wav, playId]);

  return null;
};
