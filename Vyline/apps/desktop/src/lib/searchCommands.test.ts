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
  expect(searchPresentation(controller.getSnapshot())).toMatchObject({
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
