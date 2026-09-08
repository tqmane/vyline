import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect, type Locator, type Page } from "@playwright/test";

const base = process.env.VYLINE_TEST_URL ?? "http://127.0.0.1:5173";
const origin = new URL(base).origin;
const output = resolve(import.meta.dir, "../test-results/plus-accessibility");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results: object[] = [];
const fakeAccount = "fixture-plus-account";
const fakeChat = "fixture-plus-chat";

// A blank page mounts only presentation components. App, account switching,
// useVylineSync, and call/media hooks never mount. No request reaches a backend.
async function fixture(mode: string) {
  const page = await browser.newPage({ viewport: { width: 375, height: 667 } });
  const apiRequests: string[] = [];
  const rejected: string[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) {
      rejected.push(url.origin);
      return route.abort();
    }
    if (url.pathname === "/pr-demo/plus-accessibility-fixture")
      return route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="fixture"></div></body></html>',
      });
    if (url.pathname.startsWith("/api/")) {
      const key = `${request.method()} ${url.pathname}`;
      apiRequests.push(key);
      const prefix = `/api/line/${fakeAccount}`;
      const responses: Record<string, unknown> = {
        [`GET ${prefix}/albums`]: {
          albums: [{ albumId: "fixture-album", title: "確認用アルバム" }],
        },
        [`GET ${prefix}/albums/fixture-album/photos`]: { photos: [] },
        [`GET ${prefix}/notes`]: { posts: [{ postId: "fixture-note", text: "確認用ノート" }] },
        [`POST ${prefix}/liff/warm`]: { ok: true },
      };
      if (!(key in responses)) {
        rejected.push(key);
        return route.abort();
      }
      return route.fulfill({ json: responses[key] });
    }
    if (request.method() !== "GET") {
      rejected.push(`${request.method()} ${url.pathname}`);
      return route.abort();
    }
    return route.continue();
  });
  await page.routeWebSocket("**/*", (socket) => socket.close());
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (["warning", "error"].includes(message.type())) warnings.push(message.text());
  });
  await page.goto(`${base}/pr-demo/plus-accessibility-fixture`);
  await page.evaluate(
    async ({ mode, fakeAccount, fakeChat }) => {
      const refresh = (await import("/@react-refresh")).default;
      refresh.injectIntoGlobalHook(window);
      const target = window as any;
      target.$RefreshReg$ = () => {};
      target.$RefreshSig$ = () => (type: unknown) => type;
      target.__vite_plugin_react_preamble_installed__ = true;
      await import("/src/index.css");
      await import("/src/ui/design-system.css");
      const reactModule = await import("/node_modules/.vite/deps/react.js");
      const React = reactModule.default ?? reactModule;
      const client = await import("/node_modules/.vite/deps/react-dom_client.js");
      const { PlusMenu } = await import("/src/components/plus-menu.tsx");
      const { ThemeApplier } = await import("/src/components/theme-applier.tsx");
      const storePath = performance
        .getEntriesByType("resource")
        .filter((entry) => new URL(entry.name).pathname === "/src/lib/store.ts")
        .at(-1)!.name;
      const { useStore } = await import(storePath);
      if (
        useStore.getState().accountId !== null ||
        localStorage.getItem("vyline:subdevice-session")
      )
        throw new Error("Fresh account-free browser required");
      const designPath = performance
        .getEntriesByType("resource")
        .filter((entry) => new URL(entry.name).pathname === "/src/ui/design-system-store.ts")
        .at(-1)!.name;
      const { useDesignSystemStore } = await import(designPath);
      useDesignSystemStore.setState({ mode, appearance: "light" });
      useStore.setState({
        demoMode: true,
        accountId: null,
        chats: [
          {
            id: fakeChat,
            name: "確認用グループ",
            type: "group",
            members: [
              { id: "fixture-a", name: "参加者あお", avatar: "あ", color: "#639" },
              { id: "fixture-b", name: "参加者みどり", avatar: "み", color: "#396" },
            ],
          },
        ],
      });
      const createRoot = client.createRoot ?? client.default.createRoot;
      const root = createRoot(document.getElementById("fixture")!);
      target.mountPlus = (loggedIn: boolean, embedded = false) => {
        useStore.setState({ accountId: loggedIn ? fakeAccount : null });
        root.render(
          React.createElement(
            React.Fragment,
            null,
            React.createElement(ThemeApplier),
            React.createElement(
              "main",
              { style: { position: "fixed", bottom: 24, left: 24, width: 280 } },
              React.createElement(PlusMenu, {
                chatId: fakeChat,
                embedded,
                key: `${loggedIn}-${embedded}`,
              }),
            ),
          ),
        );
      };
      target.mountCall = async (scenario: string) => {
        useStore.setState({ accountId: null });
        const { CallLayoutFixture } = await import("/scripts/call-layout-fixture.tsx");
        root.render(
          React.createElement(
            React.Fragment,
            null,
            React.createElement(ThemeApplier),
            React.createElement(CallLayoutFixture, { scenario }),
          ),
        );
      };
      target.mountPlus(false);
    },
    { mode, fakeAccount, fakeChat },
  );
  return { page, apiRequests, rejected, errors, warnings };
}

async function tabTo(page: Page, target: Locator) {
  for (let i = 0; i < 60; i++) {
    if (await target.evaluate((node) => node === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`Keyboard could not reach ${await target.getAttribute("aria-label")}`);
}

async function open(page: Page, label: string) {
  await tabTo(page, page.getByRole("button", { name: "メニューを開く" }));
  await page.keyboard.press("Enter");
  const item = page
    .getByRole("group", { name: "作成メニュー" })
    .getByRole("button", { name: label, exact: true });
  await tabTo(page, item);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  return page.getByRole("dialog");
}

async function close(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "メニューを開く" })).toBeFocused();
}

async function chooseFileByKeyboard(page: Page, input: Locator) {
  await tabTo(page, input);
  await expect(input).toBeFocused();
  const outline = await input.evaluate(
    (node) => getComputedStyle(node.parentElement!).outlineStyle,
  );
  assert.equal(outline, "solid", "File input must show its label focus ring");
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  await (await chooser).setFiles([]); // Cancel the picker; no upload or send action.
}

async function fits(dialog: Locator) {
  const box = await dialog.evaluate((node) => ({
    scroll: node.scrollWidth,
    client: node.clientWidth,
    rect: node.getBoundingClientRect().toJSON(),
  }));
  assert.ok(box.scroll <= box.client + 1, `Dialog overflow: ${JSON.stringify(box)}`);
  assert.ok(box.rect.x >= 0 && box.rect.y >= 0);
}

try {
  for (const mode of process.env.VYLINE_TEST_MODES?.split(",") ?? [
    "legacy",
    "apple",
    "fluent",
    "miuix",
    "nezu",
  ]) {
    const { page, apiRequests, rejected, errors, warnings } = await fixture(mode);
    try {
      for (const [width, height] of [
        [375, 667],
        [667, 375],
      ]) {
        await page.setViewportSize({ width, height });
        const requestsBeforeDisabledMenus = apiRequests.length;
        for (const embedded of [false, true]) {
          await page.evaluate((embedded) => (window as any).mountPlus(false, embedded), embedded);
          if (!embedded) await page.getByRole("button", { name: "メニューを開く" }).click();
          const menu = page.getByRole("group", { name: "作成メニュー" });
          await expect(menu.getByText("ログイン後に利用できます。")).toBeVisible();
          await expect(menu.getByRole("button")).toHaveCount(5);
          for (const button of await menu.getByRole("button").all())
            await expect(button).toBeDisabled();
        }
        assert.equal(apiRequests.length, requestsBeforeDisabledMenus);
        await page.evaluate(() => (window as any).mountPlus(true));
        await expect(page.getByRole("button", { name: "メニューを開く" })).toBeVisible();

        let dialog = await open(page, "あみだくじ");
        for (const name of ["参加者あお", "参加者みどり"]) {
          const checkbox = dialog.getByRole("checkbox", { name, exact: true });
          await tabTo(page, checkbox);
          await page.keyboard.press("Space");
          await expect(checkbox).toBeChecked();
        }
        await expect(dialog.getByRole("textbox", { name: "結果 1", exact: true })).toBeVisible();
        await expect(dialog.getByRole("textbox", { name: "結果 2", exact: true })).toBeVisible();
        await tabTo(page, dialog.getByRole("button", { name: "作成して送信", exact: true }));
        await page.keyboard.press("Enter"); // Validation only: blank results prevent generate/send.
        await expect(dialog.getByRole("alert")).toHaveText("結果を2個入力してください");
        await fits(dialog);
        await close(page);

        dialog = await open(page, "イベントを作成");
        await tabTo(page, dialog.getByRole("button", { name: "+ 日時を追加", exact: true }));
        await page.keyboard.press("Enter");
        await expect(dialog.getByLabel("候補日時 2", { exact: true })).toHaveAttribute(
          "type",
          "datetime-local",
        );
        await tabTo(page, dialog.getByRole("button", { name: "候補日時 2 を削除", exact: true }));
        await page.keyboard.press("Enter");
        await expect(dialog.getByLabel("候補日時 2", { exact: true })).toHaveCount(0);
        await tabTo(page, dialog.getByRole("button", { name: "作成して共有", exact: true }));
        await page.keyboard.press("Enter"); // Blank title/time: validation only.
        await expect(dialog.getByRole("alert")).toHaveText(
          "タイトルと日時を 1 つ以上入力してください",
        );
        await fits(dialog);
        await close(page);

        dialog = await open(page, "アンケート");
        await expect(dialog.getByRole("textbox", { name: "選択肢 2", exact: true })).toBeVisible();
        await expect(
          dialog.getByRole("button", { name: "選択肢 1 を削除", exact: true }),
        ).toBeDisabled();
        await expect(dialog.getByText("選択肢（2 つ以上）", { exact: true })).toBeVisible();
        await tabTo(page, dialog.getByRole("button", { name: "+ 選択肢を追加", exact: true }));
        await page.keyboard.press("Enter");
        await expect(dialog.getByRole("textbox", { name: "選択肢 3", exact: true })).toBeVisible();
        await tabTo(page, dialog.getByRole("button", { name: "選択肢 3 を削除", exact: true }));
        await page.keyboard.press("Enter");
        await expect(dialog.getByRole("textbox", { name: "選択肢 3", exact: true })).toHaveCount(0);
        await tabTo(page, dialog.getByRole("button", { name: "作成", exact: true }));
        await page.keyboard.press("Enter"); // Blank title/choices: validation only.
        await expect(dialog.getByRole("alert")).toHaveText(
          "タイトルと選択肢を 2 つ以上入力してください",
        );
        await fits(dialog);
        await close(page);

        dialog = await open(page, "アルバム");
        const album = dialog.getByRole("button", { name: "確認用アルバム fixture-album" });
        await expect(album).toBeVisible();
        await tabTo(page, album);
        await page.keyboard.press("Enter");
        const photoInput = dialog.getByLabel("写真追加", { exact: true });
        await expect(photoInput).toBeEnabled();
        await chooseFileByKeyboard(page, photoInput);
        await fits(dialog);
        await close(page);

        dialog = await open(page, "ノート");
        const commentInput = dialog.getByLabel("コメント画像", { exact: true });
        await expect(commentInput).toBeDisabled();
        const note = dialog.getByRole("button", { name: "確認用ノート fixture-note" });
        await expect(note).toBeVisible();
        await tabTo(page, note);
        await page.keyboard.press("Enter");
        await expect(commentInput).toBeEnabled();
        await expect(
          dialog.getByRole("combobox", { name: "リアクションの種類", exact: true }),
        ).toBeVisible();
        await chooseFileByKeyboard(page, commentInput);
        await fits(dialog);
        await page.screenshot({ path: resolve(output, `${mode}-note-${width}.png`) });
        await close(page);
        results.push({
          mode,
          width,
          height,
          checks:
            "all five modals: keyboard, accessible names, input validation, file picker cancel, Escape focus return; both account-free menu variants disabled",
        });
      }

      if (["apple", "fluent", "miuix"].includes(mode)) {
        for (const [width, height] of [
          [375, 667],
          [667, 375],
          [1440, 900],
        ]) {
          await page.setViewportSize({ width, height });
          await page.evaluate(() => (window as any).mountCall("connecting"));
          const status = page.locator('.vy-call-overlay [role="status"][aria-live="polite"]');
          await expect(status).toHaveText("接続中…");
          await page.evaluate(() => (window as any).mountCall("failed"));
          await expect(status).toHaveText("接続を確認してから、もう一度お試しください。");
          await expect(status).toHaveAttribute("aria-atomic", "true");
          await page.evaluate(() => (window as any).mountCall("camera-unavailable"));
          const camera = page.getByRole("button", {
            name: "カメラを開始してビデオ通話に切り替え",
            exact: true,
          });
          await expect(camera).toBeDisabled();
          await expect(camera).toHaveAccessibleDescription(
            "相手または接続方式がビデオに対応していないため、カメラは利用できません。",
          );
          const reason = page.getByText(
            "相手または接続方式がビデオに対応していないため、カメラは利用できません。",
            { exact: true },
          );
          await expect(reason).toBeVisible();
          await expect(reason).toBeInViewport();
          const controls = await page.locator(".vy-call-controls button").evaluateAll((buttons) =>
            buttons.map((button) => {
              const rect = button.getBoundingClientRect();
              return {
                name: button.getAttribute("aria-label"),
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
                within:
                  rect.x >= 0 &&
                  rect.y >= 0 &&
                  rect.right <= innerWidth &&
                  rect.bottom <= innerHeight,
                hit: button.contains(
                  document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
                ),
              };
            }),
          );
          for (const control of controls)
            assert.ok(
              control.within && control.hit && control.width >= 44 && control.height >= 44,
              JSON.stringify(control),
            );
          await page.screenshot({
            path: resolve(output, `${mode}-camera-unavailable-${width}.png`),
          });
          results.push({
            mode,
            width,
            height,
            checks:
              "call connecting → error polite live status; unavailable camera accessible and visible reason; control 44px viewport/hit-test",
          });
        }
      }
      assert.deepEqual(rejected, [], "Unexpected network request was blocked");
      assert.deepEqual(errors, [], "Browser runtime errors");
      results.push({ mode, apiRequests, rejected, errors, warnings });
      await writeFile(resolve(output, "results.json"), JSON.stringify(results, null, 2));
      console.log(`${mode}: passed`);
    } catch (error) {
      await page.screenshot({ path: resolve(output, `${mode}-failure.png`) });
      await writeFile(
        resolve(output, `${mode}-failure.txt`),
        `${String(error)}\n${JSON.stringify({ apiRequests, rejected, errors, warnings }, null, 2)}\n${await page.locator("body").ariaSnapshot()}`,
      );
      throw error;
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}
