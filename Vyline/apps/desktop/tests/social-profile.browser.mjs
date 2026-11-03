import { chromium } from "@playwright/test";
import assert from "node:assert/strict";

const browser = await chromium.launch({ channel: "chrome", headless: true });
let checks = 0;
try {
  const context = await browser.newContext();
  // No request can leave the local fixture server, including image resources.
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1") return route.abort();
    if (url.pathname.startsWith("/api/")) return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"/>' });
    return route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("dialog", dialog => dialog.accept());
  const open = async query => page.goto(`http://127.0.0.1:5187/tests/social-profile-harness.html?${query}`);
  const writes = () => page.evaluate(() => window.requests.filter(request => ["POST", "DELETE"].includes(request.method)));
  const nativeAction = label => page.evaluate(label => {
    const flatten = items => items.flatMap(item => [item, ...flatten(item.items || [])]);
    const panel = JSON.parse(document.getElementById("panel").textContent);
    const item = flatten(panel.items).find(item => item.kind === "button" && item.label.includes(label));
    if (!item) throw new Error(`Missing native action ${label}`);
    window.invoke("panel-action", item.id);
  }, label);
  await open("screen=mid");
  await page.getByRole("heading", { name: "Alice", exact: true }).waitFor();
  assert.equal((await writes()).length, 0, "profile viewing is read-only"); checks++;
  await page.getByRole("button", { name: "友だちに追加", exact: true }).click();
  await page.getByRole("button", { name: "友だちから削除", exact: true }).waitFor();
  await page.getByRole("button", { name: "友だちから削除", exact: true }).click();
  await page.getByRole("button", { name: "友だちに追加", exact: true }).waitFor();
  assert.deepEqual((await writes()).map(item => item.method), ["POST", "DELETE"]); checks++;
  await page.getByRole("button", { name: "アイコンを拡大", exact: true }).click();
  await page.getByRole("dialog", { name: "プロフィール画像", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog", { name: "MIDのプロフィール（閲覧）" }).count(), 1); checks++;
  await page.evaluate(() => window.switchAccount());
  await page.getByText("Closed", { exact: true }).waitFor(); checks++;
  await open("screen=group");
  await page.getByRole("button", { name: "Alice", exact: true }).click();
  await page.getByRole("button", { name: "グループを作成", exact: true }).click();
  assert.equal((await writes())[0].body.mode, "group"); checks++;
  await open("screen=group");
  await page.getByRole("radio", { name: /複数人トーク/ }).check();
  await page.getByRole("button", { name: "Alice", exact: true }).click();
  await page.getByRole("button", { name: "複数人トークを作成", exact: true }).click();
  assert.equal((await writes())[0].body.mode, "room"); checks++;
  await open("screen=note");
  await page.getByRole("button", { name: "ノート", exact: true }).click();
  await page.getByRole("button", { name: /first second/ }).click();
  await page.getByRole("region", { name: "ノートの詳細" }).waitFor();
  assert.match(await page.getByRole("region", { name: "ノートの詳細" }).innerText(), /A comment/); checks++;
  for (const screen of ["profile", "member"]) {
    await open(`screen=${screen}&privacy=1`);
    await page.getByRole("heading", { name: "Alice", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "アイコンを拡大", exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "背景を拡大", exact: true }).isVisible().catch(() => false), screen === "profile");
    assert.ok(!(await page.locator("body").innerText()).includes("secret.example")); checks++;
  }
  await open("screen=profile&native=1");
  await page.waitForFunction(() => document.getElementById("panel").textContent.includes("zoom-avatar"));
  const panel = await page.locator("#panel").textContent();
  assert.match(panel, /友だちに追加/); assert.match(panel, /zoom-background/); checks++;
  await page.evaluate(() => {
    const find = items => items.flatMap(item => [item, ...find(item.items || [])]);
    const panel = JSON.parse(document.getElementById("panel").textContent);
    window.invoke("panel-action", find(panel.items).find(item => item.label === "友だちに追加").id);
  });
  await page.waitForFunction(() => document.getElementById("confirmation").textContent.includes("友だちに追加しますか"));
  assert.equal((await writes()).length, 0, "native action waits for explicit confirmation");
  await page.evaluate(() => window.accept());
  await page.waitForFunction(() => window.requests.some(item => item.method === "POST" && item.path.includes("/social/friends/"))); checks++;
  await page.evaluate(() => {
    const panel = JSON.parse(document.getElementById("panel").textContent);
    window.invoke("panel-action", panel.items.find(item => item.id.endsWith(":zoom-avatar")).id);
  });
  await page.waitForFunction(() => document.getElementById("panel").textContent.includes('"title":"プロフィール画像"'));
  await page.evaluate(() => window.invoke("panel-close"));
  await page.waitForFunction(() => document.getElementById("panel").textContent.includes('"title":"プロフィール"')); checks++;
  await open("screen=group&native=1");
  await page.waitForFunction(() => document.getElementById("panel").textContent.includes("複数人トーク"));
  assert.match(await page.locator("#panel").textContent(), /"kind":"choice"/); checks++;
  await open("screen=note&native=1");
  await page.waitForFunction(() => document.getElementById("panel").textContent.includes("ノート"));
  await nativeAction("ノート");
  await page.waitForFunction(() => document.getElementById("panel").textContent.includes("first"));
  await nativeAction("first");
  await page.waitForFunction(() => document.getElementById("panel").textContent.includes("A comment")); checks++;
  assert.deepEqual(errors, []);
  console.log(`${checks} browser checks passed; 0 page errors; all non-local requests blocked`);
} finally { await browser.close(); }
