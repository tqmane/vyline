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
