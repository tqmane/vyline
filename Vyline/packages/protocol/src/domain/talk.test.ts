import { describe, expect, test } from "bun:test";
import { TalkDomain } from "./talk.js";

describe("TalkDomain.markRead", () => {
  test("uses a persisted request sequence and an explicit session id", async () => {
    let sent: Record<string, unknown> | undefined;
    const client = {
      base: {
        getReqseq: async () => 17,
        talk: {
          sendChatChecked: async (value: Record<string, unknown>) => {
            sent = value;
          },
        },
      },
    };

    await new TalkDomain(client as never).markRead(
      "c0123456789abcdef0123456789abcdef",
      "123456789",
    );

    expect(sent).toEqual({
      seq: 17,
      chatMid: "c0123456789abcdef0123456789abcdef",
      lastMessageId: "123456789",
      sessionId: 0,
    });
  });
});
