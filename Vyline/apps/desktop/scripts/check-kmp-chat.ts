import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect, type Locator, type Page } from "@playwright/test";

// Real Compose/Wasm controls + the existing Vyline /pr-demo store and send action.
// No LINE account, remote send, injected Kotlin store or screenshot-only mock.
const base = process.env.VYLINE_TEST_URL ?? "http://127.0.0.1:5173";
const output = resolve(
  import.meta.dir,
  process.env.VYLINE_TEST_OUTPUT ?? "../test-results/kmp-chat",
);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});
const results: object[] = [];

async function nativeClick(page: Page, locator: Locator, button: "left" | "right" = "left") {
  await expect(locator).toBeAttached();
  let previous = "";
  await expect
    .poll(
      async () => {
        const bounds = await locator.boundingBox();
        const current = JSON.stringify(bounds);
        const stable = !!bounds && bounds.width > 0 && bounds.height > 0 && current === previous;
        previous = current;
        return stable;
      },
      { intervals: [100], message: "Native control must have stable, nonzero semantic bounds" },
    )
    .toBe(true);
  const box = await locator.boundingBox();
  assert(box && box.width > 0 && box.height > 0, "Native control has no semantic bounds");
  // Compose accessibility nodes mirror the actual canvas controls. Use the real
  // pointer path, not an artificial click on the DOM mirror behind the canvas.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button });
}

async function openSettings(page: Page, mode: string) {
  const frame = page.frameLocator('iframe[title="Vyline Compose UI"]');
  if (mode === "apple" && (page.viewportSize()?.width ?? 0) < 760) {
    await nativeClick(page, frame.getByRole("button", { name: "添付とその他の操作", exact: true }));
    await expect(
      frame.getByRole("button", { name: "スタンプと絵文字", exact: true }),
    ).toBeAttached();
    await nativeClick(page, frame.getByRole("button", { name: "設定", exact: true }).last());
  } else await nativeClick(page, frame.getByRole("button", { name: "設定", exact: true }).last());
  await expect(frame.getByText("Vyline Classic", { exact: true })).toBeAttached();
}

try {
  for (const mode of ["apple", "fluent", "miuix"] as const) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      serviceWorkers: "block",
    });
    const blockedRequests: string[] = [];
    const apiRequests: string[] = [];
    // Keep this account-free run local; external fonts are optional, API calls
    // are not. Abort both, and fail if the demo attempts to contact an API.
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith("/api/")) {
        apiRequests.push(`${route.request().method()} ${url.origin}${url.pathname}`);
        return route.abort();
      }
      if (url.origin !== new URL(base).origin) {
        blockedRequests.push(`${route.request().method()} ${url.origin}${url.pathname}`);
        return route.abort();
      }
      return route.continue();
    });
    const page = await context.newPage();
    const errors: string[] = [];
    const wasm: string[] = [];
    console.log(`Checking ${mode}`);
    try {
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("response", (response) => {
        if (new URL(response.url()).pathname.endsWith(".wasm")) wasm.push(response.url());
      });
      await page.addInitScript(
        (mode) =>
          localStorage.setItem(
            "vyline:design-system",
            JSON.stringify({ state: { mode, appearance: "light" }, version: 0 }),
          ),
        mode,
      );
      const started = Date.now();
      await page.goto(`${base}/pr-demo`, { waitUntil: "domcontentloaded" });
      await expect(page.locator('[data-kmp-ready="true"]')).toBeVisible({ timeout: 60_000 });
      const frame = page.frameLocator('iframe[title="Vyline Compose UI"]');
      const editor = frame.getByRole("textbox", { name: "メッセージを入力", exact: true });
      await expect(editor).toBeAttached({ timeout: 30_000 });
      assert(wasm.length >= 2, "The browser must load both application Wasm and Skiko Wasm");
      const readyMs = Date.now() - started;
      const realEditor = await page
        .locator('.vy-react-renderer textarea[aria-label="メッセージを入力"]')
        .elementHandle();
      assert(realEditor, "The shared host composer must remain mounted");
      // Every renderer opens attachments through the composer tools menu now.
      // "ファイル" dispatches attach -> composerController.pickFiles() -> the
      // mounted host composer input; keep exercising the real browser chooser.
      await nativeClick(
        page,
        frame.getByRole("button", { name: "添付とその他の操作", exact: true }),
      );
      const files = frame.getByRole("button", { name: "ファイル", exact: true });
      const photos = frame.getByRole("button", { name: "写真・動画", exact: true });
      await expect(photos).toBeAttached();
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser"),
        nativeClick(page, files),
      ]);
      assert(
        await chooser.element().evaluate((input) =>
          input.matches('.vy-react-renderer .vy-composer input[type="file"]'),
        ),
        "Native attachment action must open the shared host composer file input",
      );
      await chooser.setFiles({
        name: "native-check.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=",
          "base64",
        ),
      });
      // Choosing an entry dismisses the menu (including its exit animation).
      // Do not toggle the plus button afterward: that would reopen the menu.
      await expect(files).toHaveCount(0);
      await expect(photos).toHaveCount(0);
      await expect(
        frame.getByRole("button", { name: "native-check.pngを削除", exact: true }),
      ).toBeAttached();
      await expect(page.locator(".vy-react-renderer")).toContainText("1 件のメディアを待機中");
      await nativeClick(
        page,
        frame.getByRole("button", { name: "native-check.pngを削除", exact: true }),
      );
      await expect(
        frame.getByRole("button", { name: "native-check.pngを削除", exact: true }),
      ).toHaveCount(0);
      await expect(page.locator(".vy-react-renderer")).not.toContainText("1 件のメディアを待機中");
      const text = `${mode} Composeからの確認\n日本語の2行目`;
      await nativeClick(page, editor);
      await page.keyboard.insertText(text.split("\n")[0]);
      await page.keyboard.press("Shift+Enter");
      await page.keyboard.insertText(text.split("\n")[1]);
      await expect.poll(() => realEditor.inputValue()).toBe(text);
      await page.keyboard.press("Enter");
      await expect.poll(() => realEditor.inputValue()).toBe("");
      await expect.poll(() => page.locator(".vy-react-renderer").textContent()).toContain(text);
      await expect(frame.getByRole("button", { name: text, exact: true })).toBeAttached();

      await nativeClick(page, frame.getByRole("button", { name: text, exact: true }), "right");
      await nativeClick(page, frame.getByRole("button", { name: "返信", exact: true }));
      await expect(page.locator(".vy-react-renderer")).toContainText(text);
      // Stable composer bounds do not imply it can receive input: the Miuix
      // reply sheet still intercepts clicks during its exit animation. Wait for
      // actual disposal, just as for the attachment menu, before the real click.
      await expect(frame.getByRole("button", { name: "返信", exact: true })).toHaveCount(0);
      await expect(
        frame.getByRole("button", { name: "返信をキャンセル", exact: true }),
      ).toBeAttached();
      await nativeClick(page, editor);
      await page.keyboard.insertText("切り替えで保持する下書き");
      await expect.poll(() => realEditor.inputValue()).toBe("切り替えで保持する下書き");
      await page.screenshot({ path: resolve(output, `${mode}-chat-light-1440.png`) });

      await openSettings(page, mode);
      await nativeClick(page, frame.getByRole("button", { name: "ダーク", exact: true }));
      await expect.poll(() => page.locator("html").getAttribute("data-appearance")).toBe("dark");
      await nativeClick(page, frame.getByRole("button", { name: "設定を閉じる", exact: true }));
      await expect.poll(() => realEditor.inputValue()).toBe("切り替えで保持する下書き");
      // A new page has no test initializer: it must restore the actual saved
      // design system and appearance from the same isolated browser context.
      const restored = await page.context().newPage();
      try {
        await restored.goto(`${base}/pr-demo`, { waitUntil: "domcontentloaded" });
        await expect(restored.locator('[data-kmp-ready="true"]')).toBeVisible({ timeout: 60_000 });
        await expect(restored.locator("html")).toHaveAttribute("data-ui-mode", mode);
        await expect(restored.locator("html")).toHaveAttribute("data-appearance", "dark");
      } finally {
        await restored.close();
      }
      await page.bringToFront();
      for (const width of [390, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        // Compose updates its AX mirror asynchronously after native layout. Await
        // the current header geometry before aiming a real pointer at a control.
        await expect
          .poll(async () => {
            const bounds = await editor.boundingBox();
            return (
              !!bounds && bounds.x + bounds.width > width - 250 && bounds.x + bounds.width <= width
            );
          })
          .toBe(true);
        assert(
          await realEditor.evaluate((node) => node.isConnected),
          "Resize must not remount the product composer",
        );
        const sizes = await page.evaluate(() => ({
          width: innerWidth,
          scroll: document.documentElement.scrollWidth,
        }));
        assert(sizes.scroll <= sizes.width, `Page overflow at ${width}px`);
        await expect(editor).toBeAttached();
        if (width === 390 || width === 1440)
          await page.screenshot({ path: resolve(output, `${mode}-chat-dark-${width}.png`) });
      }
      await openSettings(page, mode);
      await nativeClick(page, frame.getByText("Vyline Classic", { exact: true }));
      await expect(page.locator('iframe[title="Vyline Compose UI"]')).toHaveCount(0);
      // React settings is now the active view; return through its actual navigation.
      await page.getByRole("button", { name: "チャットに戻る", exact: true }).click();
      await expect(
        page.getByRole("textbox", { name: "メッセージを入力", exact: true }),
      ).toHaveValue("切り替えで保持する下書き");
      await expect(page.locator(".vy-react-renderer")).toContainText(text);
      assert.equal(apiRequests.length, 0, apiRequests.join("\n"));
      assert.equal(errors.length, 0, errors.join("\n"));
      results.push({
        base,
        mode,
        readyMs,
        wasmFiles: wasm.length,
        nativeSend: true,
        sharedStore: true,
        reply: true,
        attachmentChooser: true,
        attachmentRemoved: true,
        retainedDraft: true,
        retainedComposer: true,
        restoredThemeAndAppearance: true,
        widths: [390, 768, 1024, 1440],
        apiRequests,
        blockedRequests,
        errors,
      });
    } catch (error) {
      await page.screenshot({ path: resolve(output, `${mode}-failure.png`) });
      console.error(
        JSON.stringify({
          mode,
          errors,
          buttons: await page
            .frameLocator('iframe[title="Vyline Compose UI"]')
            .getByRole("button")
            .allTextContents()
            .catch(() => []),
          hit: await page
            .frameLocator('iframe[title="Vyline Compose UI"]')
            .getByRole("button", { name: "設定", exact: true })
            .last()
            .evaluate((el) => {
              const r = el.getBoundingClientRect();
              const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
              return {
                rect: { x: r.x, y: r.y, width: r.width, height: r.height },
                hit: hit?.outerHTML.slice(0, 1000),
                shadow: (() => {
                  const out = [];
                  let node = hit;
                  for (let i = 0; node?.shadowRoot && i < 5; i++) {
                    node = node.shadowRoot.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
                    out.push(node?.outerHTML.slice(0, 250));
                  }
                  return out;
                })(),
                chain: (() => {
                  const out = [];
                  for (let node = hit; node && out.length < 5; node = node.parentElement) {
                    const b = node.getBoundingClientRect();
                    out.push({
                      tag: node.tagName,
                      id: node.id,
                      style: node.getAttribute("style"),
                      width: b.width,
                      height: b.height,
                      pe: getComputedStyle(node).pointerEvents,
                    });
                  }
                  return out;
                })(),
              };
            })
            .catch(() => null),
          state: await page
            .evaluate(async () => {
              const path = performance
                .getEntriesByType("resource")
                .find((entry) => new URL(entry.name).pathname === "/src/lib/store.ts")?.name;
              if (!path) throw new Error("The loaded store module was not observed");
              const { useStore } = await import(path);
              if (!useStore.getState().demoMode || useStore.getState().accountId !== null)
                throw new Error("Expected the loaded account-free demo store");
              return { screen: useStore.getState().screen };
            })
            .catch(() => null),
        }),
      );
      throw error;
    } finally {
      await context.close();
    }
  }
  await writeFile(resolve(output, "results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
