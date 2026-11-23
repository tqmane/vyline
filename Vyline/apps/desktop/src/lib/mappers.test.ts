import { describe, expect, it } from "bun:test";
import { chatEventText, mapMessage } from "./mappers.js";

it("other group members' receipts do not mark a received message seen by me", () => {
  const incoming = { id: "101", from: "u-peer", to: "c-group", contentType: "NONE",
    text: "まだ自分は読んでいない", createdTime: Date.now(), isMyMessage: false,
    seen: false, readCount: 2, readBy: ["u-other"] };
  const message = mapMessage(incoming, "c-group", "account");
  expect(message.read).toBe(false);
  expect(message.status).toBe("sent");
  expect(message.readCount).toBe(2);
  expect(mapMessage({ ...incoming, seen: true }, "c-group", "account").read).toBe(true);
  expect(mapMessage({ ...incoming, isMyMessage: true }, "c-group", "account").read).toBe(true);
});

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
  const callMessage = (contentMetadata: Record<string, string>, isMyMessage = true) =>
    mapMessage(
      {
        id: "call-1",
        from: "u0123456789abcdef0123456789abcdef",
        to: "uabcdef0123456789abcdef0123456789",
        text: null,
        contentType: "CALL",
        createdTime: 1_756_800_000_000,
        isMyMessage,
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

  it("maps native call-history results by direction", () => {
    expect(callMessage({ RESULT: "CANCELED" }).callMeta?.outcome).toBe("cancelled");
    expect(callMessage({ RESULT: "CANCELED" }, false).callMeta?.outcome).toBe("missed");
    expect(callMessage({ RESULT: "REJECTED" }).callMeta?.outcome).toBe("no-answer");
    expect(callMessage({ RESULT: "NO_RESPONSE" }).callMeta?.outcome).toBe("no-answer");
    expect(callMessage({ RESULT: "BUSY" }).callMeta?.outcome).toBe("no-answer");
    expect(callMessage({ RESULT: "INFO" }).callMeta?.outcome).toBe("no-answer");
    expect(callMessage({ RESULT: "FAIL" }).callMeta?.outcome).toBe("no-answer");
    expect(callMessage({ RESULT: "FAIL" }, false).callMeta?.outcome).toBe("missed");
    expect(callMessage({ voipResult: "BUSY" }, false).callMeta?.outcome).toBe("missed");
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

describe("mapMessage file filename decoding", () => {
  const fileMessage = (contentMetadata: Record<string, string>) =>
    mapMessage(
      {
        id: "file-1",
        from: "u0123456789abcdef0123456789abcdef",
        to: "uabcdef0123456789abcdef0123456789",
        text: null,
        contentType: "FILE",
        createdTime: 1_756_800_000_000,
        isMyMessage: false,
        contentMetadata,
      },
      "u0123456789abcdef0123456789abcdef",
      "main",
    );

  it("decodes percent-encoded camelCase fileName from E2EE file metadata", () => {
    const mapped = fileMessage({
      fileName: "%E6%94%BF%E6%B2%BB%E7%B5%8C%E6%B8%88_%E5%8F%B390%E5%BA%A6%E5%9B%9E%E8%BB%A2.pdf",
      FILE_SIZE: "4096",
    });
    expect(mapped.kind).toBe("file");
    expect(mapped.file?.name).toBe("政治経済_右90度回転.pdf");
    expect(mapped.file?.size).toBe(4096);
  });

  it("prefers FILE_NAME and falls back cleanly on malformed percent escapes", () => {
    expect(fileMessage({ FILE_NAME: "a/b%20c.txt", fileName: "other.pdf" }).file?.name).toBe("a_b c.txt");
    expect(fileMessage({ fileName: "100%raw.docx" }).file?.name).toBe("100%raw.docx");
  });
});
