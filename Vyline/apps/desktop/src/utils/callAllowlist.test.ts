import { expect, test } from "bun:test";
import { canStartCall, readCallParticipants } from "./callAllowlist";

test("group voice and video entries accept only real group IDs", () => {
  expect(canStartCall(`c${"1".repeat(32)}`, "voice")).toBe(true);
  expect(canStartCall(`c${"1".repeat(32)}`, "video")).toBe(true);
  expect(canStartCall("c-invalid", "voice")).toBe(false);
  expect(canStartCall("c-invalid", "video")).toBe(false);
  expect(canStartCall(`r${"1".repeat(32)}`, "video")).toBe(false);
  expect(canStartCall(`u${"1".repeat(32)}`, "video")).toBe(true);
});

test("call participant updates accept bounded valid rosters and explicit empty updates", () => {
  const participant = { mid: `u${"1".repeat(32)}`, hasAudioStream: true, hasVideoStream: false };
  expect(readCallParticipants([participant])).toEqual([participant]);
  expect(readCallParticipants([])).toEqual([]);
  for (const invalid of [
    undefined,
    {},
    [participant, participant],
    [{ ...participant, mid: "u-bad" }],
    [{ ...participant, hasVideoStream: "yes" }],
    new Array(513).fill(participant),
  ]) {
    expect(readCallParticipants(invalid)).toBeUndefined();
  }
});
