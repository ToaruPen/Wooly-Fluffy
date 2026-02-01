import { describe, expect, it } from "vitest";
import {
  audioBufferToWav16kMono,
  downmixToMono,
  encodeWavPcm16Mono,
  floatToPcm16,
  resampleLinear
} from "./wav";

const readAscii = (bytes: Uint8Array, offset: number, length: number): string => {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += String.fromCharCode(bytes[offset + i] ?? 0);
  }
  return out;
};

describe("wav", () => {
  it("floatToPcm16 clamps and converts", () => {
    const pcm = floatToPcm16(
      new Float32Array([
        -2,
        -1,
        -0.5,
        0,
        0.5,
        1,
        2,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        -Infinity
      ])
    );
    expect(Array.from(pcm)).toEqual([-32768, -32768, -16384, 0, 16384, 32767, 32767, 0, 0, 0]);
  });

  it("downmixToMono handles 0/1/n channels", () => {
    expect(downmixToMono([]).length).toBe(0);

    const ch0 = new Float32Array([0, 1]);
    const mono1 = downmixToMono([ch0]);
    expect(Array.from(mono1)).toEqual([0, 1]);
    ch0[0] = 99;
    expect(Array.from(mono1)).toEqual([0, 1]);

    const left = new Float32Array([1, 0]);
    const right = new Float32Array([0, 1]);
    expect(Array.from(downmixToMono([left, right]))).toEqual([0.5, 0.5]);
  });

  it("downmixToMono throws on mismatched channel lengths", () => {
    expect(() => downmixToMono([new Float32Array([0]), new Float32Array([0, 1])])).toThrow(
      "Channel length mismatch"
    );
  });

  it("resampleLinear validates sample rates", () => {
    expect(() => resampleLinear(new Float32Array([1]), 0, 16000)).toThrow("Invalid sample rate");
    expect(() => resampleLinear(new Float32Array([1]), 16000, -1)).toThrow("Invalid sample rate");
  });

  it("resampleLinear handles empty and identity", () => {
    expect(resampleLinear(new Float32Array(), 48000, 16000).length).toBe(0);
    expect(Array.from(resampleLinear(new Float32Array([1, 2]), 16000, 16000))).toEqual([1, 2]);
  });

  it("resampleLinear downsamples with linear interpolation", () => {
    const input = new Float32Array([0, 1, 2, 3, 4, 5]);
    const out = resampleLinear(input, 6, 3);
    expect(Array.from(out)).toEqual([0, 2, 4]);
  });

  it("encodeWavPcm16Mono produces a valid WAV container", () => {
    const wav = encodeWavPcm16Mono(new Int16Array([0, 1, -1]), 16000);
    expect(wav.length).toBe(44 + 6);
    expect(readAscii(wav, 0, 4)).toBe("RIFF");
    expect(readAscii(wav, 8, 4)).toBe("WAVE");
    expect(readAscii(wav, 12, 4)).toBe("fmt ");
    expect(readAscii(wav, 36, 4)).toBe("data");
    const view = new DataView(wav.buffer as ArrayBuffer);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(6);
  });

  it("encodeWavPcm16Mono validates sample rate", () => {
    expect(() => encodeWavPcm16Mono(new Int16Array([0]), 0)).toThrow("Invalid sample rate");
  });

  it("audioBufferToWav16kMono converts an AudioBufferLike", () => {
    const wav = audioBufferToWav16kMono({
      sampleRate: 16000,
      numberOfChannels: 1,
      getChannelData: () => new Float32Array([0, 0.5, -0.5])
    });
    expect(wav.length).toBe(44 + 6);
    expect(readAscii(wav, 0, 4)).toBe("RIFF");
    expect(readAscii(wav, 8, 4)).toBe("WAVE");
  });
});
