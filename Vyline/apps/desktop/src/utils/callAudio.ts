export function shouldRestartMicTrack(track: { muted: boolean; readyState: string }): boolean {
  return track.muted || track.readyState !== "live";
}

export function splitPcm16Frames(
  input: Int16Array<ArrayBufferLike>,
  remainder: Int16Array<ArrayBufferLike>,
  frameSamples: number,
): { frames: Int16Array<ArrayBuffer>[]; remainder: Int16Array<ArrayBuffer> } {
  if (!Number.isInteger(frameSamples) || frameSamples <= 0) {
    throw new Error("frameSamples must be a positive integer");
  }

  const samples =
    remainder.length === 0
      ? input
      : (() => {
          const merged = new Int16Array(remainder.length + input.length);
          merged.set(remainder);
          merged.set(input, remainder.length);
          return merged;
        })();
  const frames: Int16Array<ArrayBuffer>[] = [];
  let offset = 0;
  while (offset + frameSamples <= samples.length) {
    frames.push(samples.slice(offset, offset + frameSamples));
    offset += frameSamples;
  }
  return { frames, remainder: samples.slice(offset) };
}

/** 1ch 16-bit PCM の線形補間リサンプリング */
export function resampleLinearPcm16(
  samples: Int16Array<ArrayBufferLike>,
  fromRate: number,
  toRate: number,
): Int16Array<ArrayBuffer> {
  if (fromRate === toRate || samples.length === 0) {
    return samples instanceof Int16Array && samples.buffer instanceof ArrayBuffer
      ? (samples as Int16Array<ArrayBuffer>)
      : new Int16Array(samples);
  }
  const ratio = toRate / fromRate;
  const outLength = Math.round(samples.length * ratio);
  const out = new Int16Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const srcIndex = i / ratio;
    const i0 = Math.floor(srcIndex);
    const t = srcIndex - i0;
    const a = samples[i0] ?? 0;
    const b = samples[i0 + 1] ?? a;
    out[i] = Math.round(a + (b - a) * t);
  }
  return out;
}
