import { describe, expect, it } from "bun:test";
import { chatEventText } from "./mappers.js";

describe("chatEventText", () => {
  it("uses the new group name instead of the actor MID for C_PN", () => {
    const actorMid = "u0123456789abcdef0123456789abcdef";

    expect(
      chatEventText("CHATEVENT", {
        LOC_KEY: "C_PN",
        LOC_ARGS: `${actorMid}\x1e新しいグループ名`,
      }),
    ).toBe("グループ名が「新しいグループ名」に変更されました");
  });

  it("keeps compatibility with a single non-MID C_PN argument", () => {
    expect(
      chatEventText("CHATEVENT", {
        LOC_KEY: "C_PN",
        LOC_ARGS: "旧形式のグループ名",
      }),
    ).toBe("グループ名が「旧形式のグループ名」に変更されました");
  });

  it("never exposes an actor MID as the renamed group name", () => {
    expect(
      chatEventText("CHATEVENT", {
        LOC_KEY: "C_PN",
        LOC_ARGS: "u0123456789abcdef0123456789abcdef",
      }),
    ).toBe("グループ名が変更されました");
  });
});
