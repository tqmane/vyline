import { expect, test } from "bun:test";
import { MessageSearchController } from "./searchController";
import type { MessageSearchClient, SearchContext, SearchPage } from "../api/messageSearch";

const hit = (id: string) => ({
  id,
  text: `日本語 😀 ${id}`,
  createdTime: 1000,
  highlight: "日本語",
});
const context = (id: string): SearchContext => ({
  messages: [
    {
      id,
      text: id,
      from: "sender",
      to: "chat",
      contentType: "NONE",
      createdTime: 1000,
      isMyMessage: false,
      contentMetadata: null,
    },
  ],
  hasOlder: true,
  hasNewer: true,
});
async function until(predicate: () => boolean) {
  for (let n = 0; n < 150; n++) {
    if (predicate()) return;
    await Bun.sleep(5);
  }
  throw new Error("controller did not settle");
}
const client = (overrides: Partial<MessageSearchClient> = {}): MessageSearchClient => ({
  search: async () => ({ hits: [hit("old")], nextCursor: null, limit: 100 }),
  context: async (id) => context(id),
  ...overrides,
});

test("each pane keeps its query, regex mode, result navigation and unloaded context independent", async () => {
  const a = new MessageSearchController(client(), () => new Set());
  const b = new MessageSearchController(
    client({ search: async () => ({ hits: [hit("b")], nextCursor: null, limit: 100 }) }),
    () => new Set(["b"]),
  );
  a.setQuery("日本語");
  b.setQuery("😀");
  a.setRegex(true);
  await until(() => !!a.getSnapshot().window && !b.getSnapshot().loading);
  expect(a.getSnapshot().regex).toBe(true);
  expect(a.getSnapshot().window!.messages[0]!.id).toBe("old");
  expect(b.getSnapshot().query).toBe("😀");
  expect(b.getSnapshot().regex).toBe(false);
  expect(b.getSnapshot().window).toBeNull();
  a.close();
  expect(b.getSnapshot().hits[0]!.id).toBe("b");
  a.dispose();
  b.dispose();
});

test("next loads another result page instead of wrapping at the page boundary", async () => {
  const c = new MessageSearchController(
    client({
      search: async (_query, _regex, cursor) =>
        cursor
          ? { hits: [hit("2")], nextCursor: null, limit: 100 }
          : { hits: [hit("1")], nextCursor: "page2", limit: 100 },
    }),
    () => new Set(["1", "2"]),
  );
  c.setQuery("日本語");
  await until(() => !c.getSnapshot().loading);
  await c.next();
  expect(c.getSnapshot().hits).toHaveLength(2);
  expect(c.getSnapshot().index).toBe(1);
  await c.next();
  expect(c.getSnapshot().index).toBe(0);
  c.dispose();
});

test("query replacement, explicit cancel and account disposal ignore late responses even if fetch ignores abort", async () => {
  let finish: ((value: SearchPage) => void) | undefined;
  let signal: AbortSignal | undefined;
  const c = new MessageSearchController(
    client({
      search: async (_q, _r, _c, s) => {
        signal = s;
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    }),
    () => new Set(),
  );
  c.setQuery("first");
  await until(() => !!finish);
  c.setQuery("second");
  expect(signal!.aborted).toBe(true);
  finish!({ hits: [hit("retired")], nextCursor: null, limit: 100 });
  await Bun.sleep(1);
  expect(c.getSnapshot().hits).toHaveLength(0);
  c.cancel();
  expect(c.getSnapshot().loading).toBe(false);
  c.dispose();
});

test("late context cannot displace a newer selection or survive closing the search", async () => {
  let resolveOld: ((value: SearchContext) => void) | undefined;
  const c = new MessageSearchController(
    client({
      search: async () => ({ hits: [hit("old"), hit("new")], nextCursor: null, limit: 100 }),
      context: async (id) =>
        id === "old"
          ? new Promise((resolve) => {
              resolveOld = resolve;
            })
          : context(id),
    }),
    () => new Set(),
  );
  c.setQuery("日本語");
  await until(() => !!resolveOld);
  await c.select(1);
  resolveOld!(context("old"));
  await Bun.sleep(1);
  expect(c.getSnapshot().window!.messages[0]!.id).toBe("new");
  c.close();
  expect(c.getSnapshot().window).toBeNull();
  c.dispose();
});

test("paging an unloaded history uses local context and supports returning to the current timeline", async () => {
  const directions: string[] = [];
  const c = new MessageSearchController(
    client({
      context: async (id, direction) => {
        directions.push(direction);
        return context(id);
      },
    }),
    () => new Set(),
  );
  c.setQuery("日本語");
  await until(() => !!c.getSnapshot().window);
  await c.pageContext("before");
  await c.pageContext("after");
  expect(directions).toEqual(["around", "before", "after"]);
  c.latest();
  expect(c.getSnapshot().window).toBeNull();
  c.dispose();
});

test("search errors remain actionable and empty results clear stale matches", async () => {
  const c = new MessageSearchController(
    client({
      search: async (query) => {
        if (query === "[") throw new Error("正規表現が不正です");
        return { hits: [], nextCursor: null, limit: 100 };
      },
    }),
    () => new Set(),
  );
  c.setQuery("[");
  await until(() => !!c.getSnapshot().error);
  expect(c.getSnapshot().error).toBe("正規表現が不正です");
  c.setQuery("missing");
  await until(() => !c.getSnapshot().loading);
  expect(c.getSnapshot().hits).toHaveLength(0);
  expect(c.getSnapshot().error).toBe("");
  c.dispose();
});

test("a next-page response cannot navigate a replacement query", async () => {
  let finish: ((value: SearchPage) => void) | undefined;
  const c = new MessageSearchController(
    client({
      search: async (query, _regex, cursor) => {
        if (cursor)
          return new Promise((resolve) => {
            finish = resolve;
          });
        return { hits: [hit(query)], nextCursor: query === "first" ? "next" : null, limit: 100 };
      },
    }),
    () => new Set(["first", "replacement", "retired"]),
  );
  c.setQuery("first");
  await until(() => !c.getSnapshot().loading);
  const next = c.next();
  await until(() => !!finish);
  c.setQuery("replacement");
  finish!({ hits: [hit("retired")], nextCursor: null, limit: 100 });
  await next;
  await until(() => !c.getSnapshot().loading);
  expect(c.getSnapshot().hits.map((value) => value.id)).toEqual(["replacement"]);
  expect(c.getSnapshot().index).toBe(0);
  c.dispose();
});

test("local deletion removes search hits and an already loaded context without touching shared history", async () => {
  const c = new MessageSearchController(client(), () => new Set());
  c.setQuery("日本語");
  await until(() => !!c.getSnapshot().window);
  c.removeMessage("old");
  expect(c.getSnapshot().hits).toHaveLength(0);
  expect(c.getSnapshot().window!.messages).toHaveLength(0);
  c.retry();
  await until(() => !c.getSnapshot().loading);
  expect(c.getSnapshot().hits).toHaveLength(0);
  c.dispose();
});

test("disposing a pane clears private results and supports React StrictMode reconnect", async () => {
  const c = new MessageSearchController(client(), () => new Set());
  c.setQuery("日本語");
  await until(() => !!c.getSnapshot().window);
  c.dispose();
  expect(c.getSnapshot().query).toBe("");
  expect(c.getSnapshot().window).toBeNull();
  c.activate();
  c.setQuery("again");
  await until(() => !!c.getSnapshot().window);
  expect(c.getSnapshot().query).toBe("again");
  c.dispose();
});
