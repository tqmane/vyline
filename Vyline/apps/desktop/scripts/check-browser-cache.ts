import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { browserCacheRouter } from "../../../backend/src/api/browserCache";

assert.equal((await browserCacheRouter.request("/", { method: "POST" })).status, 403);
assert.equal((await browserCacheRouter.request("/", { method: "POST", headers: { "X-Vyline-Cache-Reset": "1", "Sec-Fetch-Site": "cross-site" } })).status, 403);
const reset = await browserCacheRouter.request("/", { method: "POST", headers: { "X-Vyline-Cache-Reset": "1" } });
assert.equal(reset.headers.get("Clear-Site-Data"), '"cache"');
assert.equal(reset.headers.get("Cache-Control"), "no-store");
let revision = 1;
const source = await Bun.file(new URL("../src/lib/browser-cache.ts", import.meta.url)).text();
const module = new Bun.Transpiler({ loader: "ts" }).transformSync(source);
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
  const path = new URL(request.url).pathname;
  if (path.startsWith("/api/")) return browserCacheRouter.fetch(new Request(new URL("/", request.url), request));
  if (path === "/helper.js") return new Response(module, { headers: { "Content-Type": "text/javascript" } });
  if (path.endsWith(".svg")) return new Response(`<svg xmlns="http://www.w3.org/2000/svg"><!--revision ${revision}--></svg>`, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=31536000, immutable" } });
  if (path.endsWith(".js")) return new Response(`window.assetRevision = ${revision};`, { headers: { "Content-Type": "text/javascript", "Cache-Control": "public, max-age=31536000, immutable" } });
  return new Response(`<script src="${path.startsWith("/dist/") ? "/dist/ui-compose/vyline-compose-ui.js" : "/assets/app.js"}"></script>`, { headers: { "Content-Type": "text/html" } });
} });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.port}`);
  await page.evaluate(async () => {
    localStorage.setItem("keep-preferences", "yes"); sessionStorage.setItem("keep-draft", "yes");
    document.cookie = "keep-session=yes; SameSite=Lax";
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("keep-history", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("messages");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => { const db = open.result; const tx = db.transaction("messages", "readwrite");
        tx.objectStore("messages").put("keep", "draft"); tx.oncomplete = () => { db.close(); resolve(); }; };
    });
  });
  revision = 2;
  const result = await page.evaluate(async () => {
    const before = await (await fetch("/assets/app.js")).text();
    const response = await fetch("/api/browser-cache/", { method: "POST", headers: { "X-Vyline-Cache-Reset": "1" } });
    if (!response.ok) throw new Error("cache reset failed");
    const after = await (await fetch("/assets/app.js")).text();
    return { before, after };
  });
  assert.match(result.before, /= 1;/); assert.match(result.after, /= 2;/);
  revision = 3;
  await page.evaluate(async () => {
    const response = await fetch("/dist/ui-compose/composeResources/symbol.svg"); await response.text();
  });
  revision = 4;
  await page.evaluate(async () => { const path = "/helper.js"; await (await import(path)).refreshBrowserUiAssets(); });
  assert.match(await page.evaluate(async () => (await fetch("/assets/app.js")).text()), /= 4;/);
  assert.match(await page.evaluate(async () => (await fetch("/dist/ui-compose/vyline-compose-ui.js")).text()), /= 4;/);
  assert.match(await page.evaluate(async () => (await fetch("/dist/ui-compose/composeResources/symbol.svg")).text()), /revision 4/);
  assert.deepEqual(await page.evaluate(async () => ({ local: localStorage.getItem("keep-preferences"), session: sessionStorage.getItem("keep-draft"), cookie: document.cookie,
    history: await new Promise((resolve, reject) => { const open = indexedDB.open("keep-history"); open.onerror = () => reject(open.error);
      open.onsuccess = () => { const db = open.result; const read = db.transaction("messages").objectStore("messages").get("draft");
        read.onsuccess = () => { db.close(); resolve(read.result); }; }; }) })),
  { local: "yes", session: "yes", cookie: "keep-session=yes", history: "keep" });
  console.log("Browser HTTP cache cleared; fixed-name UI assets refreshed; cookies, preferences, drafts and IndexedDB preserved.");
} finally { await browser.close(); await server.stop(true); }
