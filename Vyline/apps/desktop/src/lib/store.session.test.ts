import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { api } from "../api/client";
import { mapMessage } from "./mappers";
import { messagePreview, useStore } from "./store";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const chatId = "u-session-fixture";
const message = (id: string, text = id) => ({
  id, text, from: "u-peer", to: "u-me", contentType: "NONE",
  createdTime: 1, isMyMessage: false,
});
let previous: ReturnType<typeof useStore.getState>;
let restore: Array<() => void>;

beforeEach(() => {
  previous = useStore.getState();
  const locks = spyOn(api.line, "getChatLocks").mockResolvedValue({ ok: true, chatMids: [] });
  restore = [() => locks.mockRestore()];
  useStore.getState().resetAccountData();
  useStore.setState({ accountId: "session-a", demoMode: false });
});

afterEach(async () => {
  useStore.getState().resetAccountData();
  await Promise.resolve();
  useStore.setState(previous, true);
  for (const undo of restore) undo();
});

test("account switches clear all transient composer, profile and loading state", async () => {
  useStore.setState({
    drafts: { [chatId]: "private draft" },
    draftSticons: { [chatId]: [{ productId: "p", sticonId: "s" }] },
    draftMentions: { [chatId]: [{ S: 0, E: 2, name: "A", mid: "u-a" }] },
    replyToId: "old-reply", highlightMessageId: "old-message", customOrder: [chatId],
    memberProfile: { chatId, memberId: "u-a" },
    loadingChats: true, loadingMessages: true, notice: "old notice",
  });
  useStore.getState().setAccountId("session-b");
  expect(useStore.getState()).toMatchObject({
    drafts: {}, draftSticons: {}, draftMentions: {}, replyToId: null,
    highlightMessageId: null, customOrder: [], memberProfile: null,
    loadingChats: false, loadingMessages: false, notice: null,
  });
  await Promise.resolve();
});

for (const transition of ["reset", "switch-back"] as const) {
  test(`a ${transition} rejects old history and lets a fresh request complete independently`, async () => {
    const old = deferred<Awaited<ReturnType<typeof api.line.messages>>>();
    const fresh = deferred<Awaited<ReturnType<typeof api.line.messages>>>();
    const requests = spyOn(api.line, "messages")
      .mockImplementationOnce(() => old.promise)
      .mockImplementationOnce(() => fresh.promise);
    restore.push(() => requests.mockRestore());
    const pendingOld = useStore.getState().refreshMessages(chatId);
    if (transition === "reset") useStore.getState().resetAccountData();
    else {
      useStore.getState().setAccountId("session-b");
      useStore.getState().setAccountId("session-a");
    }
    const pendingFresh = useStore.getState().refreshMessages(chatId);
    expect(requests).toHaveBeenCalledTimes(2);
    old.resolve({ ok: true, messages: [message("old-private-history")] });
    await pendingOld;
    expect(useStore.getState().messages).toEqual([]);
    expect(useStore.getState().loadingMessages).toBe(true);
    fresh.resolve({ ok: true, messages: [message("fresh-history")] });
    await pendingFresh;
    expect(useStore.getState().messages.map((m) => m.id)).toEqual(["fresh-history"]);
    expect(useStore.getState().loadingMessages).toBe(false);
  });
}

test("late block and announcement responses do not fill the next account", async () => {
  const blocks = deferred<Awaited<ReturnType<typeof api.line.blockedContacts>>>();
  const announcements = deferred<Awaited<ReturnType<typeof api.line.announce.list>>>();
  const blockRequest = spyOn(api.line, "blockedContacts").mockImplementation(() => blocks.promise);
  const announcementRequest = spyOn(api.line.announce, "list").mockImplementation(() => announcements.promise);
  restore.push(() => blockRequest.mockRestore(), () => announcementRequest.mockRestore());
  const pending = Promise.all([
    useStore.getState().syncBlockedMids(), useStore.getState().loadAnnouncements(chatId),
  ]);
  useStore.getState().setAccountId("session-b");
  blocks.resolve({ ok: true, mids: ["u-private-block"] });
  announcements.resolve({ ok: true, data: [] });
  await pending;
  expect(useStore.getState().blockedMids).toEqual([]);
  expect(useStore.getState().announcements).toEqual({});
});

test("reset clears opened-chat and read-receipt suppression state", async () => {
  const receipts = spyOn(api.line, "markAsRead").mockResolvedValue({ ok: true });
  const contacts = spyOn(api.line, "contactProfile").mockResolvedValue({ ok: false, error: "fixture" });
  restore.push(() => receipts.mockRestore(), () => contacts.mockRestore());
  useStore.setState({ demoMode: true });
  useStore.getState().openChat(chatId);
  useStore.setState({ demoMode: false, messages: [mapMessage(message("100"), chatId, "session-a")] });
  await useStore.getState().markChatRead(chatId);
  expect(receipts).toHaveBeenCalledTimes(1);
  useStore.getState().resetAccountData();
  useStore.setState({ activeChatId: chatId });
  useStore.getState().mergeIncomingMessages(chatId, [message("100")]);
  expect(receipts).toHaveBeenCalledTimes(1);
  await useStore.getState().markChatRead(chatId);
  expect(receipts).toHaveBeenCalledTimes(2);
});

test("poll reset clears the old in-flight request and ignores its call events", async () => {
  const old = deferred<Awaited<ReturnType<typeof api.line.pollEvents>>>();
  const requests = spyOn(api.line, "pollEvents")
    .mockImplementationOnce(() => old.promise)
    .mockResolvedValue({ ok: true, cursor: 0, events: [] });
  restore.push(() => requests.mockRestore());
  const pendingOld = useStore.getState().pollIncoming();
  useStore.getState().resetAccountData();
  await useStore.getState().pollIncoming();
  expect(requests).toHaveBeenCalledTimes(2);
  old.resolve({ ok: true, cursor: 1, events: [{
    kind: "call:incoming", seq: 1, callMid: "old-call", chatMid: chatId,
    callerMid: "u-peer", callType: "audio", receivedAt: Date.now(),
  }] });
  await pendingOld;
  expect(useStore.getState().incomingCall).toBeNull();
});

test("literal dollars survive previews and reaction changes preserve other messages", () => {
  const target = mapMessage(message("100", "$100"), chatId, "session-a");
  const other = mapMessage(message("200", "$"), chatId, "session-a");
  expect(messagePreview(target)).toBe("$100");
  expect(messagePreview(other)).toBe("$");
  useStore.setState({ messages: [target, other] });
  useStore.getState().setMessageReaction("100", "LOVE", "u-me");
  expect(useStore.getState().messages[0]?.reactions?.[0]?.type).toBe(3);
  useStore.getState().setMessageReaction("100", "NICE", "u-me");
  expect(useStore.getState().messages[0]?.reactions).toHaveLength(1);
  useStore.getState().setMessageReaction("100", "UNDO", "u-me");
  expect(useStore.getState().messages[0]?.reactions).toBeUndefined();
  expect(useStore.getState().messages[1]).toBe(other);
});
