import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { api } from "../api/client.js";
import { useStore } from "./store.js";
import type { Message } from "./store-types.js";

const initial = useStore.getState();
afterEach(() => { mock.restore(); useStore.setState(initial, true); });
const original: Message = { id: "100", chatId: "c-fixture", authorId: "u-peer", kind: "image", text: "original",
  imageSrc: "/saved-photo", createdAt: 1000, status: "sent", read: false, messageState: "normal",
  readBy: ["u-reader"], readByAt: { "u-reader": 1234 } };

test("repeated revoke events retain one original snapshot and history entry", () => {
  useStore.setState({ accountId: "retention-ui", messages: [original] });
  useStore.getState().applyRevoked(original.chatId, original.id);
  useStore.getState().applyRevoked(original.chatId, original.id);
  const revoked = useStore.getState().messages[0];
  expect(revoked?.revokedSnapshot).toMatchObject({ text: "original", imageSrc: "/saved-photo" });
  expect(revoked?.history).toHaveLength(1);
  expect(revoked?.readByAt).toEqual(original.readByAt);
});

test("local deletion waits for success and suppresses stale incoming responses", async () => {
  const accountId = "retention-ui-delete";
  const revoked: Message = { ...original, messageState: "revoked-by-other", revokedSnapshot: original };
  useStore.setState({ accountId, demoMode: false, messages: [revoked] });
  const apiDelete = spyOn(api.line, "deleteLocalMessage").mockResolvedValue({ ok: false, error: "fixture failure" });
  await expect(useStore.getState().deleteLocalMessage(original.chatId, original.id)).rejects.toThrow("fixture failure");
  expect(useStore.getState().messages).toHaveLength(1);
  apiDelete.mockResolvedValue({ ok: true });
  await useStore.getState().deleteLocalMessage(original.chatId, original.id);
  useStore.getState().mergeIncomingMessages(original.chatId, [{ id: original.id, from: "u-peer", to: original.chatId,
    text: "stale original", contentType: "NONE", createdTime: 1000, isMyMessage: false }]);
  expect(useStore.getState().messages).toEqual([]);
});

test("retention regression: stale hydration cannot restore an explicitly deleted original", async () => {
  const accountId = "retention-ui-stale-hydrate";
  const chatId = "c-retention-stale-hydrate";
  const kept: Message = { ...original, id: "99", chatId, text: "remaining original", createdAt: 900 };
  const deleted: Message = { ...original, chatId, messageState: "revoked-by-other",
    revokedSnapshot: { ...original, chatId } };
  useStore.setState({ accountId, demoMode: false, activeChatId: chatId, chatPaneIds: [chatId], messages: [kept, deleted] });
  spyOn(api.line, "deleteLocalMessage").mockResolvedValue({ ok: true });
  await useStore.getState().deleteLocalMessage(chatId, deleted.id);
  expect(useStore.getState().messages.map(message => message.id)).toEqual([kept.id]);

  const wireOriginal = { id: deleted.id, from: "u-peer", to: chatId, text: "original", contentType: "IMAGE",
    createdTime: 1000, isMyMessage: false, readByAt: { "u-reader": 1234 } };
  const payload = { profile: null,
    chats: [{ mid: chatId, name: "fixture", kind: "group" as const, hasMessages: true, lastMessageTime: 1000 }],
    messages: [{ ...wireOriginal, text: null, contentType: "UNSENT", messageState: "revoked-by-other" as const,
      revokedSnapshot: wireOriginal }], hiddenMids: new Set<string>(), contactCache: new Map() };
  useStore.getState().hydrateLineData(payload);
  useStore.getState().hydrateLineData({ ...payload, messages: [wireOriginal] });
  expect(useStore.getState().messages).toEqual([kept]);
});
