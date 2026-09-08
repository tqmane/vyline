import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";

const base = process.env.VYLINE_TEST_URL ?? "http://127.0.0.1:5186";
const chatId = `c${"1".repeat(32)}`;
const chat = { mid: chatId, name: "キャッシュ検証", type: "GROUP", thumbnailUrl: "/fixture-avatar.svg", memberMids: [] };
const message = { id: "fixture-message", from: `u${"2".repeat(32)}`, to: chatId, text: "直近の履歴", createdTime: "1788800000000", contentType: 0 };
const requests: { path: string; start: number; end?: number }[] = [];
let slow = false;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== base) return route.abort();
    if (url.pathname === "/src/main.tsx") return route.fulfill({ contentType: "text/javascript", body: 'import "/scripts/hydration-probe.tsx";' });
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const entry = { path: url.pathname, start: Date.now(), end: undefined as number | undefined }; requests.push(entry);
    if (slow || url.pathname.includes("vyline-cache")) await new Promise((resolve) => setTimeout(resolve, 2500));
    const other = url.pathname.includes("cache-fixture-b");
    const body = url.pathname.endsWith("/bootstrap") ? { ok: true, chats: other ? [] : [chat], messagesByChat: other ? {} : { [chatId]: [message] }, syncedAt: null, chatsSyncedAt: null }
      : url.pathname.endsWith("/chats") ? { ok: true, chats: other ? [] : [chat], fromCache: true }
      : url.pathname.includes("/messages") ? { ok: true, messages: [message], hasMore: false }
      : url.pathname.endsWith("/profile") ? { ok: true, profile: { mid: `u${"2".repeat(32)}`, displayName: "検証プロフィール" } }
      : { ok: true, profiles: {} };
    entry.end = Date.now();
    await route.fulfill({ json: body });
  });
  const read = async () => JSON.parse(await page.getByLabel("data").innerText());
  await page.goto(`${base}/__hydration-probe.html`);
  await expect.poll(async () => (await read()).chats.length).toBe(1);
  const bootstrap = requests.find((entry) => entry.path.endsWith("/bootstrap"))!;
  const metadata = requests.find((entry) => entry.path.includes("vyline-cache"));
  assert(bootstrap && (!metadata?.end || bootstrap.start < metadata.end), "Metadata must not block bootstrap");
  await page.getByText("Open history", { exact: true }).click();
  await expect.poll(async () => (await read()).messages.some((entry: { id: string }) => entry.id === message.id)).toBe(true);
  const count = requests.filter((entry) => entry.path.endsWith("/bootstrap")).length;
  await page.getByText("Switch renderer", { exact: true }).click();
  await page.getByText("Switch renderer", { exact: true }).click();
  assert.equal(requests.filter((entry) => entry.path.endsWith("/bootstrap")).length, count);
  slow = true;
  const reloadAt = Date.now();
  await page.reload();
  await expect.poll(async () => (await read()).chats.length, { timeout: 1500 }).toBe(1);
  const warmMs = Date.now() - reloadAt;
  await page.getByText("Open history", { exact: true }).click();
  await expect.poll(async () => (await read()).messages.some((entry: { id: string }) => entry.id === message.id), { timeout: 1000 }).toBe(true);
  await page.getByText("Switch account", { exact: true }).click();
  await expect.poll(async () => { const state = await read(); return state.owner === "cache-fixture-b" && state.chats.length === 0 && state.messages.length === 0; }).toBe(true);
  assert.deepEqual(errors, []);
  await mkdir("test-results/hydration", { recursive: true });
  await writeFile("test-results/hydration/result.json", JSON.stringify({ warmMs, requests, errors, fixture: true }, null, 2));
  console.log(`Hydration browser PASS: warm display ${warmMs}ms with network delayed 2500ms; renderer reentry, recent messages and account isolation verified.`);
} catch (error) {
  console.error(JSON.stringify({ requests, errors, page: await page.locator("body").innerText() }));
  throw error;
} finally { await browser.close(); }
