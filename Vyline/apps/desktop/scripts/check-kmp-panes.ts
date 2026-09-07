import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect, type Locator, type Page } from "@playwright/test";

const base = process.env.VYLINE_TEST_URL ?? "http://127.0.0.1:5173";
const output = resolve(import.meta.dir, "../test-results/kmp-panes");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results: object[] = [];

async function click(page: Page, locator: Locator) {
  await expect(locator).toBeAttached();
  const bounds = await locator.boundingBox();
  assert(
    bounds && bounds.width > 0 && bounds.height > 0,
    "Native control must have semantic bounds",
  );
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
}
async function state(page: Page) {
  return page.evaluate(async () => {
    // Vite may serve the application's store with a cache-busting HMR query.
    // Import that observed module, avoiding a second empty Zustand instance.
    const path = performance
      .getEntriesByType("resource")
      .find((entry) => new URL(entry.name).pathname === "/src/lib/store.ts")?.name;
    if (!path) throw new Error("The loaded store module was not observed");
    const { useStore } = await import(path);
    const state = useStore.getState();
    if (!state.demoMode || state.accountId !== null)
      throw new Error("Expected the loaded account-free demo store");
    return {
      ids: state.chatPaneIds,
      sizes: state.chatPaneSizes,
      active: state.activeChatId,
      profileOpen: state.profileDrawerOpen,
      drafts: state.drafts,
      messages: state.messages.filter((message: { text?: string }) =>
        message.text?.includes("ペイン検証"),
      ),
    };
  });
}

try {
  for (const mode of process.env.VYLINE_TEST_MODES?.split(",") ?? ["apple", "fluent", "miuix"]) {
    const page = await browser.newPage({
      viewport: { width: 1600, height: 1000 },
      deviceScaleFactor: 1,
    });
    const errors: string[] = [];
    const actions: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.text().startsWith("native-pane-action:")) actions.push(message.text());
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
        if (
          data?.channel === "vyline-ui" &&
          data.type === "action" &&
          ["pane-focus", "chat-details", "close-details", "profile"].includes(data.action)
        )
          console.info(`native-pane-action:${data.action}:${data.chatId}:${data.id}`);
      }),
    );
    await page.addInitScript(
      (mode) =>
        localStorage.setItem(
          "vyline:design-system",
          JSON.stringify({ state: { mode, appearance: "light" }, version: 0 }),
        ),
      mode,
    );
    try {
      console.log(`Checking ${mode} native panes`);
      await page.goto(`${base}/pr-demo`);
      await expect(page.locator('[data-kmp-ready="true"]')).toBeVisible({ timeout: 60_000 });
      const native = page.frameLocator('iframe[title="Vyline Compose UI"]');
      const editors = native.getByRole("textbox", { name: "メッセージを入力", exact: true });
      await expect(editors).toHaveCount(1);
      if (mode === "apple")
        await click(page, native.getByRole("button", { name: "トークのフィルタ", exact: true }));
      if (mode === "miuix")
        await click(page, native.getByRole("button", { name: "その他の操作", exact: true }));
      const ids = [
        "demo-chat-team",
        "demo-chat-gallery",
        "demo-chat-support",
        "demo-chat-official",
      ];
      const names = ["Vyline開発チーム", "機能ギャラリー", "サンプルサポート", "Vylineニュース"];
      const drafts = [
        "チームのペイン検証",
        "ギャラリーのペイン検証",
        "サポートのペイン検証",
        "ニュースのペイン検証",
      ];
      for (let count = 2; count <= 4; count++) {
        await click(
          page,
          native.getByRole("button", { name: "分割表示するトークを選択", exact: true }),
        );
        await expect(
          native.getByRole("button", { name: "キャンセル", exact: true }),
        ).toBeAttached();
        await click(
          page,
          native
            .getByRole("button")
            .filter({ hasText: names[count - 1] })
            .filter({
              hasText:
                count === 2
                  ? "あなた:"
                  : count === 3
                    ? "ヘルプを表示できます"
                    : "アップデート情報をお届けします",
            }),
        );
        await expect(editors).toHaveCount(count);
        await expect.poll(async () => (await state(page)).ids).toEqual(ids.slice(0, count));
        for (let index = count === 2 ? 0 : count - 1; index < count; index++) {
          await click(page, editors.nth(index));
          await page.keyboard.insertText(drafts[index]);
          await expect.poll(async () => (await state(page)).drafts[ids[index]]).toBe(drafts[index]);
          await expect.poll(async () => (await state(page)).active).toBe(ids[index]);
        }
        if (count === 2) {
          const divider = native.locator('[aria-label="ペイン 1 と 2 の幅を変更"]');
          await expect(divider).toBeAttached();
          const bounds = await divider.boundingBox();
          assert(bounds);
          const before = (await state(page)).sizes[0];
          await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
          await page.mouse.down();
          await page.mouse.move(bounds.x + 70, bounds.y + bounds.height / 2, { steps: 10 });
          await page.mouse.up();
          await expect.poll(async () => (await state(page)).sizes[0]).toBeGreaterThan(before + 1);
        }
        if (count === 3) {
          await click(page, native.getByRole("button", { name: "配置", exact: true }));
          await click(page, native.getByRole("button", { name: "右を分割", exact: true }));
          await expect
            .poll(async () => {
              const boxes = await Promise.all(
                [0, 1, 2].map((index) => editors.nth(index).boundingBox()),
              );
              return (
                !!boxes[0] &&
                !!boxes[1] &&
                !!boxes[2] &&
                boxes[0].x < boxes[1].x &&
                boxes[1].y < boxes[2].y
              );
            })
            .toBe(true);
        }
        if (count === 4) {
          await click(page, native.getByRole("button", { name: "配置", exact: true }));
          await click(page, native.getByRole("button", { name: "4分割", exact: true }));
          await expect
            .poll(async () => {
              const boxes = await Promise.all(
                [0, 1, 2, 3].map((index) => editors.nth(index).boundingBox()),
              );
              return (
                !!boxes[0] &&
                !!boxes[1] &&
                !!boxes[2] &&
                !!boxes[3] &&
                boxes[0].x < boxes[1].x &&
                boxes[0].y < boxes[2].y &&
                Math.abs(boxes[0].x - boxes[2].x) < 2
              );
            })
            .toBe(true);
        }
        await page.screenshot({ path: resolve(output, `${mode}-${count}-panes.png`) });
      }
      for (let index = 0; index < 4; index++)
        await expect.poll(async () => (await state(page)).drafts[ids[index]]).toBe(drafts[index]);

      assert(
        (await native.getByText("分割表示するトークを選択してください", { exact: true }).count()) <=
          1,
        "An application notice must not be duplicated in every pane",
      );
      // A partially scrolled HTML/Flex card must not cover or intercept the
      // native header. Exercise the actual header pointer route above the card.
      await click(page, native.getByRole("button", { name: "機能ギャラリーの情報", exact: true }));
      if (mode === "apple") {
        await expect(
          native.getByRole("button", { name: "トークの情報を閉じる", exact: true }),
        ).toBeAttached();
        await page.screenshot({ path: resolve(output, `${mode}-details-over-interop.png`) });
        await click(
          page,
          native.getByRole("button", { name: "トークの情報を閉じる", exact: true }),
        );
      } else {
        const details = page.getByRole("dialog", { name: "会話の詳細", exact: true });
        await expect(details).toBeVisible();
        await details.getByRole("button", { name: "閉じる", exact: true }).first().click();
      }
      await click(page, native.locator('[aria-label="Vylineニュースのペインを選択"]'));
      await expect.poll(async () => (await state(page)).active).toBe(ids[3]);

      // Send in a pane that is not currently focused: intent must route to its
      // own composer and chat, leaving all neighboring drafts intact.
      await click(page, native.getByRole("button", { name: "送信", exact: true }).nth(1));
      await expect
        .poll(async () =>
          (await state(page)).messages.map((message: { chatId: string; text: string }) => ({
            chatId: message.chatId,
            text: message.text,
          })),
        )
        .toEqual([{ chatId: ids[1], text: drafts[1] }]);
      for (const index of [0, 2, 3])
        await expect.poll(async () => (await state(page)).drafts[ids[index]]).toBe(drafts[index]);

      await page.setViewportSize({ width: 390, height: 844 });
      await expect(editors).toHaveCount(1);
      await expect.poll(async () => (await editors.boundingBox())?.x ?? 1000).toBeLessThan(390);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      await page.screenshot({ path: resolve(output, `${mode}-narrow-active-pane.png`) });
      await page.setViewportSize({ width: 1600, height: 1000 });
      await expect(editors).toHaveCount(4);
      await click(
        page,
        native.getByRole("button", { name: `${names[3]}のペインを閉じる`, exact: true }),
      );
      await expect(editors).toHaveCount(3);
      await expect.poll(async () => (await state(page)).ids).toEqual(ids.slice(0, 3));
      for (const index of [0, 2])
        await expect.poll(async () => (await state(page)).drafts[ids[index]]).toBe(drafts[index]);
      assert.deepEqual(errors, []);
      results.push({
        mode,
        paneCounts: [2, 3, 4],
        splitRight: true,
        grid: true,
        resizeDivider: true,
        independentDrafts: true,
        sendToUnfocusedPane: true,
        headerAccessibleAboveInterop: true,
        singleNotice: true,
        narrowAndWide: true,
        closePane: true,
        errors,
      });
    } catch (error) {
      await page.screenshot({ path: resolve(output, `${mode}-failure.png`) });
      console.error(
        JSON.stringify(
          {
            mode,
            errors,
            actions,
            headerHit: await page
              .frameLocator('iframe[title="Vyline Compose UI"]')
              .getByRole("button", { name: "機能ギャラリーの情報", exact: true })
              .evaluate((element) => {
                const bounds = element.getBoundingClientRect();
                const x = bounds.x + bounds.width / 2;
                const y = bounds.y + bounds.height / 2;
                const inspect = (node: Element) => ({
                  tag: node.tagName,
                  id: node.id,
                  style: node.getAttribute("style"),
                  html: node.outerHTML.slice(0, 450),
                  bounds: node.getBoundingClientRect().toJSON(),
                  pointerEvents: getComputedStyle(node).pointerEvents,
                  clipPath: getComputedStyle(node).clipPath,
                });
                let hit = document.elementFromPoint(x, y);
                const deep = [];
                while (hit) {
                  deep.push(inspect(hit));
                  const nested = hit.shadowRoot?.elementFromPoint(x, y);
                  if (!nested || nested === hit) break;
                  hit = nested;
                }
                const ancestors = [];
                for (let node = hit; node && ancestors.length < 8; ) {
                  ancestors.push(inspect(node));
                  const root = node.getRootNode();
                  node = node.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
                }
                return {
                  point: { x, y },
                  deep,
                  ancestors,
                  children: hit ? Array.from(hit.children).slice(0, 4).map(inspect) : [],
                };
              })
              .catch(() => null),
            state: await state(page).catch(() => null),
            buttons: await page
              .frameLocator('iframe[title="Vyline Compose UI"]')
              .getByRole("button")
              .allTextContents()
              .catch(() => []),
          },
          null,
          2,
        ),
      );
      throw error;
    } finally {
      await page.close();
    }
  }
  await writeFile(resolve(output, "results.json"), JSON.stringify(results, null, 2));
  console.log(results);
} finally {
  await browser.close();
}
