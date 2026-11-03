import { chromium } from "@playwright/test";
import assert from "node:assert/strict";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const failures = [];
let checks = 0;
try {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1") return route.abort();
    if (url.pathname.startsWith("/api/")) return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"/>' });
    return route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(3000);
  const errors = [];
  const dialogs = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("dialog", dialog => { dialogs.push(dialog.message()); void dialog.dismiss(); });
  const check = async (label, run) => { try { await run(); checks++; } catch (error) { failures.push(`${label}: ${error.message.split("\n")[0]}`); } };
  const open = async (screen, masks, extra = "") => {
    await page.goto(`http://127.0.0.1:${process.env.SOCIAL_TEST_PORT || "5187"}/tests/social-profile-harness.html?screen=${screen}&masks=${masks}&${extra}`);
    await page.waitForFunction(() => document.querySelector("#panel"));
    if (screen === "member" && masks !== "names,avatars,urls") await page.getByText(/^status /).waitFor();
  };
  const surface = () => page.locator('body').evaluate(body => {
    const clone = body.cloneNode(true);
    clone.querySelectorAll("#panel,#confirmation,script").forEach(node => node.remove());
    return clone.textContent;
  });
  for (const masks of ["off", "names", "avatars", "urls", "names,avatars", "names,urls", "avatars,urls", "names,avatars,urls"]) {
    for (const screen of ["sidebar", "profile", "member", "mid"]) {
      await open(screen, masks, "noImage=1");
      await check(`${screen} ${masks} independent avatar`, async () => {
        await page.waitForFunction(() => document.querySelector('[data-native-avatar]'));
        const avatars = await page.locator('[data-native-avatar]').evaluateAll(nodes => nodes.map(node => node.getAttribute("data-native-avatar")));
        assert.ok(avatars.includes(masks.includes("avatars") ? "•" : "A"), JSON.stringify(avatars));
      });
      await check(`${screen} ${masks} independent text`, async () => {
        const body = await surface();
        assert.equal(body.includes("Alice"), !masks.includes("names"), "name visibility");
        assert.equal(body.includes("secret.example"), !masks.includes("urls"), "URL visibility");
        const accessible = await page.locator("[aria-label],[title],input").evaluateAll(nodes => nodes.map(node => [node.getAttribute("aria-label"), node.getAttribute("title"), node.value || ""].join(" ")).join(" "));
        if (masks.includes("names")) assert.ok(!accessible.includes("Alice"));
        if (masks.includes("urls")) assert.ok(!accessible.includes("secret.example"));
      });
    }
    for (const screen of ["profile", "mid", "sidebar"]) {
    await open(screen, masks, "native=1&noImage=1");
    await check(`native ${screen} ${masks} projection`, async () => {
      await page.waitForFunction(screen => document.getElementById("panel").textContent.includes(screen === "profile" ? "identity" : screen === "mid" ? "トークを開く" : "トーク一覧を再取得"), screen);
      const panel = JSON.parse(await page.locator("#panel").textContent());
      if (screen === "profile") {
        const identity = panel.items.find(item => item.id.endsWith(":identity"));
        assert.equal(identity.value, masks.includes("avatars") ? "•" : "A");
      }
      const flatten = items => items.flatMap(item => [item, ...flatten(item.items || [])]);
      const labels = flatten(panel.items).map(item => [item.label, item.value, item.caption, item.description, item.confirm].join(" ")).join(" ");
      assert.equal(labels.includes("Alice"), !masks.includes("names"));
      assert.equal(labels.includes("secret.example"), !masks.includes("urls"));
    });
    }
  }
  for (const masks of ["names", "avatars", "urls", "names,avatars,urls"]) {
    for (const screen of ["sidebar", "profile", "member", "mid"]) {
      await open(screen, masks);
      await check(`${screen} ${masks} image and background`, async () => {
        const target = screen === "sidebar" ? page.locator(".vy-sidebar-row").first() : page.getByRole("button", { name: "アイコンを拡大", exact: true });
        await target.waitFor();
        assert.equal(await target.locator("img").count() > 0, !masks.includes("avatars"));
        if (screen !== "sidebar") {
          const background = page.getByRole("button", { name: "背景を拡大", exact: true });
          if (screen === "profile") assert.equal(await background.isDisabled(), masks.includes("avatars"));
          else assert.equal(await background.count() > 0, !masks.includes("avatars"));
        }
      });
    }
  }
  await open("sidebar", "names");
  await check("masked MID copy", async () => {
    await page.locator(".vy-sidebar-row").first().click({ button: "right" });
    await page.getByText("MID をコピー", { exact: true }).click();
    assert.equal(await page.evaluate(() => window.copied), "[ID]");
  });
  await check("masked sidebar confirmation", async () => {
    await page.locator(".vy-sidebar-row").first().click({ button: "right" });
    await page.getByText("チャットをロック", { exact: true }).click();
    assert.ok(dialogs.length > 0);
    assert.ok(!dialogs.at(-1).includes("Alice"));
    assert.ok(!dialogs.at(-1).includes(`u${"a".repeat(32)}`));
  });
  for (const native of [false, true]) {
    for (const mask of ["urls", "names"]) {
    await open("profile", "off", `${native ? "native=1&" : ""}urlText=1`);
    await check(`${mask} editor mask switch ${native ? "native" : "React"}`, async () => {
      if (native) {
        await page.waitForFunction(() => document.getElementById("panel").textContent.includes("edit-name"));
        await page.evaluate(() => { const panel = JSON.parse(document.getElementById("panel").textContent); window.invoke("panel-action", panel.items.find(item => item.id.endsWith(":edit-name")).id); });
      } else await page.getByRole("button", { name: "表示名を変更", exact: true }).click();
      await page.evaluate(mask => window.setMasks(mask), mask);
      await page.waitForTimeout(50);
      if (native) {
        const panel = JSON.parse(await page.locator("#panel").textContent());
        assert.ok(!JSON.stringify(panel).includes(mask === "urls" ? "secret.example" : "Alice"));
      } else assert.ok(!(await page.locator("input").evaluateAll(nodes => nodes.map(node => node.value).join(" "))).includes(mask === "urls" ? "secret.example" : "Alice"));
    });
    }
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, [], failures.join("\n"));
  console.log(`${checks} social privacy checks passed; 0 page errors; all non-local requests blocked`);
} finally { await browser.close(); }
