import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMessageSearchService, MessageSearchError } from "./messageSearch.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "vyline-search-"));
  directories.push(directory);
  const paths = new Map<string, string>();
  for (const account of ["a", "b"]) {
    const path = join(directory, `${account}.sqlite`);
    paths.set(account, path);
    const db = new Database(path);
    db.exec(`CREATE TABLE messages (id TEXT, chat_mid TEXT, text TEXT, created_time INTEGER,
      PRIMARY KEY(chat_mid, id));
      CREATE INDEX message_order ON messages(chat_mid, created_time);`);
    const put = db.query("INSERT INTO messages VALUES (?, ?, ?, ?)");
    db.transaction(() => {
      for (let id = 1; id <= 235; id++)
        put.run(String(id), "chat", account === "a" ? `日本語 😀 HELLO ${id}` : "secret b", 1000);
      put.run("999", "other-chat", "secret other chat", 2000);
      put.run("1000", "chat", `${"a".repeat(20_000)}!`, 2000);
      for (let id = 1; id <= 20; id++)
        put.run(String(id), "hostile", `${"a".repeat(20_000)}!`, 2000);
    })();
    db.close();
  }
  return createMessageSearchService({
    prepareDatabase: async (account) => paths.get(account)!,
    loadMessages: async (_account, chat, ids) =>
      ids.map((id) => ({
        id,
        chatMid: chat,
        from: "sender",
        to: chat,
        text: id,
        contentType: "NONE",
        createdTime: 1000,
        isMyMessage: false,
        savedAt: "fixture",
      })),
  });
}

test("SQLite search covers Japanese, emoji, case folding, literal symbols and empty hits", async () => {
  const service = await fixture();
  for (const query of ["日本語", "😀", "hello"])
    expect((await service.search("a", "chat", { query })).hits).toHaveLength(100);
  expect((await service.search("a", "chat", { query: ".*" })).hits).toHaveLength(0);
  expect(
    (await service.search("a", "chat", { query: "日本語.*HELLO 2[0-9]$", regex: true })).hits,
  ).toHaveLength(10);
  expect((await service.search("a", "chat", { query: "secret" })).hits).toHaveLength(0);
  expect((await service.search("b", "chat", { query: "日本語" })).hits).toHaveLength(0);
});

test("search pages beyond 100 hits without repeats, including equal timestamps and numeric IDs", async () => {
  const service = await fixture();
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await service.search("a", "chat", {
      query: "hello",
      ...(cursor ? { cursor } : {}),
    });
    ids.push(...page.hits.map((hit) => hit.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  expect(ids).toEqual(Array.from({ length: 235 }, (_, i) => String(235 - i)));
});

test("an unloaded result has an ordered local context with paging in both directions", async () => {
  const service = await fixture();
  const page = await service.context("a", "chat", "120", "around");
  expect(page.messages.map((message) => message.id)).toEqual(
    Array.from({ length: 81 }, (_, i) => String(80 + i)),
  );
  expect(page.hasOlder).toBe(true);
  expect(page.hasNewer).toBe(true);
  const older = await service.context("a", "chat", "80", "before");
  expect(older.messages[0]!.id).toBe("1");
  expect(older.hasOlder).toBe(false);
  const newer = await service.context("a", "chat", "160", "after");
  expect(newer.messages.at(-1)!.id).toBe("1000");
  expect(newer.hasNewer).toBe(false);
  await expect(service.context("a", "chat", "999", "around")).rejects.toMatchObject({
    status: 404,
  });
});

test("invalid input and invalid regex produce controlled errors", async () => {
  const service = await fixture();
  for (const query of ["", " ", "x".repeat(513)])
    await expect(service.search("a", "chat", { query })).rejects.toBeInstanceOf(MessageSearchError);
  await expect(service.search("a", "chat", { query: "[", regex: true })).rejects.toMatchObject({
    code: "INVALID_QUERY",
    status: 400,
  });
  await expect(
    service.search("a", "chat", { query: "hello", cursor: "bad" }),
  ).rejects.toMatchObject({ status: 400 });
});

test("a hostile regex times out in a worker while the server remains responsive", async () => {
  const service = await fixture();
  const pending = service.search("a", "hostile", { query: "(a+)+$", regex: true });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect((await service.search("b", "chat", { query: "secret" })).hits.length).toBe(100);
  await expect(pending).rejects.toMatchObject({ code: "SEARCH_TIMEOUT", status: 408 });
});

test("an aborted search is terminated and cannot deliver a late result", async () => {
  const service = await fixture();
  const abort = new AbortController();
  const pending = service.search("a", "hostile", { query: "(a+)+$", regex: true }, abort.signal);
  abort.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect((await service.search("a", "chat", { query: "hello" })).hits.length).toBe(100);
});

test("worker capacity is bounded and aborted requests release every slot", async () => {
  const service = await fixture();
  const aborts = Array.from({ length: 4 }, () => new AbortController());
  const pending = aborts.map((abort) =>
    service.search("a", "hostile", { query: "(a+)+$", regex: true }, abort.signal),
  );
  const settled = Promise.allSettled(pending);
  await expect(service.search("a", "chat", { query: "hello" })).rejects.toMatchObject({
    code: "SEARCH_BUSY",
    status: 429,
  });
  for (const abort of aborts) abort.abort();
  expect((await settled).every((value) => value.status === "rejected")).toBe(true);
  expect((await service.search("a", "chat", { query: "hello" })).hits.length).toBe(100);
});
