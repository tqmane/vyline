import { expect, test } from "bun:test";
import {
  matchesKmpContext,
  readComposeAction,
  isKmpChatInteraction,
  publishablePanes,
  type KmpPaneSnapshot,
} from "./compose-contract";

test("tab/global commands never reactivate the previously focused conversation", () => {
  expect(isKmpChatInteraction("pane-focus")).toBe(false);
  expect(isKmpChatInteraction("pane-close")).toBe(false);
  expect(isKmpChatInteraction("settings")).toBe(false);
  expect(isKmpChatInteraction("close-details")).toBe(false);
  expect(isKmpChatInteraction("draft")).toBe(true);
  expect(isKmpChatInteraction("chat-details")).toBe(true);
  expect(isKmpChatInteraction("message-menu")).toBe(true);
});

test("the renderer bridge accepts only versioned presentation commands", () => {
  const event = {
    channel: "vyline-ui",
    version: 1,
    type: "action",
    action: "open",
    id: "chat-1",
    x: 20,
    y: 40,
  };
  expect(readComposeAction(event)).toEqual({
    action: "open",
    id: "chat-1",
    value: undefined,
    x: 20,
    y: 40,
  });
  for (const invalid of [
    null,
    { ...event, action: "sendMessage" },
    { ...event, version: 2 },
    { ...event, channel: "foreign" },
    { ...event, type: "snapshot" },
    { ...event, id: {} },
    { ...event, value: "a".repeat(65_537) },
  ]) {
    expect(readComposeAction(invalid)).toBeNull();
  }
  expect(readComposeAction({ ...event, x: Number.NaN, y: Number.POSITIVE_INFINITY })).toMatchObject(
    { x: 16, y: 16 },
  );
});

test("late native input cannot affect another conversation or account generation", () => {
  expect(matchesKmpContext({ action: "message-menu", epoch: 1, chatId: "a" }, 1, "a")).toBe(true);
  expect(matchesKmpContext({ action: "message-menu", epoch: 1, chatId: "a" }, 1, "b")).toBe(false);
  expect(matchesKmpContext({ action: "message-menu", epoch: 1, chatId: "a" }, 2, "a")).toBe(false);
  expect(matchesKmpContext({ action: "draft", epoch: 1, chatId: "a" }, 1, "a")).toBe(true);
  expect(matchesKmpContext({ action: "draft", epoch: 1, chatId: "a" }, 1, "b")).toBe(false);
  expect(matchesKmpContext({ action: "send", epoch: 1, chatId: "a" }, 2, "a")).toBe(false);
  expect(matchesKmpContext({ type: "files", epoch: 1, chatId: "a" }, 1, null)).toBe(false);
  expect(matchesKmpContext({ action: "settings", epoch: 1 }, 1, null)).toBe(true);
  expect(matchesKmpContext({ action: "send", chatId: "a" }, 1, "a")).toBe(false);
});

test("a split pane whose chat left the chat list is never published to Compose", () => {
  const chat = {
    id: "c-1",
    title: "Kept",
    status: "",
    avatar: "K",
    color: "#000",
    isGroup: true,
    locked: false,
    blocked: false,
  };
  const pane = (id: string, withChat: boolean): KmpPaneSnapshot =>
    ({
      id,
      chat: withChat ? { ...chat, id, title: id } : null,
      messages: [],
      composer: { text: "", mentions: [], sticons: [] },
      history: { loading: false, hasMore: true },
      chatUi: null,
      announcements: [],
      highlightMessageId: null,
      scrollLatest: 0,
      profileOpen: false,
      readersPanel: null,
    }) as unknown as KmpPaneSnapshot;

  const views = { "c-1": pane("c-1", true), "c-2": pane("c-2", true) };

  expect(publishablePanes(["c-1", "c-2"], views).map((p) => p.id)).toEqual(["c-1", "c-2"]);

  // The chat list dropped c-2 while its pane is still mounted.
  expect(publishablePanes(["c-1", "c-2"], { ...views, "c-2": pane("c-2", false) }).map((p) => p.id)).toEqual(
    ["c-1"],
  );

  // No publishable pane means no pane list, not a pane with a null chat.
  expect(publishablePanes(["c-2"], { "c-2": pane("c-2", false) })).toEqual([]);
  expect(publishablePanes(["c-1", "c-missing"], views).map((p) => p.id)).toEqual(["c-1"]);
});
