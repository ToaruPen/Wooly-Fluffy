import { audioBufferToWav16kMono } from "./lib/wav";

const readBlobArrayBuffer = async (blob: Blob): Promise<ArrayBuffer> => {
  const withArrayBuffer = blob as unknown as { arrayBuffer?: () => Promise<ArrayBuffer> };
  if (typeof withArrayBuffer.arrayBuffer === "function") {
    return withArrayBuffer.arrayBuffer();
  }
  return new Response(blob).arrayBuffer();
};

export const convertRecordingBlobToWavFile = async (input: {
  blob: Blob;
  fileName: string;
}): Promise<File> => {
  const arrayBuffer = await readBlobArrayBuffer(input.blob);

  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(arrayBuffer);

    const wav = audioBufferToWav16kMono(decoded);
    return new File([wav.buffer as ArrayBuffer], input.fileName, { type: "audio/wav" });
  } finally {
    try {
      await ctx.close();
    } catch {
      // ignore
    }
  }
};
