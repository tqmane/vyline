import { expect, test } from "bun:test";
import { readComposeAction, matchesKmpContext } from "../ui/compose-contract";
import {
  MessageSearchController,
  dispatchSearchCommand,
  searchPresentation,
} from "./searchController";

test("native search commands pass the typed bridge and retain pane/account generation scoping", () => {
  for (const suffix of [
    "regex",
    "more",
    "select",
    "cancel",
    "retry",
    "older",
    "newer",
    "latest",
  ] as const) {
    const event = {
      channel: "vyline-ui",
      version: 1,
      type: "action",
      action: `chat-search-${suffix}`,
      epoch: 2,
      chatId: "pane-a",
      value: "result-id",
    } as const;
    expect(readComposeAction(event)?.action).toBe(event.action);
    expect(matchesKmpContext(event, 2, "pane-a")).toBe(true);
    expect(matchesKmpContext(event, 3, "pane-a")).toBe(false);
    expect(matchesKmpContext(event, 2, "pane-b")).toBe(false);
  }
});

test("native presentation includes regex/errors/paging and dispatch controls the same pane state", () => {
  const controller = new MessageSearchController(
    {
      search: async () => ({ hits: [], nextCursor: null, limit: 100 }),
      context: async () => ({ messages: [], hasOlder: false, hasNewer: false }),
    },
    () => new Set(),
  );
  expect(dispatchSearchCommand(controller, "search")).toBe(true);
  dispatchSearchCommand(controller, "search-regex", "true");
  dispatchSearchCommand(controller, "search-query", "日本語");
  dispatchSearchCommand(controller, "search-cancel");
  expect(searchPresentation(controller.getSnapshot(), { streamerMode: false })).toMatchObject({
    open: true,
    query: "日本語",
    regex: true,
    loading: false,
    contextLoading: false,
    limited: false,
    hasMore: false,
    limit: 100,
    results: [],
    historyWindow: null,
    error: "検索を中断しました",
  });
  expect(dispatchSearchCommand(controller, "join-call")).toBe(false);
  controller.dispose();
});

test("search result presentation applies URL privacy without changing queries, hits or navigation", () => {
  const controller = new MessageSearchController({
    search: async () => ({ hits: [], nextCursor: null, limit: 100 }),
    context: async () => ({ messages: [], hasOlder: false, hasNewer: false }),
  }, () => new Set());
  const text = `前 https://private.example/${"x".repeat(180)}。 後`;
  const state = { ...controller.getSnapshot(), query: "private", hits: [{ id: "old", text, createdTime: 1000, highlight: "private" }] };
  const settings = { streamerMode: true, streamerMaskUrls: true };
  const masked = searchPresentation(state, settings);
  expect(masked.results[0]?.text).toBe("前 [URL]。 後");
  expect(masked.query).toBe("private");
  expect(masked.activeId).toBe("old");
  expect(state.hits[0]?.text).toBe(text);
  expect(searchPresentation(state, { ...settings, streamerMaskUrls: false }).results[0]?.text).toBe(text.slice(0, 160));
  expect(searchPresentation(state, { ...settings, streamerMode: false }).results[0]?.text).toBe(text.slice(0, 160));
  controller.dispose();
});
