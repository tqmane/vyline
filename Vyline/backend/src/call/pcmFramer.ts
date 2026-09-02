export const CALL_PCM_SAMPLE_RATE = 48_000;
export const CALL_PCM_FRAME_DURATION_MS = 20;
export const CALL_PCM_FRAME_SAMPLES =
  (CALL_PCM_SAMPLE_RATE * CALL_PCM_FRAME_DURATION_MS) / 1000;

export interface FramedCallPcm {
  frames: Int16Array[];
  pending: Int16Array;
}

/**
 * Browser audio callbacks are not aligned to Opus frame boundaries.
 * Keep the remainder between packets and emit only exact 20 ms mono frames.
 */
export function frameCallPcm(pending: Int16Array, incoming: Int16Array): FramedCallPcm {
  if (incoming.length === 0) {
    return { frames: [], pending };
  }

  const combined = new Int16Array(pending.length + incoming.length);
  combined.set(pending);
  combined.set(incoming, pending.length);

  const frameCount = Math.floor(combined.length / CALL_PCM_FRAME_SAMPLES);
  const frames = new Array<Int16Array>(frameCount);
  for (let index = 0; index < frameCount; index++) {
    const offset = index * CALL_PCM_FRAME_SAMPLES;
    frames[index] = combined.slice(offset, offset + CALL_PCM_FRAME_SAMPLES);
  }

  return {
    frames,
    pending: combined.slice(frameCount * CALL_PCM_FRAME_SAMPLES),
  };
}
