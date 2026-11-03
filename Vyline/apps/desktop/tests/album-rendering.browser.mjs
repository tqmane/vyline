import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const origin = `http://127.0.0.1:${process.env.ALBUM_TEST_PORT || "5191"}`;
try {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  let checks = 0;
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname.includes("/media/")) {
      if (route.request().frame().url().includes("imageFail") && !url.searchParams.has("retry")) return route.fulfill({ status: 404, body: "fixture image failure" });
      return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>' });
    }
    if (url.pathname.startsWith("/api/")) return route.abort();
    return route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(3000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const open = async query => {
    await page.goto(`${origin}/tests/album-rendering.html?${query || ""}`);
    await page.getByRole("button", { name: /Travel Album/ }).click();
  };
  const requests = () => page.evaluate(() => window.requests);
  const image = () => page.getByRole("img", { name: "アルバム写真", exact: true }).first();
  const nativeAction = async label => page.evaluate(label => {
    const flatten = items => items.flatMap(item => [item, ...flatten(item.items || [])]);
    const panel = JSON.parse(document.getElementById("panel").textContent);
    const control = flatten(panel.items).find(item => item.kind === "button" && item.label.includes(label));
    if (!control) throw new Error(`Missing native action: ${label}`);
    window.invoke("panel-action", control.id);
  }, label);
  await open();
  await image().waitFor();
  await image().scrollIntoViewIfNeeded();
  await page.waitForFunction(() => [...document.images].some(image => image.alt === "アルバム写真" && image.naturalWidth > 0));
  const photoRequest = (await requests()).find(item => item.path.includes("/123/photos"));
  assert.ok(photoRequest.path.includes("chatId="));
  const src = new URL(await image().getAttribute("src"), origin);
  assert.equal(src.pathname, "/api/line/album-fixture/albums/123/media/image-oid");
  assert.equal(src.searchParams.get("chatId"), `c${"a".repeat(32)}`); checks++;

  await page.getByRole("button", { name: "写真を表示", exact: true }).click();
  const enlarged = page.getByRole("dialog", { name: "アルバム写真", exact: true });
  await enlarged.waitFor();
  assert.ok((await enlarged.locator("img").getAttribute("src")).includes("full=1"));
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog", { name: "アルバム", exact: true }).count(), 1); checks++;

  await page.getByRole("region", { name: "写真", exact: true }).getByRole("button", { name: "次のページ" }).click();
  await page.getByRole("button", { name: "動画を表示", exact: true }).waitFor();
  assert.ok((await page.locator("video").first().getAttribute("src")).includes("sid=v"));
  assert.ok((await requests()).some(item => item.path.includes("cursor=photos-next")));
  assert.equal(await page.getByRole("region", { name: "写真", exact: true }).getByRole("button", { name: "次のページ" }).count(), 0); checks++;

  await page.locator("video").first().dispatchEvent("error");
  const retryVideo = page.getByRole("button", { name: "動画を再読み込み", exact: true });
  await retryVideo.waitFor();
  assert.equal(await page.locator("video").count(), 0);
  await retryVideo.click();
  assert.ok((await page.locator("video").getAttribute("src")).includes("retry=1")); checks++;

  await page.getByRole("region", { name: "アルバム一覧", exact: true }).getByRole("button", { name: "次のページ" }).click();
  await page.getByRole("button", { name: /Other Album/ }).waitFor();
  assert.ok((await requests()).some(item => item.path.includes("cursor=albums-next"))); checks++;

  await page.goto(`${origin}/tests/album-rendering.html?menu`);
  await page.getByRole("button", { name: "アルバム", exact: true }).click();
  await page.getByRole("button", { name: /Travel Album/ }).click();
  await image().waitFor(); checks++;

  for (const error of ["fail", "catalogFail"]) {
    await open(error);
    await page.getByRole("alert").filter({ hasText: /denied/ }).waitFor();
    await page.getByRole("button", { name: "再読み込み", exact: true }).first().click();
    if (error === "fail") await image().waitFor();
    else await page.getByRole("dialog", { name: "アルバム", exact: true }).getByRole("button", { name: /Travel Album/ }).waitFor();
    assert.equal(await page.getByRole("alert").count(), 0); checks++;
  }
  await open("empty");
  await page.getByText("写真がありません", { exact: true }).waitFor();
  assert.equal(await page.getByRole("alert").count(), 0); checks++;

  await open("imageFail");
  await page.getByRole("button", { name: "写真を再読み込み", exact: true }).click();
  await image().waitFor();
  assert.ok((await image().getAttribute("src")).includes("retry=1")); checks++;

  await open("missing");
  await page.getByRole("alert").filter({ hasText: "アルバムID" }).waitFor();
  assert.equal((await requests()).some(item => item.path.includes("/albums")), false); checks++;

  for (const action of ["switchAccount", "changeChat"]) {
    await open("slow");
    await page.waitForFunction(() => window.requests.some(item => item.path.includes("/photos")));
    await page.evaluate(action => window[action](), action);
    await page.waitForFunction(() => window.requests.some(item => item.path.includes("/photos") && item.aborted));
    await page.evaluate(() => window.release());
    await expect(page.getByRole("dialog", { name: "アルバム", exact: true })).toHaveCount(0);
    await expect(page.getByRole("img", { name: "アルバム写真", exact: true })).toHaveCount(0); checks++;
  }
  await open("slow");
  await page.waitForFunction(() => window.requests.some(item => item.path.includes("/photos")));
  await page.getByRole("region", { name: "アルバム一覧", exact: true }).getByRole("button", { name: "次のページ" }).click();
  await page.getByRole("button", { name: /Other Album/ }).click();
  await image().waitFor();
  assert.ok((await image().getAttribute("src")).includes("/456/media/other-oid"));
  assert.ok((await requests()).some(item => item.path.includes("/123/photos") && item.aborted));
  await page.evaluate(() => window.release()); checks++;

  await page.goto(`${origin}/tests/album-rendering.html?note`);
  await page.getByRole("button", { name: /ノートが作成されました/ }).click();
  await page.getByText("Existing note preserved", { exact: true }).waitFor();
  assert.equal((await requests()).some(item => item.path.includes("/albums")), false); checks++;

  await page.goto(`${origin}/tests/album-rendering.html?native`);
  await page.waitForFunction(() => document.getElementById("panel").textContent.includes("Travel Album"));
  await nativeAction("Travel Album");
  await page.waitForFunction(() => document.getElementById("panel").textContent.includes("写真を表示"));
  assert.ok((await requests()).some(item => item.path.includes("/123/photos")));
  await nativeAction("写真を表示");
  await page.waitForFunction(() => document.getElementById("panel").textContent.includes('"title":"アルバム写真"'));
  assert.ok((await page.locator("#panel").textContent()).includes("full=1"));
  await page.evaluate(() => window.invoke("panel-close"));
  await page.waitForFunction(() => document.getElementById("panel").textContent.includes('"title":"アルバム"')); checks++;

  assert.equal((await requests()).every(item => item.method === "GET"), true);
  assert.deepEqual(errors, []);
  console.log(`${checks} album browser checks passed; 0 page errors; no external requests or mutations`);
} finally { await browser.close(); }
