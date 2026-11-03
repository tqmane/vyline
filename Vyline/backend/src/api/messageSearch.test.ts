import { expect, test } from "bun:test";
import { Hono } from "hono";
import { createMessageSearchRouter } from "./messageSearch.js";
import { MessageSearchError } from "../service/messageSearch.js";

test("the search route forwards only the authorized account/chat and request cancellation", async () => {
  let scope: unknown;
  const app = new Hono().route(
    "/api/line",
    createMessageSearchRouter({
      search: async (account, chat, input, signal) => {
        scope = { account, chat, input, signal: !!signal };
        return { hits: [], limit: 100, nextCursor: null };
      },
      context: async () => ({ messages: [], hasOlder: false, hasNewer: false }),
    }),
  );
  const response = await app.request(
    "/api/line/account-a/message-search/chat-a?q=%F0%9F%98%80&regex=true",
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(scope).toEqual({
    account: "account-a",
    chat: "chat-a",
    input: { query: "😀", regex: true },
    signal: true,
  });
  expect((await response.json()).hits).toEqual([]);
});

test("the search route returns actionable invalid-query, timeout, missing-context and busy errors", async () => {
  for (const status of [400, 404, 408, 429] as const) {
    const app = createMessageSearchRouter({
      search: async () => {
        throw new MessageSearchError("fixture message", "FIXTURE", status);
      },
      context: async () => {
        throw new MessageSearchError("fixture message", "FIXTURE", status);
      },
    });
    const response = await app.request("/a/message-search/c?q=test");
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ ok: false, error: "fixture message", code: "FIXTURE" });
  }
});

test("bad regex mode is rejected without invoking the service", async () => {
  let called = false;
  const app = createMessageSearchRouter({
    search: async () => {
      called = true;
      return { hits: [], limit: 100, nextCursor: null };
    },
    context: async () => ({ messages: [], hasOlder: false, hasNewer: false }),
  });
  const response = await app.request("/a/message-search/c?q=test&regex=yes");
  expect(response.status).toBe(400);
  expect(called).toBe(false);
});
