import { describe, expect, it, spyOn } from "bun:test";
import type { VylineGroupLite } from "./vylineCache.js";
import { vylineGroupNeedsRefresh, vylineRemoveGroupMembers } from "./vylineCache.js";
import { VylineStorage } from "./vylineStorage.js";

const MID_A = `u${"a".repeat(32)}`;
const MID_B = `u${"b".repeat(32)}`;

function group(overrides: Partial<VylineGroupLite> = {}): VylineGroupLite {
  return {
    chatMid: `c${"c".repeat(32)}`,
    name: "Group",
    memberMids: [MID_A, MID_B],
    members: [
      { mid: MID_A, displayName: "Alice" },
      { mid: MID_B, displayName: "Bob" },
    ],
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe("vylineGroupNeedsRefresh", () => {
  it("keeps a fresh fully-resolved group cache", () => {
    expect(vylineGroupNeedsRefresh(group())).toBe(false);
  });

  it("refreshes when even one member name is still a MID", () => {
    expect(
      vylineGroupNeedsRefresh(
        group({
          members: [
            { mid: MID_A, displayName: "Alice" },
            { mid: MID_B, displayName: MID_B },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("refreshes when the cached member details are incomplete", () => {
    expect(
      vylineGroupNeedsRefresh(
        group({
          members: [{ mid: MID_A, displayName: "Alice" }],
        }),
      ),
    ).toBe(true);
  });
});

it("removes successful kicks from both cache lists, including the final member", async () => {
  const entry = group();
  const db = { groups: { [entry.chatMid]: entry } };
  const mutate = spyOn(VylineStorage.prototype, "mutate").mockImplementation(async (_account, update) => {
    update(db);
    return db;
  });
  try {
    await vylineRemoveGroupMembers("fixture", entry.chatMid, [MID_A]);
    expect(entry.memberMids).toEqual([MID_B]);
    expect(entry.members.map(member => member.mid)).toEqual([MID_B]);
    expect(entry.name).toBe("Group");
    expect(vylineGroupNeedsRefresh(entry)).toBe(true);
    await vylineRemoveGroupMembers("fixture", entry.chatMid, [MID_B]);
    expect(entry.memberMids).toEqual([]);
    expect(entry.members).toEqual([]);
  } finally {
    mutate.mockRestore();
  }
});

it("rechecks the session after a queued cache mutation becomes ready", async () => {
  const entry = group();
  const original = structuredClone(entry);
  const db = { groups: { [entry.chatMid]: entry } };
  let current = true;
  const queued = Promise.withResolvers<void>();
  const ready = Promise.withResolvers<void>();
  const mutate = spyOn(VylineStorage.prototype, "mutate").mockImplementation(async (_account, update) => {
    queued.resolve();
    await ready.promise;
    update(db);
    return db;
  });
  try {
    const removal = vylineRemoveGroupMembers("fixture", entry.chatMid, [MID_A], () => current);
    await queued.promise;
    current = false;
    ready.resolve();
    await removal;
    expect(entry).toEqual(original);
  } finally {
    mutate.mockRestore();
  }
});
