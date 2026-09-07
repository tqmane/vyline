import { expect, test } from "bun:test";
import { matchesKmpContext, readComposeAction, isKmpChatInteraction } from "./compose-contract";

test("tab/global commands never reactivate the previously focused conversation", () => {
  expect(isKmpChatInteraction("pane-focus")).toBe(false);
  expect(isKmpChatInteraction("pane-close")).toBe(false);
  expect(isKmpChatInteraction("settings")).toBe(false);
  expect(isKmpChatInteraction("close-details")).toBe(false);
  expect(isKmpChatInteraction("draft")).toBe(true);
  expect(isKmpChatInteraction("chat-details")).toBe(true);
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
  expect(matchesKmpContext({ action: "draft", epoch: 1, chatId: "a" }, 1, "a")).toBe(true);
  expect(matchesKmpContext({ action: "draft", epoch: 1, chatId: "a" }, 1, "b")).toBe(false);
  expect(matchesKmpContext({ action: "send", epoch: 1, chatId: "a" }, 2, "a")).toBe(false);
  expect(matchesKmpContext({ type: "files", epoch: 1, chatId: "a" }, 1, null)).toBe(false);
  expect(matchesKmpContext({ action: "settings", epoch: 1 }, 1, null)).toBe(true);
  expect(matchesKmpContext({ action: "send", chatId: "a" }, 1, "a")).toBe(false);
});
