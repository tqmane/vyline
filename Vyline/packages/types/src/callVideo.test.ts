import { expect, test } from "bun:test";
import { decodeCallVideoFrame, encodeCallVideoFrame } from "./callVideo";

test("video bridge frame preserves VP8 and rejects malformed headers and size", () => {
  const frame = {
    data: new Uint8Array([0x30, 0, 0, 0x9d, 1, 0x2a, 0x80, 2, 0x68, 1, 0, 0]),
    key: true,
    timestamp: 9000,
    rotation: 0,
  };
  const packet = encodeCallVideoFrame(frame);
  expect([...packet.slice(0, 8)]).toEqual([1, 1, 0, 0, 0, 0, 35, 40]);
  expect(decodeCallVideoFrame(packet)).toEqual(frame);
  for (const invalid of [
    packet.slice(0, 8),
    new Uint8Array(1048585),
    new Uint8Array([...packet].map((b, i) => (i === 0 ? 2 : b))),
  ]) {
    expect(() => decodeCallVideoFrame(invalid)).toThrow();
  }
  expect(() => encodeCallVideoFrame({ ...frame, timestamp: Number.NaN })).toThrow();
});
