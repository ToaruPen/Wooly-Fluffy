import { describe, expect, it, vi } from "vitest";
import { convertRecordingBlobToWavFile } from "./kiosk-audio";

describe("kiosk-audio", () => {
  it("converts a recording Blob to 16kHz mono WAV File", async () => {
    class FakeAudioContext {
      static instances: FakeAudioContext[] = [];
      closed = false;

      constructor() {
        FakeAudioContext.instances.push(this);
      }

      async decodeAudioData(_buffer: ArrayBuffer) {
        return {
          sampleRate: 16000,
          numberOfChannels: 1,
          getChannelData: () => new Float32Array([0, 0.5, -0.5])
        };
      }

      async close() {
        this.closed = true;
      }
    }

    vi.stubGlobal("AudioContext", FakeAudioContext as unknown as typeof AudioContext);

    const blob1 = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });
    const file = await convertRecordingBlobToWavFile({
      blob: blob1,
      fileName: "stt-1.wav"
    });

    expect(file.name).toBe("stt-1.wav");
    expect(file.type).toBe("audio/wav");
    expect(file.size).toBeGreaterThanOrEqual(44);
    expect(FakeAudioContext.instances[0]?.closed).toBe(true);

    const blob2 = new Blob([new Uint8Array([9])], { type: "audio/webm" });
    const arrayBufferSpy = vi.fn(async () => new ArrayBuffer(1));
    Object.defineProperty(blob2, "arrayBuffer", { value: arrayBufferSpy, configurable: true });

    const file2 = await convertRecordingBlobToWavFile({ blob: blob2, fileName: "stt-2.wav" });
    expect(file2.name).toBe("stt-2.wav");
    expect(arrayBufferSpy).toHaveBeenCalledTimes(1);
  });
});
