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

describe("mapMessage call duration", () => {
  const callMessage = (contentMetadata: Record<string, string>) =>
    mapMessage(
      {
        id: "call-1",
        from: "u0123456789abcdef0123456789abcdef",
        to: "uabcdef0123456789abcdef0123456789",
        text: null,
        contentType: "CALL",
        createdTime: 1_756_800_000_000,
        isMyMessage: true,
        contentMetadata,
      },
      "uabcdef0123456789abcdef0123456789",
      "main",
    );

  it("converts LINE DURATION milliseconds even below ten seconds", () => {
    expect(callMessage({ DURATION: "8000" }).callMeta?.durationSec).toBe(8);
    expect(callMessage({ DURATION: "10000" }).callMeta?.durationSec).toBe(10);
    expect(callMessage({ DURATION: "21000" }).callMeta?.durationSec).toBe(21);
    expect(callMessage({ DURATION: "10500" }).callMeta?.durationSec).toBe(10);
    expect(callMessage({ voipDuration: "10500" }).callMeta?.durationSec).toBe(10);
    expect(callMessage({ duration: "8" }).callMeta?.durationSec).toBe(8);
  });

  it("converts group-call GC_DURATION milliseconds", () => {
    const mapped = callMessage({ GC_DURATION: "7000" });
    expect(mapped.callMeta?.durationSec).toBe(7);
    expect(mapped.callMeta?.group).toBe(true);
  });

  it("ignores invalid call durations", () => {
    expect(callMessage({ DURATION: "0" }).callMeta?.durationSec).toBeUndefined();
    expect(callMessage({ DURATION: "-1" }).callMeta?.durationSec).toBeUndefined();
    expect(callMessage({ DURATION: "invalid" }).callMeta?.durationSec).toBeUndefined();
  });
});

describe("mapMessage audio duration", () => {
  const audioMessage = (contentMetadata: Record<string, string>) =>
    mapMessage(
      {
        id: "audio-1",
        from: "u0123456789abcdef0123456789abcdef",
        to: "uabcdef0123456789abcdef0123456789",
        text: null,
        contentType: "AUDIO",
        createdTime: 1_756_800_000_000,
        isMyMessage: true,
        contentMetadata,
      },
      "uabcdef0123456789abcdef0123456789",
      "main",
    );

  it("converts LINE AUDLEN and DURATION milliseconds at the one-second boundary", () => {
    expect(audioMessage({ AUDLEN: "1000" }).audioSeconds).toBe(1);
    expect(audioMessage({ DURATION: "1500" }).audioSeconds).toBe(1);
  });

  it("treats the OBS lowercase duration as milliseconds", () => {
    expect(audioMessage({ duration: "8000" }).audioSeconds).toBe(8);
  });

  it("floors subsecond audio and ignores invalid durations", () => {
    expect(audioMessage({ AUDLEN: "999" }).audioSeconds).toBe(0);
    expect(audioMessage({ AUDLEN: "0" }).audioSeconds).toBeUndefined();
    expect(audioMessage({ AUDLEN: "-1" }).audioSeconds).toBeUndefined();
    expect(audioMessage({ AUDLEN: "invalid" }).audioSeconds).toBeUndefined();
  });
});
