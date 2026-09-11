import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect, type Locator, type Page } from "@playwright/test";
const base = "http://127.0.0.1:5186";
const output = resolve(import.meta.dir, "../test-results/group-features");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const mid = (index: number) => `u${index.toString(16).padStart(32, "0")}`;
const group = `c${"3".repeat(32)}`;
const members = Array.from({ length: 40 }, (_, index) => ({ mid: mid(index + 1), displayName: index === 0 ? "友だち1" : `参加者${index + 1}` }));
const friends = [members[0], ...Array.from({ length: 50 }, (_, index) => ({ mid: mid(index + 100), displayName: `友だち候補${index + 100}` }))];
const results: object[] = [];
async function point(page: Page, locator: Locator, gesture: "click" | "tap" | "hold" | "context" = "click") {
  await expect(locator).toBeAttached();
  let previous = "";
  await expect.poll(async () => {
    const next = JSON.stringify(await locator.boundingBox());
    const stable = next !== "null" && next === previous;
    previous = next;
    return stable;
  }, { intervals: [100] }).toBe(true);
  const box = await locator.boundingBox();
  assert(box && box.width > 0 && box.height > 0);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  if (gesture === "tap") await page.touchscreen.tap(x, y);
  else if (gesture === "hold") {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.waitForTimeout(650);
    await page.mouse.up();
  } else await page.mouse.click(x, y, { button: gesture === "context" ? "right" : "left" });
}


try {
  for (const mode of process.env.VYLINE_TEST_MODES?.split(",") ?? ["legacy", "apple", "fluent", "miuix"]) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.emulateMedia({ reducedMotion: "reduce" });
    let memberRequests = 0;
    let saved: unknown;
    let stage = "load";
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => {
      const request = route.request(); const url = new URL(request.url());
      if (url.origin !== base) return route.abort();
      if (url.pathname === `/api/line/fixture-members/chats/${group}/members`) {
        if (url.searchParams.get("refresh") === "1") memberRequests++;
        return route.fulfill({ json: { ok: true, chatMid: group, name: "検証グループ", members } });
      }
      if (url.pathname === `/api/line/fixture-members/chats/${group}/invite-reject`) {
        if (request.method() === "GET") return route.fulfill({ json: { ok: true, rule: { enabled: false, targetMids: [] }, friends } });
        saved = request.postDataJSON();
        return route.fulfill({ json: { ok: true, rule: saved } });
      }
      if (url.pathname.startsWith("/api/")) return route.abort();
      return route.continue();
    });
    try {
      await page.addInitScript(mode => localStorage.setItem("vyline:design-system", JSON.stringify({ state: { mode, appearance: "dark" }, version: 0 })), mode);
      await page.goto(`${base}/pr-demo`);
      if (mode !== "legacy") await expect(page.locator('[data-kmp-ready="true"]')).toBeVisible({ timeout: 90_000 });
      else await expect(page.locator("textarea").first()).toBeVisible();
      await page.evaluate(async ({ group, members }) => {
        const path = performance.getEntriesByType("resource").map(entry => entry.name).find(url => /\/src\/lib\/store\.ts(?:\?|$)/.test(url));
        const { useStore } = await import(path!); const state = useStore.getState();
        if (!state.demoMode || state.accountId !== null) throw new Error("Demo only");
        const chat = { ...state.chats[0], id: group, type: "group", name: "検証グループ", members: [{ id: members[0].mid, name: members[0].displayName, avatar: "友", color: "#345" }] };
        useStore.setState({ accountId: "fixture-members", chats: [chat], activeChatId: group, chatPaneIds: [group], focusedChatPane: 0, messages: [], drafts: {} });
      }, { group, members });
      const native = page.frameLocator('iframe[title="Vyline Compose UI"]');
      stage = "all members and keyboard scrolling";
      const editor = mode === "legacy" ? page.locator("textarea").first() : native.getByRole("textbox", { name: "メッセージを入力", exact: true });
      await point(page, editor); await page.keyboard.insertText("@");
      await expect.poll(() => memberRequests).toBeGreaterThan(0);
      await expect.poll(() => page.evaluate(async group => {
        const path = performance.getEntriesByType("resource").map(entry => entry.name).find(url => /\/src\/ui\/composer-controller\.ts(?:\?|$)/.test(url));
        const { getComposerController } = await import(path!);
        return getComposerController(group)?.snapshot.mentionOptions.length;
      }, group)).toBe(41);
      for (let index = 0; index < 40; index++) await page.keyboard.press("ArrowDown");
      const selected = mode === "legacy" ? page.getByRole("option", { name: /参加者40/ }) : native.getByRole("button", { name: "参加者40をメンション", exact: true });
      await expect(selected).toBeAttached();
      await expect(selected).toHaveAttribute("aria-selected", "true");
      const selectionBounds = await selected.boundingBox(); const editorBounds = await editor.boundingBox();
      assert(selectionBounds && editorBounds && selectionBounds.y >= 0 && selectionBounds.y + selectionBounds.height <= editorBounds.y + 1);
      await page.screenshot({ path: resolve(output, `${mode}-mention.png`) });
      await page.keyboard.press("Enter");
      await expect.poll(() => page.evaluate(async group => {
        const path = performance.getEntriesByType("resource").map(entry => entry.name).find(url => /\/src\/lib\/store\.ts(?:\?|$)/.test(url));
        const { useStore } = await import(path!); return useStore.getState().draftMentions[group]?.at(-1)?.mid;
      }, group)).toBe(mid(40));
      await page.keyboard.press("Control+A"); await page.keyboard.press("Backspace");
      stage = "friend-only invite rejection";
      if (mode === "legacy") {
        await page.getByRole("button", { name: "メニューを開く", exact: true }).click();
        await page.getByRole("button", { name: "招待拒否", exact: true }).click();
        await expect(page.getByText("友だち 51人 · 選択 0人", { exact: true })).toBeVisible();
        await page.getByRole("searchbox", { name: "招待拒否の友だちを検索", exact: true }).fill("友だち候補149");
        await page.getByRole("checkbox", { name: /友だち候補149/ }).check();
        await page.getByRole("checkbox", { name: "このグループで有効にする", exact: true }).check();
        await page.getByRole("button", { name: "保存して適用", exact: true }).click();
      } else {
        await point(page, native.getByRole("button", { name: "添付とその他の操作", exact: true }));
        await point(page, native.getByRole("button", { name: "ノート・アルバム・イベント", exact: true }));
        await expect(native.getByRole("heading", { name: "ノート・アルバム・イベント", exact: true })).toBeAttached();
        await point(page, native.getByRole("button", { name: "招待拒否", exact: true }));
        await expect(native.getByRole("heading", { name: "招待拒否", exact: true })).toBeAttached();
        await expect.poll(() => native.locator("body").ariaSnapshot()).toContain("友だち 51人");
        assert(!(await native.locator("body").ariaSnapshot()).includes("参加者40"));
        await point(page, native.getByRole("textbox", { name: "招待拒否の友だちを検索", exact: true }));
        await page.keyboard.insertText("友だち候補149");
        await expect(native.getByRole("switch")).toHaveCount(2);
        await point(page, native.getByRole("switch", { name: "友だち候補149", exact: true }));
        await point(page, native.getByRole("switch", { name: "このグループで有効にする", exact: true }));
        await point(page, native.getByRole("button", { name: "保存して適用", exact: true }));
      }
      await expect.poll(() => saved).toEqual({ enabled: true, targetMids: [mid(149)] });
      const screen = mode === "legacy" ? await page.locator("body").ariaSnapshot() : await native.locator("body").ariaSnapshot();
      assert(!/u[0-9a-f]{32}/.test(screen), "Candidate UI displays names, not MIDs");
      await page.screenshot({ path: resolve(output, `${mode}-invite-reject.png`) });
      assert.deepEqual(errors, []); results.push({ mode, allGroupMembers: true, selectionScroll: true, allFriendCandidates: true, savedRule: true });
    } catch (error) {
      await page.screenshot({ path: resolve(output, `${mode}-failure.png`) });
      console.error({ mode, stage, errors, aria: mode === "legacy" ? await page.locator("body").ariaSnapshot() : await page.frameLocator('iframe[title="Vyline Compose UI"]').locator("body").ariaSnapshot() }); throw error;
    } finally { await page.close(); }
  }
  await writeFile(resolve(output, "results.json"), JSON.stringify(results, null, 2)); console.log(results);
} finally { await browser.close(); }
