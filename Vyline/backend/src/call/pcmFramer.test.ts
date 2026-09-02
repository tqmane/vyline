import { describe, expect, it } from "bun:test";
import { CALL_PCM_FRAME_SAMPLES, frameCallPcm } from "./pcmFramer";

function rangeSamples(length: number, offset = 0): Int16Array {
  return Int16Array.from({ length }, (_, index) => offset + index);
}

function flatten(frames: Int16Array[], pending: Int16Array): Int16Array {
  const total = frames.reduce((sum, frame) => sum + frame.length, pending.length);
  const out = new Int16Array(total);
  let offset = 0;
  for (const frame of frames) {
    out.set(frame, offset);
    offset += frame.length;
  }
  out.set(pending, offset);
  return out;
}

describe("call PCM framing", () => {
  it("emits one 20 ms frame for exactly 960 samples", () => {
    const input = rangeSamples(CALL_PCM_FRAME_SAMPLES);
    const result = frameCallPcm(new Int16Array(0), input);

    expect(result.frames).toHaveLength(1);
    expect(result.frames[0]).toEqual(input);
    expect(result.pending).toHaveLength(0);
  });

  it("preserves every sample across 4096-sample browser chunks", () => {
    const first = rangeSamples(4096);
    const firstResult = frameCallPcm(new Int16Array(0), first);

    expect(firstResult.frames).toHaveLength(4);
    expect(firstResult.pending).toHaveLength(256);
    expect(flatten(firstResult.frames, firstResult.pending)).toEqual(first);

    const second = rangeSamples(704, 4096);
    const secondResult = frameCallPcm(firstResult.pending, second);

    expect(secondResult.frames).toHaveLength(1);
    expect(secondResult.frames[0]).toEqual(rangeSamples(CALL_PCM_FRAME_SAMPLES, 3840));
    expect(secondResult.pending).toHaveLength(0);
  });

  it("accumulates sub-frame packets until a complete frame is available", () => {
    const firstResult = frameCallPcm(new Int16Array(0), rangeSamples(400));
    expect(firstResult.frames).toHaveLength(0);
    expect(firstResult.pending).toHaveLength(400);

    const secondResult = frameCallPcm(firstResult.pending, rangeSamples(560, 400));
    expect(secondResult.frames).toHaveLength(1);
    expect(secondResult.frames[0]).toEqual(rangeSamples(CALL_PCM_FRAME_SAMPLES));
    expect(secondResult.pending).toHaveLength(0);
  });
});