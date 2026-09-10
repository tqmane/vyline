import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect, type Locator, type Page } from "@playwright/test";

const base = process.env.VYLINE_TEST_URL ?? "http://127.0.0.1:5173";
const output = resolve(import.meta.dir, "../test-results/kmp-navigation-interactions");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results: object[] = [];
async function bounds(locator: Locator) {
  await expect(locator).toBeAttached({ timeout: 15_000 });
  let last = "";
  await expect
    .poll(
      async () => {
        const box = await locator.boundingBox();
        const next = JSON.stringify(box);
        const stable = next === last && !!box && box.width > 0 && box.height > 0;
        last = next;
        return stable;
      },
      { intervals: [100], timeout: 10_000 },
    )
    .toBe(true);
  const box = await locator.boundingBox();
  assert(box);
  return box;
}
async function click(page: Page, locator: Locator) {
  const box = await bounds(locator);
  if (process.env.VYLINE_TEST_VERBOSE)
    console.log("click", await locator.getAttribute("aria-label"), box);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}
async function read(page: Page) {
  return page.evaluate(async () => {
    const path = performance
      .getEntriesByType("resource")
      .find((entry) => new URL(entry.name).pathname === "/src/lib/store.ts")?.name;
    if (!path) throw new Error("Loaded demo store was not observed");
    const { useStore } = await import(path);
    const s = useStore.getState();
    if (!s.demoMode || s.accountId !== null)
      throw new Error("Expected isolated, account-free demo");
    return {
      active: s.activeChatId,
      screen: s.screen,
      collapsed: s.sidebarCollapsed,
      width: s.sidebarWidth,
      order: s.customOrder,
      paneIds: s.chatPaneIds,
      paneSizes: s.chatPaneSizes,
      paneLayout: s.chatPaneLayout,
      settings: s.settings,
      name: s.self.name,
      chats: s.chats.map(
        (c: { id: string; unread: number; hidden: boolean; pinned: boolean; muted: boolean }) => ({
          id: c.id,
          unread: c.unread,
          hidden: c.hidden,
          pinned: c.pinned,
          muted: c.muted,
        }),
      ),
      design: JSON.parse(localStorage.getItem("vyline:design-system") ?? "{}").state,
    };
  });
}
async function drag(page: Page, from: Locator, to: { x: number; y: number }) {
  const b = await bounds(from);
  await page.mouse.move(b.x + b.width * 0.4, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 15 });
  await page.mouse.up();
}

try {
  for (const mode of process.env.VYLINE_TEST_MODES?.split(",") ?? ["apple", "fluent", "miuix"]) {
    const page = await browser.newPage({
      viewport: { width: 1600, height: 1400 },
      deviceScaleFactor: 1,
    });
    const errors: string[] = [];
    const verified: string[] = [];
    const actions: string[] = [];
    let stage = "load";
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.text().startsWith("navigation-action:")) actions.push(message.text().slice(18));
    });
    await page.addInitScript(() =>
      window.addEventListener("message", (event) => {
        let data = event.data;
        if (typeof data === "string") {
          try {
            data = JSON.parse(data);
          } catch {
            return;
          }
        }
        if (data?.channel === "vyline-ui" && data.type === "action")
          console.info(`navigation-action:${data.action}`);
      }),
    );
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(base).origin && ["http:", "https:"].includes(url.protocol))
        return route.abort();
      // This audit exercises local fixture state only; no backend endpoint is contacted.
      if (url.pathname.startsWith("/api/")) return route.abort();
      return route.continue();
    });
    await page.addInitScript(
      (mode) =>
        localStorage.setItem(
          "vyline:design-system",
          JSON.stringify({ state: { mode, appearance: "light" }, version: 0 }),
        ),
      mode,
    );
    try {
      console.log(`${mode}: navigation load`);
      await page.goto(`${base}/pr-demo`);
      await expect(page.locator('[data-kmp-ready="true"]')).toBeVisible({ timeout: 60_000 });
      const native = page.frameLocator('iframe[title="Vyline Compose UI"]');
      const button = (name: string) => native.getByRole("button", { name, exact: true });
      const row = (name: string) =>
        native
          .getByRole("list", { name: "トーク一覧", exact: true })
          .getByRole("button")
          .filter({ hasText: name })
          .filter({
            hasText:
              name === "サンプルサポート"
                ? "ヘルプを表示できます"
                : name === "Vylineニュース"
                  ? "アップデート情報をお届けします"
                  : "あなた:",
          });
      const search = native.getByRole("textbox", { name: "トークを検索", exact: true });
      await expect(search).toBeAttached({ timeout: 60_000 });
      await read(page);
      const commandMenu = async () => {
        if (await button("並び順").count()) return;
        await click(page, button(mode === "apple" ? "トークのフィルタ" : "その他の操作"));
      };

      if (mode === "fluent") {
        stage = "compact rail hover and navigation expand collapse";
        const friend = button("友だち");
        const rail = await bounds(friend);
        assert(rail.x >= 0 && rail.x + rail.width <= 48, "Fluent compact rail stays 48px wide");
        await page.mouse.move(rail.x + rail.width / 2, rail.y + rail.height / 2);
        await page.waitForTimeout(1000);
        await expect(search).toBeAttached();
        await expect(friend).toBeAttached();
        await click(page, button("ナビゲーション").last());
        const expandedFriend = native.getByRole("button", { name: /友だち/ }).first();
        await expect
          .poll(async () => (await expandedFriend.boundingBox())?.width ?? 0)
          .toBeGreaterThan(rail.width + 100);
        await click(page, button("ナビゲーション").last());
        await expect
          .poll(async () => (await friend.boundingBox())?.width ?? 999)
          .toBeCloseTo(rail.width, 0);
        verified.push(stage);
      }

      stage = "self profile opens profile settings";
      const selfProfile =
        mode === "fluent"
          ? button("プロフィール")
          : native.getByRole("button").filter({ hasText: "デモユーザー" });
      await click(page, selfProfile);
      const profileSettings = page.getByRole("dialog", { name: "詳細設定", exact: true });
      await expect(profileSettings).toBeVisible();
      await expect(
        profileSettings
          .getByRole("navigation", { name: "設定カテゴリ" })
          .getByRole("button", { name: "プロフィール", exact: true }),
      ).toHaveAttribute("aria-current", "page");
      await profileSettings.getByRole("button", { name: "チャットに戻る", exact: true }).click();
      await expect(profileSettings).toHaveCount(0);
      verified.push(stage);

      stage = "search clear and Escape";
      await click(page, search);
      await page.keyboard.insertText("サンプルサポート");
      await expect(row("サンプルサポート")).toBeAttached();
      await expect(row("機能ギャラリー")).toHaveCount(0);
      await click(page, button("検索をクリア"));
      await expect(row("機能ギャラリー")).toBeAttached();
      await click(page, search);
      await page.keyboard.insertText("存在しないトーク");
      await expect(native.getByText("見つかりませんでした", { exact: true })).toBeAttached();
      await page.keyboard.press("Escape");
      await expect(row("機能ギャラリー")).toBeAttached();
      verified.push(stage);

      stage = "all five category filters";
      await commandMenu();
      for (const [label, present, absent] of [
        ["友だち", "サンプルサポート", "Vyline開発チーム"],
        ["グループ", "Vyline開発チーム", "サンプルサポート"],
        ["公式", "Vylineニュース", "Vyline開発チーム"],
        ["非表示", "", "Vyline開発チーム"],
        ["全体", "機能ギャラリー", ""],
      ]) {
        const filter = button(label).or(native.getByRole("tab", { name: label, exact: true }));
        await click(page, filter);
        // Leave the rail item so its hover tooltip does not cover the next AX lookup.
        await page.mouse.move(600, 500);
        if (present) await expect(row(present)).toBeAttached();
        if (absent) await expect(row(absent)).toHaveCount(0);
      }
      verified.push(stage);

      stage = "sort modes and mark all read";
      for (const [id, label] of [
        ["unread", "未読順"],
        ["recent", "最新順"],
        ["custom", "カスタム順"],
      ]) {
        await click(page, button("並び順"));
        await click(page, button(label));
        await expect.poll(async () => (await read(page)).settings.chatSort).toBe(id);
      }
      await click(page, button("並び順"));
      await click(page, button("すべて既読にする"));
      await expect.poll(() => actions.includes("mark-all-read")).toBe(true);
      // Existing store intentionally skips account-required bulk receipts in demoMode.
      assert((await read(page)).chats.some((c: { unread: number }) => c.unread > 0));
      verified.push(stage);

      stage = "row menu pin mute hide restore";
      const context = async (name: string) => {
        const area = await bounds(row(name));
        await page.mouse.click(area.x + area.width * 0.4, area.y + area.height / 2, {
          button: "right",
        });
        await expect(button("ピン留め").or(button("ピン留めを解除"))).toBeAttached();
      };
      await context("機能ギャラリー");
      await click(page, button("ピン留め"));
      await expect
        .poll(
          async () =>
            (await read(page)).chats.find((c: { id: string }) => c.id === "demo-chat-gallery")
              ?.pinned,
        )
        .toBe(true);
      await context("機能ギャラリー");
      await click(page, button("ピン留めを解除"));
      await expect
        .poll(
          async () =>
            (await read(page)).chats.find((c: { id: string }) => c.id === "demo-chat-gallery")
              ?.pinned,
        )
        .toBe(false);
      await context("機能ギャラリー");
      await click(page, button("通知をミュート"));
      await expect
        .poll(
          async () =>
            (await read(page)).chats.find((c: { id: string }) => c.id === "demo-chat-gallery")
              ?.muted,
        )
        .toBe(true);
      await context("機能ギャラリー");
      await click(page, button("非表示にする"));
      await expect(row("機能ギャラリー")).toHaveCount(0);
      await click(
        page,
        button("非表示").or(native.getByRole("tab", { name: "非表示", exact: true })),
      );
      await expect(row("機能ギャラリー")).toBeAttached();
      await context("機能ギャラリー");
      await click(page, button("非表示を解除"));
      await expect(row("機能ギャラリー")).toHaveCount(0);
      await click(page, button("全体").or(native.getByRole("tab", { name: "全体", exact: true })));
      await expect(row("機能ギャラリー")).toBeAttached();
      verified.push(stage);

      stage = "custom row pointer reorder";
      const beforeOrder = (await read(page)).order;
      const target = await bounds(row("サンプルサポート"));
      await drag(page, row("機能ギャラリー"), {
        x: target.x + target.width * 0.4,
        y: target.y + target.height / 2,
      });
      await expect.poll(async () => (await read(page)).order).not.toEqual(beforeOrder);
      await expect
        .poll(async () => {
          const s = await read(page);
          return s.order.indexOf("demo-chat-gallery") > s.order.indexOf("demo-chat-support");
        })
        .toBe(true);
      verified.push(stage);

      stage = "sidebar resize drag keyboard reset collapse restore";
      const divider = button("サイドバーの幅を調整（ダブルクリックでリセット）");
      const resetHeaderX = (await bounds(button("サイドバーを閉じる"))).x;
      const sidebarBounds = async () => {
        await expect
          .poll(async () => {
            const box = await divider.boundingBox();
            return box ? Math.abs(box.x - (await read(page)).width) : 9999;
          })
          .toBeLessThan(2);
        return bounds(divider);
      };
      let b = await sidebarBounds();
      await drag(page, divider, { x: b.x + 60, y: b.y + b.height / 2 });
      await expect.poll(async () => (await read(page)).width).toBeGreaterThan(400);
      await sidebarBounds();
      await click(page, divider);
      // Key input immediately follows the pointer press; do not wait for double-click recognition.
      const width = (await read(page)).width;
      await page.keyboard.press("ArrowLeft");
      await expect.poll(async () => (await read(page)).width).toBe(width - 16);
      await page.keyboard.press("Home");
      await expect.poll(async () => (await read(page)).width).toBe(360);
      b = await sidebarBounds();
      await drag(page, divider, { x: b.x + 50, y: b.y + b.height / 2 });
      b = await sidebarBounds();
      await page.mouse.dblclick(b.x + b.width / 2, b.y + b.height / 2, { delay: 80 });
      await expect.poll(async () => (await read(page)).width).toBe(360);
      // Compose 1.12.0 debounces its web accessibility tree up to 1s. Wait for
      // the header to acquire the reset layout before pointer hit testing.
      await expect
        .poll(async () => (await button("サイドバーを閉じる").boundingBox())?.x ?? 9999)
        .toBeCloseTo(resetHeaderX, 0);
      await click(page, button("サイドバーを閉じる"));
      await expect.poll(async () => (await read(page)).collapsed).toBe(true);
      await expect(search).toHaveCount(0);
      await click(page, button("サイドバーを開く"));
      await expect.poll(async () => (await read(page)).collapsed).toBe(false);
      await expect(search).toBeAttached();
      verified.push(stage);

      stage = "row drag into split pane and pane focus move close";
      const editor = native.getByRole("textbox", { name: "メッセージを入力", exact: true });
      b = await bounds(editor);
      await drag(page, row("機能ギャラリー"), { x: 1570, y: b.y - 150 });
      await expect
        .poll(async () => (await read(page)).paneIds)
        .toEqual(["demo-chat-team", "demo-chat-gallery"]);
      await expect(editor).toHaveCount(2);
      stage = "pane divider immediate click and arrow keys";
      const paneDivider = native.locator('[aria-label="ペイン 1 と 2 の幅を変更"]');
      const paneSize = (await read(page)).paneSizes[0];
      await click(page, paneDivider);
      await page.keyboard.press("ArrowLeft");
      await expect.poll(async () => (await read(page)).paneSizes[0]).toBeLessThan(paneSize);
      await page.keyboard.press("ArrowRight");
      await expect.poll(async () => (await read(page)).paneSizes[0]).toBeCloseTo(paneSize);
      verified.push(stage);
      stage = "row drag into split pane and pane focus move close";
      await click(
        page,
        button("機能ギャラリーのペインを選択").or(
          native.getByRole("tab", { name: "機能ギャラリーのペインを選択", exact: true }),
        ),
      );
      await expect.poll(async () => (await read(page)).active).toBe("demo-chat-gallery");
      await click(page, button("配置"));
      await click(page, button("機能ギャラリーのペインを前へ移動"));
      await expect
        .poll(async () => (await read(page)).paneIds)
        .toEqual(["demo-chat-gallery", "demo-chat-team"]);
      await expect
        .poll(async () => {
          const gallery = await native
            .locator('[aria-label="機能ギャラリーのペインを選択"]')
            .boundingBox();
          const team = await native
            .locator('[aria-label="Vyline開発チームのペインを選択"]')
            .boundingBox();
          return !!gallery && !!team && gallery.x < team.x;
        })
        .toBe(true);
      await click(page, button("配置"));
      await click(page, button("機能ギャラリーのペインを閉じる"));
      await expect(editor).toHaveCount(1);
      await expect.poll(async () => (await read(page)).paneIds).toEqual(["demo-chat-team"]);
      verified.push(stage);

      stage = "split picker cancel and selection";
      await commandMenu();
      await click(page, button("分割表示するトークを選択"));
      await click(page, button("キャンセル"));
      await expect(button("キャンセル")).toHaveCount(0);
      await click(page, button("分割表示するトークを選択"));
      await expect(button("キャンセル")).toBeAttached();
      await click(page, row("サンプルサポート"));
      await expect
        .poll(async () => (await read(page)).paneIds)
        .toEqual(["demo-chat-team", "demo-chat-support"]);
      await click(page, button("サンプルサポートのペインを閉じる"));
      verified.push(stage);

      stage = "settings Escape";
      await click(page, button("設定").first());
      await expect.poll(async () => (await read(page)).screen).toBe("settings");
      await expect(button("設定を閉じる")).toBeAttached();
      await page.keyboard.press("Escape");
      await expect.poll(async () => (await read(page)).screen).toBe("chat");
      await expect(button("設定を閉じる")).toHaveCount(0);
      verified.push(stage);

      stage = "five native settings and appearance";
      await click(page, button("設定").first());
      await expect(button("設定を閉じる")).toBeAttached();
      for (const [id, label] of [
        ["enterToSend", "Enterで送信"],
        ["voiceMessagesEnabled", "ボイスメッセージ"],
        ["compactDensity", "コンパクト表示"],
        ["bubbleTail", "吹き出しのしっぽ"],
        ["showReaderList", "既読の表示"],
      ]) {
        const before = (await read(page)).settings[id];
        await click(page, native.locator(`[aria-label="${label}"]`));
        await expect.poll(async () => (await read(page)).settings[id]).toBe(!before);
      }
      for (const [value, label] of [
        ["dark", "ダーク"],
        ["system", "システム"],
        ["light", "ライト"],
      ]) {
        await click(page, button(label));
        await expect.poll(async () => (await read(page)).design.appearance).toBe(value);
      }
      verified.push(stage);

      stage = "advanced settings category navigation and demo profile save";
      await click(page, button("アカウント・バックアップ・詳細設定"));
      const details = page.getByRole("dialog", { name: "詳細設定", exact: true });
      await expect(details).toBeVisible();
      const nav = details.getByRole("navigation", { name: "設定カテゴリ", exact: true });
      const categories = [
        "プロフィール",
        "既読",
        "表示",
        "外観・UI",
        "通知",
        "プライバシー",
        "詳細・復元",
        "サブデバイス",
        "ストレージ",
        "通話記録",
        "プラグイン",
        "ベータ機能",
        "引継ぎ・診断",
        "情報",
      ];
      for (const category of categories) {
        const tab = nav.getByRole("button", { name: category, exact: true });
        await tab.click();
        await expect(tab).toHaveAttribute("aria-current", "page");
      }
      await nav.getByRole("button", { name: "プロフィール", exact: true }).click();
      await details.locator('input:not([type="file"])').first().fill(`操作監査 ${mode}`);
      await details.getByRole("button", { name: "LINE に保存", exact: true }).click();
      await expect(
        details.getByText("デモプロフィールを更新しました", { exact: true }),
      ).toBeVisible();
      await expect.poll(async () => (await read(page)).name).toBe(`操作監査 ${mode}`);
      await details.getByRole("button", { name: "チャットに戻る", exact: true }).click();
      await expect(details).toHaveCount(0);
      verified.push(stage);

      stage = "native renderer switch preserves changed settings";
      const next =
        mode === "apple"
          ? ["fluent", "Fluent"]
          : mode === "fluent"
            ? ["miuix", "Miuix"]
            : ["apple", "iMessage"];
      const settingsBefore = (await read(page)).settings;
      await click(
        page,
        button(next[1]).or(native.getByRole("radio", { name: next[1], exact: true })),
      );
      await expect.poll(async () => (await read(page)).design.mode).toBe(next[0]);
      await expect(button("設定を閉じる")).toBeAttached({ timeout: 60_000 });
      assert.deepEqual((await read(page)).settings, settingsBefore);
      const originalTheme = mode === "apple" ? "iMessage" : mode === "fluent" ? "Fluent" : "Miuix";
      await click(
        page,
        button(originalTheme).or(native.getByRole("radio", { name: originalTheme, exact: true })),
      );
      await expect.poll(async () => (await read(page)).design.mode).toBe(mode);
      await expect(button("設定を閉じる")).toBeAttached({ timeout: 60_000 });
      assert.deepEqual((await read(page)).settings, settingsBefore);
      await click(page, button("設定を閉じる"));
      await expect.poll(async () => (await read(page)).screen).toBe("chat");
      verified.push(stage);

      stage = "narrow back and row open";
      await page.setViewportSize({ width: 390, height: 844 });
      await click(page, button("トーク一覧に戻る"));
      await expect(search).toBeAttached();
      await click(page, row("サンプルサポート"));
      await expect.poll(async () => (await read(page)).active).toBe("demo-chat-support");
      await expect(search).toHaveCount(0);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      verified.push(stage);
      await page.screenshot({ path: resolve(output, `${mode}-narrow.png`) });
      assert.deepEqual(errors, []);
      results.push({ mode, verified, pageErrors: errors });
      await writeFile(resolve(output, "results.json"), JSON.stringify(results, null, 2));
      console.log(`${mode}: ${verified.length} desktop interaction groups passed`);
    } catch (error) {
      await page.screenshot({ path: resolve(output, `${mode}-failure.png`) });
      await writeFile(
        resolve(output, `${mode}-failure.txt`),
        `${stage}\n${error}\n${JSON.stringify(actions)}\n${await page.frameLocator('iframe[title="Vyline Compose UI"]').locator("body").ariaSnapshot()}`,
      );
      throw new Error(`${mode} / ${stage}: ${error}`);
    } finally {
      await page.close();
    }

    const touchPage = await browser.newPage({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      userAgent:
        "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
    });
    let touchStage = "touch load";
    try {
      await touchPage.route("**/*", (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== new URL(base).origin && ["http:", "https:"].includes(url.protocol))
          return route.abort();
        if (url.pathname.startsWith("/api/")) return route.abort();
        return route.continue();
      });
      await touchPage.addInitScript(
        (mode) =>
          localStorage.setItem(
            "vyline:design-system",
            JSON.stringify({ state: { mode, appearance: "light" }, version: 0 }),
          ),
        mode,
      );
      await touchPage.goto(`${base}/pr-demo`);
      const native = touchPage.frameLocator('iframe[title="Vyline Compose UI"]');
      const button = (name: string) => native.getByRole("button", { name, exact: true });
      const tap = async (locator: Locator) => {
        const b = await bounds(locator);
        await touchPage.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
      };
      await tap(button("トーク一覧に戻る"));
      await expect(
        native.getByRole("textbox", { name: "トークを検索", exact: true }),
      ).toBeAttached();
      if (mode === "apple") await tap(button("編集"));
      if (mode === "miuix") await tap(button("その他の操作"));
      await tap(button("並び順"));
      await tap(button("カスタム順"));
      await expect.poll(async () => (await read(touchPage)).settings.chatSort).toBe("custom");
      await expect(button("カスタム順")).toHaveCount(0);
      const gallery = native
        .getByRole("list", { name: "トーク一覧", exact: true })
        .getByRole("button")
        .filter({ hasText: "機能ギャラリー" })
        .filter({ hasText: "あなた:" });
      const cdp = await touchPage.context().newCDPSession(touchPage);
      touchStage = "touch longpress row menu and mobile reorder";
      let b = await bounds(gallery);
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: b.x + b.width * 0.4, y: b.y + b.height / 2 }],
      });
      // Deliberately exceed the real native long-press threshold; no API/store injection.
      await touchPage.waitForTimeout(650);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await expect(button("1つ下へ移動")).toBeAttached();
      const before = (await read(touchPage)).order;
      await tap(button("1つ下へ移動"));
      await expect.poll(async () => (await read(touchPage)).order).not.toEqual(before);
      await expect(button("1つ下へ移動")).toHaveCount(0);
      touchStage = "touch movement cancels row longpress";
      b = await bounds(gallery);
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: b.x + b.width * 0.4, y: b.y + b.height / 2 }],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: b.x + b.width * 0.4, y: b.y + b.height / 2 - 55 }],
      });
      await touchPage.waitForTimeout(650);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await expect(button("ピン留め")).toHaveCount(0);
      await expect(button("1つ下へ移動")).toHaveCount(0);
      assert(await touchPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await touchPage.screenshot({ path: resolve(output, `${mode}-touch-list.png`) });
      results.push({
        mode,
        touch: ["row longpress menu", "mobile reorder", "movement cancels longpress"],
        blocked: [
          "real account switching, login, logout",
          "bulk read receipts require an account",
          "backend-dependent setting actions",
        ],
      });
      await writeFile(resolve(output, "results.json"), JSON.stringify(results, null, 2));
      console.log(`${mode}: 3 touch interaction groups passed`);
    } catch (error) {
      await touchPage.screenshot({ path: resolve(output, `${mode}-touch-failure.png`) });
      await writeFile(
        resolve(output, `${mode}-touch-failure.txt`),
        `${touchStage}\n${error}\n${await touchPage.frameLocator('iframe[title="Vyline Compose UI"]').locator("body").ariaSnapshot()}`,
      );
      throw new Error(`${mode} / ${touchStage}: ${error}`);
    } finally {
      await touchPage.close();
    }
  }
  await writeFile(resolve(output, "results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
