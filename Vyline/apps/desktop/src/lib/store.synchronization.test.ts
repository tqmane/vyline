import { afterEach, expect, spyOn, test } from "bun:test";
import { api } from "../api/client.js";
import { useStore, type Message } from "./store.js";

const initial = useStore.getState();
afterEach(() => useStore.setState(initial, true));
const chatId = "u-sync-peer";
const chat = {
  id: chatId,
  type: "friend" as const,
  name: "Fixture",
  avatar: "F",
  color: "#123456",
  status: "",
  unread: 13,
  lastMessageId: "100",
  lastMessageTime: 1000,
  lastMessagePreview: "older",
};
const rawChat = (id = "100", unreadCount = 13) => ({
  mid: chatId,
  name: "Fixture",
  kind: "direct" as const,
  hasMessages: true,
  unreadCount,
  lastMessageId: id,
  lastMessageTime: Number(id) * 10,
  lastMessagePreview: "server",
});
const wire = (id: string, mine = false, contentType = "TEXT") => ({
  id,
  from: mine ? "u-self" : chatId,
  to: mine ? chatId : "u-self",
  isMyMessage: mine,
  contentType,
  text: "fixture",
  createdTime: Number(id) * 10,
});
function fixture(accountId: string) {
  useStore.setState(
    {
      ...initial,
      accountId,
      demoMode: false,
      activeChatId: null,
      self: { ...initial.self, mid: "u-self" },
      settings: { ...initial.settings, readReceipts: false },
      chats: [chat],
      messages: [],
    },
    true,
  );
}

test("local reads survive a stale list refresh, bootstrap and reload without sending receipts", async () => {
  fixture("local-read-sync");
  useStore.setState({
    messages: [
      {
        id: "100",
        chatId,
        authorId: chatId,
        kind: "text",
        text: "fixture",
        createdAt: 1000,
        status: "sent",
        read: false,
        messageState: "normal",
      },
    ],
  });
  const checked = spyOn(api.line, "markAsRead").mockResolvedValue({ ok: true });
  const time = spyOn(Date, "now").mockReturnValue(100_000);
  const list = spyOn(api.line, "chats").mockResolvedValue({ ok: true, chats: [rawChat()] });
  try {
    await useStore.getState().markChatRead(chatId);
    time.mockReturnValue(200_000);
    await useStore.getState().refreshChatsSilently();
    expect(useStore.getState().chats[0]?.unread).toBe(0);
    const saved = { localReadMarks: useStore.getState().localReadMarks };
    useStore.setState(
      { ...initial, ...saved, accountId: "local-read-sync", activeChatId: null, messages: [] },
      true,
    );
    useStore
      .getState()
      .hydrateLineData({
        profile: null,
        chats: [rawChat()],
        messages: [],
        hiddenMids: new Set(),
        contactCache: new Map(),
      });
    expect(useStore.getState().chats[0]?.unread).toBe(0);
    expect(checked).not.toHaveBeenCalled();
    await useStore.getState().refreshChatsSilently();
    expect(useStore.getState().chats[0]?.unread).toBe(0);
    list.mockResolvedValue({ ok: true, chats: [rawChat("101", 14)] });
    await useStore.getState().refreshChatsSilently();
    expect(useStore.getState().chats[0]?.unread).toBe(1);
  } finally {
    checked.mockRestore();
    time.mockRestore();
    list.mockRestore();
  }
});

test("per-chat receipt disable keeps local reading isolated from another account", async () => {
  fixture("local-chat-disable");
  useStore.setState({
    settings: { ...initial.settings, readReceipts: true },
    readDisabledMids: { [chatId]: true },
    messages: [
      {
        id: "100",
        chatId,
        authorId: chatId,
        kind: "text",
        text: "fixture",
        createdAt: 1000,
        status: "sent",
        read: false,
        messageState: "normal",
      },
    ],
  });
  const checked = spyOn(api.line, "markAsRead").mockResolvedValue({ ok: true });
  const list = spyOn(api.line, "chats").mockResolvedValue({ ok: true, chats: [rawChat()] });
  try {
    await useStore.getState().markChatRead(chatId);
    await useStore.getState().refreshChatsSilently();
    expect(useStore.getState().chats[0]?.unread).toBe(0);
    expect(checked).not.toHaveBeenCalled();
    useStore.setState({ accountId: "other-local-read-account", messages: [] });
    await useStore.getState().refreshChatsSilently();
    expect(useStore.getState().chats[0]?.unread).toBe(13);
  } finally {
    checked.mockRestore();
    list.mockRestore();
  }
});

test("bootstrap also reconciles an acknowledged media upload", () => {
  fixture("media-bootstrap-sync");
  useStore.setState({
    activeChatId: chatId,
    messages: [
      {
        id: "pending_image",
        confirmedMessageId: "200",
        chatId,
        authorId: "me",
        kind: "image",
        imageSrc: "blob:fixture",
        createdAt: 2000,
        status: "sent",
        read: false,
        messageState: "normal",
      },
    ],
  });
  useStore
    .getState()
    .hydrateLineData({
      profile: null,
      chats: [rawChat("200", 0)],
      messages: [wire("200", true, "IMAGE")] as never,
      hiddenMids: new Set(),
      contactCache: new Map(),
    });
  expect(useStore.getState().messages.map((message) => message.id)).toEqual(["200"]);
});

test("replayed listed messages are not counted as new unread messages after a reload", () => {
  fixture("listed-unread-sync");
  useStore.setState({ chats: [{ ...chat, unread: 0 }] });
  useStore
    .getState()
    .mergeIncomingMessages(chatId, [wire("90"), wire("100"), wire("101")] as never);
  expect(useStore.getState().chats[0]?.unread).toBe(1);
});

test("an older zero-unread snapshot cannot erase a just-received unread message", async () => {
  fixture("stale-zero-sync");
  useStore.setState({ chats: [{ ...chat, unread: 0, serverUnreadCount: 0 }] });
  await useStore.getState().markChatRead(chatId);
  useStore.getState().mergeIncomingMessages(chatId, [wire("101")] as never);
  expect(useStore.getState().chats[0]?.unread).toBe(1);
  const list = spyOn(api.line, "chats").mockResolvedValue({ ok: true, chats: [rawChat("100", 0)] });
  try {
    await useStore.getState().refreshChatsSilently();
    expect(useStore.getState().chats[0]?.unread).toBe(1);
  } finally {
    list.mockRestore();
  }
});

test("partial local reading retains unread messages that are not loaded yet", async () => {
  fixture("partial-local-read-sync");
  useStore.setState({
    chats: [
      { ...chat, lastMessageId: "103", lastMessageTime: 1030, unread: 3, serverUnreadCount: 3 },
    ],
    messages: [101, 102].map((id) => ({
      id: String(id),
      chatId,
      authorId: chatId,
      kind: "text",
      text: "fixture",
      createdAt: id * 10,
      status: "sent",
      read: false,
      messageState: "normal",
    })),
  });
  const checked = spyOn(api.line, "markAsRead").mockResolvedValue({ ok: true });
  const list = spyOn(api.line, "chats").mockResolvedValue({ ok: true, chats: [rawChat("103", 3)] });
  try {
    await useStore.getState().markChatRead(chatId, "101", { forceReceipt: true });
    expect(useStore.getState().chats[0]?.unread).toBe(2);
    await useStore.getState().refreshChatsSilently();
    expect(useStore.getState().chats[0]?.unread).toBe(2);
    list.mockResolvedValue({ ok: true, chats: [rawChat("103", 2)] });
    await useStore.getState().refreshChatsSilently();
    expect(useStore.getState().chats[0]?.unread).toBe(2);
    await useStore.getState().refreshChatsSilently();
    expect(useStore.getState().chats[0]?.unread).toBe(2);
    list.mockResolvedValue({ ok: true, chats: [rawChat("104", 3)] });
    await useStore.getState().refreshChatsSilently();
    expect(useStore.getState().chats[0]?.unread).toBe(3);
  } finally {
    checked.mockRestore();
    list.mockRestore();
  }
});

test("an older manual read cannot revive locally read rows after history is reloaded", async () => {
  fixture("old-local-read-sync");
  const messages: Message[] = [101, 102, 103].map((id) => ({
    id: String(id),
    chatId,
    authorId: chatId,
    kind: "text",
    text: "fixture",
    createdAt: id * 10,
    status: "sent",
    read: false,
    messageState: "normal",
  }));
  useStore.setState({
    chats: [
      { ...chat, lastMessageId: "103", lastMessageTime: 1030, unread: 3, serverUnreadCount: 3 },
    ],
    messages,
  });
  const checked = spyOn(api.line, "markAsRead").mockResolvedValue({ ok: true });
  const list = spyOn(api.line, "chats").mockResolvedValue({ ok: true, chats: [rawChat("104", 4)] });
  try {
    await useStore.getState().markChatRead(chatId);
    useStore.setState({ messages });
    await useStore.getState().markChatRead(chatId, "101", { forceReceipt: true });
    expect(useStore.getState().chats[0]?.unread).toBe(0);
    await useStore.getState().refreshChatsSilently();
    expect(useStore.getState().chats[0]?.unread).toBe(1);
  } finally {
    checked.mockRestore();
    list.mockRestore();
  }
});

test("delta reconciles one confirmed media row without dropping other pending uploads", () => {
  fixture("media-delta-sync");
  const pending: Message = {
    id: "pending_batch_one",
    confirmedMessageId: "200",
    chatId,
    authorId: "me",
    kind: "image",
    imageSrc: "blob:fixture",
    createdAt: 2000,
    status: "sent",
    read: false,
    messageState: "normal",
  };
  useStore.setState({
    messages: [
      pending,
      { ...pending, id: "pending_batch_two", confirmedMessageId: "201", createdAt: 2001 },
    ],
  });
  useStore
    .getState()
    .mergeIncomingMessages(chatId, [wire("200", true, "IMAGE")] as never, { silent: true });
  expect(useStore.getState().messages.map((message) => message.id)).toEqual([
    "200",
    "pending_batch_two",
  ]);
});

test("history with an acknowledged non-pending upload does not retain both local and server rows", async () => {
  fixture("media-history-sync");
  useStore.setState({
    messages: [
      {
        id: "local-accepted",
        confirmedMessageId: "200",
        chatId,
        authorId: "me",
        kind: "image",
        imageSrc: "blob:fixture",
        createdAt: 2000,
        status: "sent",
        read: false,
        messageState: "normal",
      },
    ],
  });
  const history = spyOn(api.line, "messages").mockResolvedValue({
    ok: true,
    messages: [wire("200", true, "IMAGE")] as never,
  });
  try {
    await useStore.getState().refreshMessages(chatId, { force: true });
    expect(useStore.getState().messages.map((message) => message.id)).toEqual(["200"]);
  } finally {
    history.mockRestore();
  }
});
