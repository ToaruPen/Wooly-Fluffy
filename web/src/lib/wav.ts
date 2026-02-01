const clampUnitFloat = (value: number): number => {
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  if (value < -1) {
    return -1;
  }
  return value;
};

export const floatToPcm16 = (samples: Float32Array): Int16Array => {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const s = clampUnitFloat(samples[i]);
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
};

export const downmixToMono = (channels: Float32Array[]): Float32Array => {
  if (channels.length === 0) {
    return new Float32Array();
  }
  if (channels.length === 1) {
    return new Float32Array(channels[0]);
  }

  const length = channels[0].length;
  for (let c = 1; c < channels.length; c += 1) {
    if (channels[c].length !== length) {
      throw new Error("Channel length mismatch");
    }
  }

  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    let sum = 0;
    for (let c = 0; c < channels.length; c += 1) {
      sum += channels[c][i];
    }
    out[i] = sum / channels.length;
  }
  return out;
};

export const resampleLinear = (input: Float32Array, fromHz: number, toHz: number): Float32Array => {
  if (!Number.isFinite(fromHz) || !Number.isFinite(toHz) || fromHz <= 0 || toHz <= 0) {
    throw new Error("Invalid sample rate");
  }
  if (input.length === 0) {
    return new Float32Array();
  }
  if (fromHz === toHz) {
    return new Float32Array(input);
  }

  const outLength = Math.max(1, Math.round((input.length * toHz) / fromHz));
  const out = new Float32Array(outLength);

  for (let i = 0; i < outLength; i += 1) {
    const t = i / toHz;
    const srcPos = t * fromHz;
    const i0 = Math.floor(srcPos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = srcPos - i0;
    const v0 = input[i0];
    const v1 = input[i1];
    out[i] = v0 + (v1 - v0) * frac;
  }

  return out;
};

const writeAscii = (view: DataView, offset: number, text: string) => {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
};

export const encodeWavPcm16Mono = (pcm16: Int16Array, sampleRateHz: number): Uint8Array => {
  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
    throw new Error("Invalid sample rate");
  }

  const bytesPerSample = 2;
  const numChannels = 1;
  const bitsPerSample = 16;
  const dataSize = pcm16.length * bytesPerSample;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);

  // RIFF header
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, totalSize - 8, true);
  writeAscii(view, 8, "WAVE");

  // fmt chunk
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRateHz, true);
  view.setUint32(28, sampleRateHz * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, bitsPerSample, true);

  // data chunk
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let byteOffset = 44;
  for (let i = 0; i < pcm16.length; i += 1) {
    view.setInt16(byteOffset, pcm16[i], true);
    byteOffset += 2;
  }

  return new Uint8Array(buffer);
};

type AudioBufferLike = {
  sampleRate: number;
  numberOfChannels: number;
  getChannelData: (channelIndex: number) => Float32Array;
};

export const audioBufferToWav16kMono = (audioBuffer: AudioBufferLike): Uint8Array => {
  const channels: Float32Array[] = [];
  for (let c = 0; c < audioBuffer.numberOfChannels; c += 1) {
    channels.push(audioBuffer.getChannelData(c));
  }

  const mono = downmixToMono(channels);
  const resampled = resampleLinear(mono, audioBuffer.sampleRate, 16000);
  const pcm16 = floatToPcm16(resampled);
  return encodeWavPcm16Mono(pcm16, 16000);
};
