import { describe, expect, it } from "bun:test";
import type { VylineGroupLite } from "./vylineCache.js";
import { vylineGroupNeedsRefresh } from "./vylineCache.js";

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
