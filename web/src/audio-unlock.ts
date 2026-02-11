const SILENT_WAV_DATA_URI =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=";

type GestureAudioUnlockDeps = {
  userAgent?: string;
  AudioCtor?: typeof Audio | null;
  AudioContextCtor?: typeof AudioContext | null;
  webkitAudioContextCtor?: typeof AudioContext | null;
};

const flushNoop = () => undefined;

export const performGestureAudioUnlock = (deps: GestureAudioUnlockDeps = {}) => {
  const g = globalThis as unknown as { navigator: { userAgent: string }; Audio?: unknown };
  const userAgent = deps.userAgent ?? g.navigator.userAgent;
  const isJsdom = userAgent.toLowerCase().includes("jsdom");

  const AudioCtor =
    deps.AudioCtor === undefined
      ? typeof g.Audio === "function"
        ? (g.Audio as typeof Audio)
        : null
      : deps.AudioCtor;
  try {
    // Avoid creating extra Audio instances in jsdom tests (HTMLMediaElement.play is not implemented).
    if (!isJsdom && AudioCtor) {
      const a = new AudioCtor(SILENT_WAV_DATA_URI);
      a.volume = 0;
      void a
        .play()
        .then(() => {
          try {
            a.pause();
          } catch {
            flushNoop();
          }
        })
        .catch(flushNoop);
    }
  } catch {
    flushNoop();
  }

  const w = globalThis as unknown as { AudioContext?: unknown; webkitAudioContext?: unknown };
  const AudioContextCtor =
    deps.AudioContextCtor === undefined
      ? typeof w.AudioContext === "function"
        ? (w.AudioContext as typeof AudioContext)
        : null
      : deps.AudioContextCtor;
  const WebkitAudioContextCtor =
    deps.webkitAudioContextCtor === undefined
      ? typeof w.webkitAudioContext === "function"
        ? (w.webkitAudioContext as typeof AudioContext)
        : null
      : deps.webkitAudioContextCtor;
  const Ctor = AudioContextCtor ?? WebkitAudioContextCtor;

  try {
    if (Ctor) {
      const ctx = new Ctor();
      void ctx
        .resume()
        .then(async () => {
          try {
            await ctx.close();
          } catch {
            flushNoop();
          }
        })
        .catch(async () => {
          try {
            await ctx.close();
          } catch {
            flushNoop();
          }
        });
    }
  } catch {
    flushNoop();
  }
};
