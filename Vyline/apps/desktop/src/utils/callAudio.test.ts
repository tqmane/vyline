import { describe, expect, test } from "bun:test";
import { shouldRestartMicTrack, splitPcm16Frames, resampleLinearPcm16 } from "./callAudio";

describe("call microphone framing", () => {
  test("preserves ScriptProcessor leftovers across 20 ms Opus frames", () => {
    const firstInput = Int16Array.from({ length: 4096 }, (_, index) => index);
    const first = splitPcm16Frames(firstInput, new Int16Array(0), 960);

    expect(first.frames).toHaveLength(4);
    expect(first.frames.every((frame) => frame.length === 960)).toBe(true);
    expect(first.frames[3]?.[959]).toBe(3839);
    expect(Array.from(first.remainder)).toEqual(Array.from({ length: 256 }, (_, i) => 3840 + i));

    const secondInput = Int16Array.from({ length: 4096 }, (_, index) => 4096 + index);
    const second = splitPcm16Frames(secondInput, first.remainder, 960);

    expect(second.frames).toHaveLength(4);
    expect(second.frames[0]?.[0]).toBe(3840);
    expect(second.frames[0]?.[255]).toBe(4095);
    expect(second.frames[0]?.[256]).toBe(4096);
    expect(second.frames[3]?.[959]).toBe(7679);
    expect(Array.from(second.remainder)).toEqual(Array.from({ length: 512 }, (_, i) => 7680 + i));
  });

  test("restarts a muted or ended microphone track, but not a healthy live track", () => {
    expect(shouldRestartMicTrack({ muted: false, readyState: "live" })).toBe(false);
    expect(shouldRestartMicTrack({ muted: true, readyState: "live" })).toBe(true);
    expect(shouldRestartMicTrack({ muted: false, readyState: "ended" })).toBe(true);
  });

  test("resamples 16-bit PCM linearly between rates", () => {
    const input = new Int16Array([0, 1000, 2000, 3000]);
    // 44.1k -> 48k: ratio ~ 1.088
    const resampled = resampleLinearPcm16(input, 44100, 48000);
    expect(resampled.length).toBe(4);
    expect(resampled[0]).toBe(0);

    // 2:1 upsampling
    const up = resampleLinearPcm16(new Int16Array([0, 1000]), 1000, 2000);
    expect(up.length).toBe(4);
    expect(up[0]).toBe(0);
    expect(up[1]).toBe(500);
    expect(up[2]).toBe(1000);

    // Identity
    const same = resampleLinearPcm16(input, 48000, 48000);
    expect(same).toBe(input);
  });
});
