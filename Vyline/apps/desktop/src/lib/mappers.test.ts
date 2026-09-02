import { describe, expect, it } from "bun:test";
import { chatEventText, mapMessage } from "./mappers.js";

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

describe("mapMessage combination stickers", () => {
  it("keeps the regular STKID as the image fallback and exposes CSSTKID separately", () => {
    const comboId = "0d9c586a-90cb-4139-b14b-56302633e2ce";
    const mapped = mapMessage(
      {
        id: "532860998696335600",
        from: "u0123456789abcdef0123456789abcdef",
        to: "uabcdef0123456789abcdef0123456789",
        text: null,
        contentType: "STICKER",
        createdTime: 1_756_800_000_000,
        isMyMessage: false,
        contentMetadata: {
          CSSTKID: comboId,
          STKID: "651698630",
          STKPKGID: "30563",
          STKVER: "1",
        },
      },
      "uabcdef0123456789abcdef0123456789",
      "account-2",
    );

    expect(mapped.combinationStickerId).toBe(comboId);
    expect(mapped.sticker).toContain("651698630");
    expect(mapped.sticker).not.toContain(comboId);
  });
});
