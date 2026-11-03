import { chromium, expect } from "@playwright/test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createMessageSearchRouter } from "../../../backend/src/api/messageSearch";
import { createMessageSearchService } from "../../../backend/src/service/messageSearch";

const directory = await mkdtemp(join(tmpdir(), "vyline-search-browser-"));
const dbPath = join(directory, "fixture.sqlite");
const db = new Database(dbPath);
db.exec(
  "CREATE TABLE messages (id TEXT, chat_mid TEXT, text TEXT, created_time INTEGER, PRIMARY KEY(chat_mid,id))",
);
const insert = db.query("INSERT INTO messages VALUES (?, ?, ?, ?)");
db.transaction(() => {
  for (let id = 1; id <= 235; id++) insert.run(String(id), "chat-a", `日本語 😀 HELLO ${id}`, 1000);
  for (let id = 1; id <= 3; id++) insert.run(String(id), "chat-b", `別トーク ${id}`, 1000);
})();
const service = createMessageSearchService({
  prepareDatabase: async () => dbPath,
  loadMessages: async (_account, chat, ids) =>
    ids.flatMap((id) => {
      const row = db
        .query("SELECT * FROM messages WHERE chat_mid = ? AND id = ?")
        .get(chat, id) as { text: string; created_time: number } | null;
      return row
        ? [
            {
              id,
              chatMid: chat,
              from: "sender",
              to: chat,
              text: row.text,
              contentType: "NONE",
              createdTime: row.created_time,
              isMyMessage: false,
              ...(id === "235" ? { messageState: "revoked-by-other" as const } : {}),
              savedAt: "fixture",
            },
          ]
        : [];
    }),
});
const api = createMessageSearchRouter(service);
const entry = new URL("./message-search-harness.tsx", import.meta.url).pathname;
const build = await Bun.build({
  entrypoints: [process.platform === "win32" ? entry.replace(/^\//, "") : entry],
  target: "browser",
  tsconfig: resolve(import.meta.dir, "../tsconfig.json"),
  plugins: [
    {
      name: "svg-url",
      setup(builder) {
        builder.onResolve({ filter: /\.svg\?url$/ }, (args) => ({
          path: resolve(args.resolveDir, args.path.slice(0, -4)),
          namespace: "svg-url",
        }));
        builder.onLoad({ filter: /\.svg$/, namespace: "svg-url" }, async ({ path }) => ({
          contents: `export default ${JSON.stringify(`data:image/svg+xml,${encodeURIComponent(await Bun.file(path).text())}`)}`,
          loader: "js",
        }));
      },
    },
  ],
});
if (!build.success) throw new AggregateError(build.logs, "search harness failed to compile");
const cssDirectory = resolve(import.meta.dir, "../dist/assets");
const css = Array.from(new Bun.Glob("index-*.css").scanSync({ cwd: cssDirectory }))[0];
let delayed = false;
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/fixture-delete" && request.method === "POST") {
      db.query("DELETE FROM messages WHERE chat_mid = ? AND id = ?").run("chat-a", "235");
      return Response.json({ ok: true });
    }
    if (url.pathname === "/fixture.js")
      return new Response(build.outputs[0], { headers: { "content-type": "text/javascript" } });
    if (url.pathname === "/fixture.css") return new Response(Bun.file(join(cssDirectory, css!)));
    if (url.pathname.startsWith("/api/")) {
      if (url.searchParams.get("q") === "delay") {
        delayed = true;
        await Bun.sleep(500);
      }
      url.pathname = url.pathname.replace(/^\/api\/line/, "");
      return api.fetch(new Request(url, request));
    }
    return new Response(
      `<!doctype html><html lang="ja"><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"><style>.max-h-32{max-height:8rem}</style><body><script type="module" src="/fixture.js"></script>`,
      { headers: { "content-type": "text/html" } },
    );
  },
});
const browser = await chromium.launch({
  ...(process.platform === "win32" ? { channel: "chrome" } : {}),
  headless: true,
  ...(process.env.VYLINE_TEST_BROWSER ? { executablePath: process.env.VYLINE_TEST_BROWSER } : {}),
});
let checks = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error("pageerror:", error.stack);
  });
  page.on("console", (message) => {
    if (message.type() === "error") console.error("console:", message.text());
  });
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === server.url.origin ? route.continue() : route.abort(),
  );
  await page.goto(server.url.href);
  const a = page.locator('[data-pane="chat-a"]');
  const b = page.locator('[data-pane="chat-b"]');
  await a.locator('[data-command="chat-a"]').click();
  await a.getByRole("textbox", { name: "トーク内を検索" }).fill("日本語");
  await expect(a.getByRole("list", { name: "検索結果" }).getByRole("listitem")).toHaveCount(100);
  await expect(a.locator('[data-native="chat-a"]')).toContainText('"activeId":"235"');
  await expect(a.locator('[data-native="chat-a"]')).toContainText('"ids":["195"');
  await expect(a.locator("#msg-235")).toBeInViewport();
  await expect(a.locator("#msg-235 mark")).toHaveText("日本語");
  await expect(page.locator("#store-count")).toHaveText("2");
  checks++;

  await b.locator('[data-command="chat-b"]').click();
  await b.getByRole("textbox", { name: "トーク内を検索" }).fill("別トーク");
  await expect(b.getByRole("list", { name: "検索結果" }).getByRole("listitem")).toHaveCount(3);
  await a.getByRole("list", { name: "検索結果" }).getByRole("button").last().click();
  await a.getByRole("button", { name: "次の一致", exact: true }).click();
  await expect(a.getByRole("list", { name: "検索結果" }).getByRole("listitem")).toHaveCount(200);
  await expect(a.locator('[data-native="chat-a"]')).toContainText('"activeId":"135"');
  await expect(a.locator("#msg-135")).toBeInViewport();
  await expect(b.getByRole("textbox", { name: "トーク内を検索" })).toHaveValue("別トーク");
  checks++;

  await a.getByRole("button", { name: "前を読む", exact: true }).click();
  await expect(a.locator('[data-native="chat-a"]')).toContainText('"ids":["16"');
  await a.getByRole("button", { name: "後を読む", exact: true }).click();
  await expect(a.locator('[data-native="chat-a"]')).toContainText('"ids":["96"');
  await a.getByRole("button", { name: "最新へ戻る", exact: true }).click();
  await expect(a.locator('[data-native="chat-a"]')).toContainText('"ids":["recent-a"]');
  checks++;

  await a.getByRole("button", { name: "正規表現検索を切り替え" }).click();
  await a.getByRole("textbox", { name: "トーク内を検索" }).fill("[");
  await expect(a.getByRole("alert")).toHaveText("正規表現が不正です");
  await expect(b.getByRole("list", { name: "検索結果" }).getByRole("listitem")).toHaveCount(3);
  await a.getByRole("textbox", { name: "トーク内を検索" }).fill("HELLO 2[0-9]$");
  await expect(a.getByRole("list", { name: "検索結果" }).getByRole("listitem")).toHaveCount(10);
  checks++;

  await a.getByRole("textbox", { name: "トーク内を検索" }).fill("delay");
  await expect.poll(() => delayed).toBe(true);
  await page.locator("#round-trip").click();
  await expect(a.getByRole("textbox", { name: "トーク内を検索" })).toHaveCount(0);
  await page.waitForTimeout(650);
  await a.locator('[data-command="chat-a"]').click();
  await a.getByRole("textbox", { name: "トーク内を検索" }).fill("HELLO 1$");
  await expect(a.getByRole("list", { name: "検索結果" }).getByRole("listitem")).toHaveCount(0);
  await a.getByRole("button", { name: "正規表現検索を切り替え" }).click();
  await expect(a.getByRole("list", { name: "検索結果" }).getByRole("listitem")).toHaveCount(1);
  checks++;

  await a.getByRole("textbox", { name: "トーク内を検索" }).fill("HELLO 235$");
  await expect(a.locator('[data-native="chat-a"]')).toContainText('"activeId":"235"');
  await expect(a.locator('[data-native="chat-a"]')).toContainText('"ids":["195"');
  await page.locator("#mount-native-slot").click();
  const hosted = page.frameLocator("#native-host-frame").locator('[data-vy-message="true"]');
  await expect(hosted).toContainText("日本語 😀 HELLO 235");
  await expect(hosted).toContainText("取り消し済み");
  await page.locator("#open-native-compatibility").click();
  await expect(page.locator("#native-compatibility")).toContainText("日本語 😀 HELLO 235");
  await expect(page.locator("#store-count")).toHaveText("2");
  await page.locator("#delete-native-message").click();
  await expect(hosted).toHaveCount(0);
  await expect(page.locator("#native-compatibility")).toHaveCount(0);
  await expect(a.getByRole("list", { name: "検索結果" })).toHaveCount(0);
  await expect(page.locator("#store-count")).toHaveText("2");
  expect(errors).toEqual([]);
  checks++;
  console.log(
    `PASS ${checks}/6 browser scenarios: SQLite search/context, paging, pane isolation, regex errors, account cancellation, unloaded native hosted/compatibility + deletion; no page errors`,
  );
} finally {
  await browser.close();
  server.stop(true);
  db.close();
  await rm(directory, { recursive: true, force: true });
}
