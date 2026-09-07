import { expect, test } from "bun:test";
import { sameMessageRun } from "./message-grouping";

test("message runs preserve speaker, day, reply and event boundaries", () => {
  const first = {
    authorId: "me",
    createdAt: new Date(2026, 8, 7, 12).getTime(),
    kind: "text" as const,
    messageState: "normal" as const,
  };
  const next = { ...first, createdAt: first.createdAt + 60_000 };
  expect(sameMessageRun(first, next)).toBe(true);
  expect(sameMessageRun(undefined, next)).toBe(false);
  expect(sameMessageRun(first, { ...next, authorId: "other" })).toBe(false);
  expect(sameMessageRun(first, { ...next, createdAt: first.createdAt + 300_001 })).toBe(false);
  expect(sameMessageRun(first, { ...next, createdAt: first.createdAt - 1 })).toBe(false);
  expect(sameMessageRun(first, { ...next, replyToId: "previous" })).toBe(false);
  expect(sameMessageRun(first, { ...next, kind: "system" })).toBe(false);
  expect(sameMessageRun({ ...first, kind: "call" }, next)).toBe(false);
  expect(sameMessageRun({ ...first, messageState: "revoked-by-self" }, next)).toBe(false);
  expect(sameMessageRun(first, { ...next, postNotification: { kind: "note" } })).toBe(false);
  const midnight = new Date(2026, 8, 8).getTime();
  expect(
    sameMessageRun({ ...first, createdAt: midnight - 1 }, { ...next, createdAt: midnight }),
  ).toBe(false);
});
