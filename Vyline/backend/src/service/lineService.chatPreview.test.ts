import { expect, test } from "bun:test";
import { boxMeta } from "./lineService.js";

test("message-box previews describe their cursor rather than an older incoming message", () => {
  const old = { id: "100", text: "old incoming", contentType: "TEXT", deliveredTime: 1000 };
  expect(
    boxMeta({
      lastMessages: [old],
      lastDeliveredMessageId: { messageId: "101", deliveredTime: 1100 },
      unreadCount: 2,
    }),
  ).toMatchObject({
    lastMessageId: "101",
    lastMessageTime: 1100,
    lastMessagePreview: "",
    unreadCount: 2,
  });
  expect(
    boxMeta({
      lastMessages: [old, { ...old, id: "101", text: "latest" }],
      lastDeliveredMessageId: { messageId: "101", deliveredTime: 1100 },
    }).lastMessagePreview,
  ).toBe("latest");
});
