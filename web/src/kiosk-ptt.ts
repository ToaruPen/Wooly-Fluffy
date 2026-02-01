export type PttSession = {
  stop: () => Promise<Blob>;
};

export const startPttSession = async (): Promise<PttSession> => {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("getUserMedia is not available");
  }
  if (typeof MediaRecorder === "undefined") {
    throw new Error("MediaRecorder is not available");
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const chunks: Blob[] = [];

  const recorder = new MediaRecorder(stream);
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) {
      chunks.push(e.data);
    }
  };

  const stopped = new Promise<Blob>((resolve, reject) => {
    recorder.onerror = () => {
      reject(new Error("Recording error"));
    };
    recorder.onstop = () => {
      try {
        resolve(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
      } catch (err) {
        reject(err instanceof Error ? err : new Error("Failed to create Blob"));
      }
    };
  });

  recorder.start();

  return {
    stop: async () => {
      try {
        recorder.stop();
        return await stopped;
      } finally {
        for (const track of stream.getTracks()) {
          track.stop();
        }
      }
    }
  };
};
