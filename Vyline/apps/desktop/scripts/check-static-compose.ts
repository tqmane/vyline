import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";

const base = process.env.VYLINE_TEST_URL ?? "http://127.0.0.1:3001";
const loader = await readFile(resolve(import.meta.dir, "../dist/dist/ui-compose/vyline-compose-ui.js"), "utf8");
const wasm = [...new Set(loader.match(/[a-f0-9]{20}\.wasm/g))];
assert.equal(wasm.length, 2);
for (const file of wasm) {
  const response = await fetch(`${base}/dist/ui-compose/${file}`, { method: "HEAD" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/wasm");
  assert.match(response.headers.get("cache-control") ?? "", /immutable/);
}
const bootstrap = await fetch(`${base}/dist/ui-compose/vyline-compose-ui.js`, { method: "HEAD" });
assert.equal(bootstrap.headers.get("cache-control"), "no-cache");
const etag = bootstrap.headers.get("etag");
assert(etag);
const unchanged = await fetch(`${base}/dist/ui-compose/vyline-compose-ui.js`, { headers: { "If-None-Match": etag } });
assert.equal(unchanged.status, 304);
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("vyline:design-system", JSON.stringify({ state: { mode: "apple", appearance: "light" }, version: 0 })));
  await page.goto(`${base}/pr-demo`);
  await expect(page.locator('[data-kmp-ready="true"]')).toBeVisible({ timeout: 60_000 });
  await expect(page.frameLocator('iframe[title="Vyline Compose UI"]').getByRole("textbox", { name: "メッセージを入力", exact: true })).toBeAttached();
  assert.deepEqual(errors, []);
  console.log("PASS: Bun serves production Wasm with streaming MIME, reloadable bootstrap and working Compose UI");
} finally { await browser.close(); }
