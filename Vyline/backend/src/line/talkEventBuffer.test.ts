import { expect, test } from "bun:test";
import { clearTalkEvents, drainTalkEvents, pushTalkEvent } from "./talkEventBuffer.js";

test("incoming Talk call event exposes only the verified chat id", () => {
  const accountId = "call-event-sanitize";
  clearTalkEvents(accountId);
  try {
    pushTalkEvent(accountId, {
      kind: "call:incoming",
      chatMid: "c-chat-1",
      callerMid: "u-unverified-caller",
      callType: "video",
    });

    const result = drainTalkEvents(accountId, 0);
    expect(result.events).toEqual([
      {
        kind: "call:incoming",
        chatMid: "c-chat-1",
        seq: 1,
      },
    ]);
  } finally {
    clearTalkEvents(accountId);
  }
});
