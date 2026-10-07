import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { api, type Announcement } from "../api/client.js";
import { type Message, useStore } from "./store.js";

const initial = useStore.getState();
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
let restore: (() => void)[];
const message: Message = {
  id: "shared-message", chatId: "shared-chat", authorId: "me", kind: "text",
  text: "original", createdAt: Date.now(), status: "sent", read: false,
  messageState: "normal", showOriginal: true,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  restore = [];
  Object.defineProperty(globalThis, "window", { configurable: true, value: { alert: () => {} } });
  useStore.setState({ ...initial, accountId: "account-a", demoMode: false,
    activeChatId: "other-pane", messages: [{ ...message }], notice: null,
    blockedMids: [], lockedChatMids: [], announcements: {},
  }, true);
});

afterEach(() => {
  for (const undo of restore) undo();
  useStore.setState(initial, true);
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

test("same-account bootstrap preserves persisted drafts while an account switch clears them", () => {
  const sync = spyOn(useStore.getState(), "syncChatLocks").mockResolvedValue();
  restore.push(() => sync.mockRestore());
  useStore.getState().setDraft("shared-chat", "unfinished");
  const { drafts, draftSticons, draftMentions, draftAccountId } = useStore.getState();
  const saved = { drafts, draftSticons, draftMentions, draftAccountId };
  useStore.setState({ ...initial, ...saved, accountId: null, demoMode: false, syncChatLocks: async () => {} }, true);
  useStore.getState().setAccountId("account-a");
  useStore.getState().resetAccountData({ preserveDrafts: true });
  expect(useStore.getState().drafts["shared-chat"]).toBe("unfinished");
  useStore.getState().setAccountId("account-b");
  useStore.getState().resetAccountData({ preserveDrafts: true });
  expect(useStore.getState().drafts).toEqual({});
});

for (const outcome of ["success", "failure"] as const) test(`retired retry ${outcome} cannot alter a later account session`, async () => {
  const result = deferred<Awaited<ReturnType<typeof api.line.send>>>();
  const request = spyOn(api.line, "send").mockImplementation(() => result.promise);
  restore.push(() => request.mockRestore());
  useStore.setState({ messages: [{ ...message, status: "failed", retry: { kind: "text", text: "old retry" } }] });
  const pending = useStore.getState().retryMessage(message.id);
  roundTrip();
  const before = useStore.getState();
  result.resolve(outcome === "success" ? { ok: true, message: { id: "retry-confirmed", from: "self", to: message.chatId, text: "old retry", contentType: "NONE", createdTime: Date.now(), isMyMessage: true } } : { ok: false, error: "offline" });
  await pending;
  expect(useStore.getState().messages).toBe(before.messages);
  expect(useStore.getState().chats).toBe(before.chats);
});

test("history does not consume a failed identical message as an earlier successful send", async () => {
  const now = Date.now();
  const failed = { ...message, id: "pending_failed", status: "failed" as const, text: "OK", createdAt: now };
  useStore.setState({ messages: [failed] });
  const history = spyOn(api.line, "messages").mockResolvedValue({ ok: true, messages: [
    { id: "previous-ok", from: "self", to: message.chatId, text: "OK", createdTime: now - 30_000, contentType: "NONE", isMyMessage: true },
  ] } as never);
  restore.push(() => history.mockRestore());
  await useStore.getState().refreshMessages(message.chatId, { force: true });
  expect(useStore.getState().messages.some(item => item.id === failed.id && item.status === "failed")).toBe(true);
});

function roundTrip() {
  // The same account alias returning must not revive an old operation.
  useStore.setState({ accountId: "account-b" });
  useStore.setState({ accountId: "account-a", messages: [{ ...message, text: "fresh session" }] });
}

test("a retired block-list response cannot change the fresh account's send eligibility", async () => {
  const response = deferred<Awaited<ReturnType<typeof api.line.blockedContacts>>>();
  const spy = spyOn(api.line, "blockedContacts").mockImplementation(() => response.promise);
  restore.push(() => spy.mockRestore());
  const pending = useStore.getState().syncBlockedMids();
  roundTrip();
  response.resolve({ ok: true, mids: [message.chatId] });
  await pending;
  expect(useStore.getState().isBlockedMid(message.chatId)).toBe(false);
});

test("a retired announcement response cannot display text in a shared chat", async () => {
  const response = deferred<Awaited<ReturnType<typeof api.line.announce.list>>>();
  const spy = spyOn(api.line.announce, "list").mockImplementation(() => response.promise);
  restore.push(() => spy.mockRestore());
  const pending = useStore.getState().loadAnnouncements(message.chatId);
  roundTrip();
  response.resolve({ ok: true, data: [{ announcementSeq: "1", text: "old account" } as Announcement] });
  await pending;
  expect(useStore.getState().announcements[message.chatId]).toBeUndefined();
});

test("a retired lock-list response cannot lock the fresh account's shared chat", async () => {
  const response = deferred<Awaited<ReturnType<typeof api.line.getChatLocks>>>();
  const spy = spyOn(api.line, "getChatLocks").mockImplementation(() => response.promise);
  restore.push(() => spy.mockRestore());
  const pending = useStore.getState().syncChatLocks();
  roundTrip();
  response.resolve({ ok: true, chatMids: [message.chatId] });
  await pending;
  expect(useStore.getState().lockedChatMids).toEqual([]);
});

for (const operation of ["edit", "revoke"] as const) {
  for (const outcome of ["success", "failure", "rejection"] as const) {
    test(`retired ${operation} ${outcome} cannot roll back, notify or refresh a new session`, async () => {
      const response = deferred<Awaited<ReturnType<typeof api.line.editMessage>>>();
      const requestSpy = operation === "edit"
        ? spyOn(api.line, "editMessage").mockImplementation(() => response.promise)
        : spyOn(api.line, "unsend").mockImplementation(async () => await response.promise as Awaited<ReturnType<typeof api.line.unsend>>);
      const refreshSpy = spyOn(useStore.getState(), "refreshMessages").mockResolvedValue();
      const noticeSpy = spyOn(useStore.getState(), "showNotice").mockImplementation(() => {});
      const alertSpy = spyOn(window, "alert");
      restore.push(() => requestSpy.mockRestore(), () => refreshSpy.mockRestore(),
        () => noticeSpy.mockRestore(), () => alertSpy.mockRestore());
      const pending = operation === "edit"
        ? useStore.getState().editMessage(message.id, "edited")
        : useStore.getState().revokeMessage(message.id);
      roundTrip();
      if (outcome === "rejection") response.reject(new Error("offline"));
      else response.resolve(outcome === "success" ? { ok: true } : { ok: false, error: "rejected" });
      await pending;
      expect(useStore.getState().messages[0]).toEqual({ ...message, text: "fresh session" });
      expect(refreshSpy).not.toHaveBeenCalled();
      expect(noticeSpy).not.toHaveBeenCalled();
      expect(alertSpy).not.toHaveBeenCalled();
    });
  }
}

for (const kind of ["text", "sticker", "combination", "emoji", "audio"] as const) {
  test(`late ${kind} send completion cannot insert messages or refresh another account`, async () => {
    const response = deferred<Awaited<ReturnType<typeof api.line.send>>>();
    const requestSpy = kind === "sticker" ? spyOn(api.line, "sendSticker")
      : kind === "combination" ? spyOn(api.line, "sendCombinationSticker")
      : kind === "emoji" ? spyOn(api.line, "sendEmoji")
      : kind === "audio" ? spyOn(api.line, "sendMedia") : spyOn(api.line, "send");
    requestSpy.mockImplementation(() => response.promise);
    restore.push(() => requestSpy.mockRestore());
    const scheduled: (() => void)[] = [];
    const fakeTimer = (callback: TimerHandler) => {
      scheduled.push(callback as () => void);
      return 1 as unknown as ReturnType<typeof setTimeout>;
    };
    const timerSpy = spyOn(globalThis, "setTimeout").mockImplementation(
      fakeTimer as unknown as typeof setTimeout);
    restore.push(() => timerSpy.mockRestore());
    const state = useStore.getState();
    if (kind === "text") await state.sendMessage(message.chatId, "account A text");
    else if (kind === "sticker") await state.sendSticker(message.chatId, "1", "2");
    else if (kind === "combination") await state.sendCombinationSticker(message.chatId, [{ packageId: "1", stickerId: "2" }]);
    else if (kind === "emoji") await state.sendLineEmoji(message.chatId, "1", "2");
    else await state.sendAudio(message.chatId, 1, new Blob(["audio"], { type: "audio/webm" }));
    useStore.setState({ accountId: "account-b", messages: [] });
    response.resolve({ ok: true, message: { id: "confirmed-A", from: "u-self", to: message.chatId, text: "account A text",
      contentType: "NONE", createdTime: Date.now(), isMyMessage: true } });
    // Drain the response continuations without waiting for a debounce timer.
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(useStore.getState().messages).toEqual([]);
    expect(scheduled).toEqual([]);
  });
}

for (const outcome of ["failure", "rejection"] as const) {
  test(`edit ${outcome} restores the original display and edit metadata`, async () => {
    const spy = spyOn(api.line, "editMessage").mockImplementation(async () => {
      if (outcome === "rejection") throw new Error("offline");
      return { ok: false, error: "rejected" };
    });
    restore.push(() => spy.mockRestore());
    await useStore.getState().editMessage(message.id, "edited");
    expect(useStore.getState().messages[0]).toEqual(message);
  });
}

for (const operation of ["edit", "revoke"] as const) {
  test(`${operation} refreshes its own chat when another split pane is focused`, async () => {
    const requestSpy = operation === "edit"
      ? spyOn(api.line, "editMessage").mockResolvedValue({ ok: true })
      : spyOn(api.line, "unsend").mockResolvedValue({ ok: true } as Awaited<ReturnType<typeof api.line.unsend>>);
    const refreshSpy = spyOn(useStore.getState(), "refreshMessages").mockResolvedValue();
    const noticeSpy = spyOn(useStore.getState(), "showNotice").mockImplementation(() => {});
    restore.push(() => requestSpy.mockRestore(), () => refreshSpy.mockRestore(), () => noticeSpy.mockRestore());
    if (operation === "edit") await useStore.getState().editMessage(message.id, "edited");
    else await useStore.getState().revokeMessage(message.id);
    expect(refreshSpy).toHaveBeenCalledWith(message.chatId, { force: true });
  });
}
