import { afterEach, expect, spyOn, test } from "bun:test";
import { api } from "../api/client.js";
import { type Message, useStore } from "./store.js";

const initial = useStore.getState();
afterEach(() => useStore.setState(initial, true));
const chatId = "c-unread-fixture";
const message: Message = { id: "101", chatId, authorId: "u-peer", kind: "text", text: "未読",
  createdAt: 101, status: "sent", read: false, messageState: "normal" };

test("group receipt refresh preserves my unread state while displaying other readers", async () => {
  useStore.setState({ ...initial, accountId: "unread-account", demoMode: false,
    messages: [message], readWatermarks: {}, self: { ...initial.self, mid: "u-self" },
    chats: [{ id: chatId, type: "group", name: "Fixture", avatar: "T", color: "#123456", unread: 1, status: "" }],
  }, true);
  const spy = spyOn(api.line, "readReceipts").mockResolvedValue({ ok: true,
    memberReadWatermarks: [{ mid: "u-other", upTo: "101" }],
    receipts: { "101": { readCount: 1, readBy: ["u-other"] } },
  });
  const warm = spyOn(api.line, "vylineWarm").mockResolvedValue({ ok: true, profiles: {} });
  const members = spyOn(api.line, "chatMembers").mockResolvedValue({ ok: true, members: [] });
  try {
    await useStore.getState().refreshReadReceipts(chatId, { force: true });
    expect(useStore.getState().messages[0]?.read).toBe(false);
    expect(useStore.getState().messages[0]?.readBy).toContain("u-other");
  } finally { spy.mockRestore(); warm.mockRestore(); members.mockRestore(); }
});

function unreadFixture() {
  useStore.setState({ ...initial, accountId: null, demoMode: true,
    activeChatId: null, chatPaneIds: [], chatPaneSizes: [], focusedChatPane: 0,
    chats: [{ id: chatId, type: "group", name: "Fixture", avatar: "T", color: "#123456", unread: 2, status: "", lastMessageId: "40" }],
    messages: [{ ...message, id: "10", createdAt: 10, read: true },
      { ...message, id: "20", createdAt: 20 }, { ...message, id: "30", createdAt: 30 },
      { ...message, id: "40", authorId: "me", createdAt: 40 }],
  }, true);
}

test("the unread separator remains at the opening boundary after automatic reads and renderer updates", async () => {
  unreadFixture();
  useStore.getState().openChat(chatId);
  expect(useStore.getState().unreadBoundaries?.[chatId]?.messageId).toBe("20");
  await useStore.getState().markChatRead(chatId);
  expect(useStore.getState().chats[0]?.unread).toBe(0);
  expect(useStore.getState().unreadBoundaries?.[chatId]?.messageId).toBe("20");
  useStore.setState({ messages: [...useStore.getState().messages, { ...message, id: "50", createdAt: 50 }] });
  expect(useStore.getState().unreadBoundaries?.[chatId]?.messageId).toBe("20");
  useStore.getState().closeChat();
  expect(useStore.getState().unreadBoundaries?.[chatId]).toBeUndefined();
  useStore.getState().openChat(chatId);
  expect(useStore.getState().unreadBoundaries?.[chatId]?.messageId).toBeNull();
});

test("late history resolves the saved unread count even after local read marking", async () => {
  unreadFixture();
  useStore.setState({ chats: [{ ...useStore.getState().chats[0], unread: 3 }], messages: [{ ...message, id: "30", createdAt: 30 }] });
  useStore.getState().openChat(chatId);
  expect(useStore.getState().unreadBoundaries?.[chatId]?.messageId).toBeNull();
  await useStore.getState().markChatRead(chatId);
  useStore.setState({ messages: [10, 20, 30, 50].map(id => ({ ...message, id: String(id), createdAt: id, read: true })) });
  expect(useStore.getState().unreadBoundaries?.[chatId]?.messageId).toBe("10");
});

test("each pane retains its own boundary and account switching clears all opening boundaries", () => {
  unreadFixture();
  const other = "c-other-unread";
  useStore.setState({ chats: [...useStore.getState().chats, { ...useStore.getState().chats[0], id: other, unread: 1, lastMessageId: "80" }],
    messages: [...useStore.getState().messages, { ...message, chatId: other, id: "80", createdAt: 80 }] });
  useStore.getState().openChat(chatId);
  useStore.getState().openChatInSplit(other);
  useStore.getState().focusChatPane(0);
  expect(useStore.getState().unreadBoundaries?.[chatId]?.messageId).toBe("20");
  expect(useStore.getState().unreadBoundaries?.[other]?.messageId).toBe("80");
  useStore.getState().closeChatPane(1);
  expect(useStore.getState().unreadBoundaries?.[other]).toBeUndefined();
  useStore.getState().setAccountId("new-account");
  expect(useStore.getState().unreadBoundaries).toEqual({});
});
