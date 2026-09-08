import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect, type Locator, type Page } from "@playwright/test";

const base = process.env.VYLINE_TEST_URL ?? "http://127.0.0.1:5173";
const output = resolve(import.meta.dir, "../test-results/kmp-hosted-actions");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
async function click(page: Page, locator: Locator, button: "left" | "right" = "left") {
  await expect(locator).toBeAttached();
  const rect = await locator.boundingBox();
  assert(rect);
  await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2, { button });
}
try {
  for (const mode of ["apple", "fluent", "miuix"]) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(
      (mode) =>
        localStorage.setItem(
          "vyline:design-system",
          JSON.stringify({ state: { mode, appearance: "light" }, version: 0 }),
        ),
      mode,
    );
    try {
      await page.goto(`${base}/pr-demo`);
      await expect(page.locator('[data-kmp-ready="true"]')).toBeVisible({ timeout: 60_000 });
      const native = page.frameLocator('iframe[title="Vyline Compose UI"]');
      await page.evaluate(async () => {
        const { useStore } = await import(
          performance
            .getEntriesByType("resource")
            .map((entry) => entry.name)
            .find((url) => /\/src\/lib\/store\.ts(?:\?|$)/.test(url))!
        );
        const state = useStore.getState();
        if (!state.demoMode || state.accountId !== null) throw new Error("Demo-only check");
        const chat = state.chats.find((chat: { id: string }) => chat.id === state.activeChatId);
        const author = chat.members.find((member: { id: string }) => member.id !== "me");
        const message = {
          id: "demo-hosted-parity",
          chatId: chat.id,
          authorId: "me",
          kind: "text",
          text: "互換表示の機能を確認",
          createdAt: Date.now(),
          status: "sent",
          messageState: "normal",
          readBy: [author.id],
          readByAt: { [author.id]: Date.now() },
          edited: true,
          originalText: "編集前",
        };
        useStore.setState({ messages: [...state.messages, message] });
      });
      await click(
        page,
        native.getByRole("button", { name: "互換表示の機能を確認", exact: true }),
        "right",
      );
      await click(page, native.getByRole("button", { name: "詳細・その他の操作", exact: true }));
      const detail = page.getByRole("dialog", { name: "メッセージの詳細", exact: true });
      await expect(detail).toBeVisible();
      await detail.getByRole("button", { name: "メッセージの操作", exact: true }).click();
      await page.getByRole("menuitem", { name: "部分コピー", exact: true }).click();
      const partial = page.getByRole("dialog", { name: "メッセージを部分コピー", exact: true });
      await expect(partial.getByRole("textbox")).toBeVisible();
      await expect(partial).toHaveJSProperty("open", true);
      await page.keyboard.press("Escape");
      await expect(partial).toHaveCount(0);
      await expect(detail).toBeVisible();

      await detail.getByRole("button", { name: "メッセージの操作", exact: true }).click();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu")).toHaveCount(0);
      await expect(detail).toBeVisible();
      await detail.getByRole("button", { name: "メッセージの操作", exact: true }).click();
      await page.getByRole("menuitem", { name: "編集", exact: true }).click();
      const edit = page.getByRole("dialog", { name: "メッセージを編集", exact: true });
      const input = edit.getByRole("textbox", { name: "編集後のメッセージ", exact: true });
      await expect(input).toBeFocused();
      await input.fill("互換編集後");
      await input.dispatchEvent("keydown", { key: "Enter", isComposing: true });
      await expect(edit).toBeVisible();
      await edit.getByRole("button", { name: "保存する", exact: true }).click();
      await expect(edit).toHaveCount(0);
      await expect(detail).toContainText("互換編集後");
      await detail.getByRole("button", { name: "メッセージの操作", exact: true }).click();
      await page.getByRole("menuitem", { name: "送信を取り消し", exact: true }).click();
      await expect(detail).toContainText("あなたが送信を取り消しました");
      await detail.getByRole("button", { name: "メッセージの操作", exact: true }).click();
      await page.getByRole("menuitem", { name: "履歴を表示", exact: true }).click();
      const history = page.getByRole("dialog", { name: "メッセージ履歴", exact: true });
      await expect(history).toBeVisible();
      await expect(history).toHaveJSProperty("open", true);
      await page.keyboard.press("Escape");
      await detail.getByRole("button", { name: "閉じる", exact: true }).click();

      await page.evaluate(async () => {
        const { useStore } = await import(
          performance
            .getEntriesByType("resource")
            .map((entry) => entry.name)
            .find((url) => /\/src\/lib\/store\.ts(?:\?|$)/.test(url))!
        );
        const state = useStore.getState();
        const chat = state.chats.find((chat: { id: string }) => chat.id === state.activeChatId);
        const author = chat.members.find((member: { id: string }) => member.id !== "me");
        useStore.setState({
          messages: state.messages.map((message: { id: string }) =>
            message.id !== "demo-hosted-parity"
              ? message
              : {
                  ...message,
                  authorId: author.id,
                  kind: "image",
                  text: undefined,
                  messageState: "normal",
                  history: undefined,
                  revokedSnapshot: undefined,
                  originalText: undefined,
                  edited: false,
                  imageSrc:
                    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='120'%3E%3Crect width='200' height='120' fill='%23006ee6'/%3E%3C/svg%3E",
                  linkPreview: {
                    url: "https://example.com",
                    site: "Vyline",
                    title: "ホスト内メディア",
                    description: "画像と送信者の情報",
                    thumb: "画像",
                  },
                },
          ),
        });
      });
      const card = native.locator(".vy-kmp-inline-content").filter({ hasText: "ホスト内メディア" });
      await expect(card).toBeVisible();
      await page.mouse.move(800, 450);
      await page.mouse.wheel(0, 600);
      const authorButton = card.locator("[data-vy-message-content] > button").first();
      await expect(authorButton).toBeVisible();
      const metrics = await card.evaluate((element) => ({
        width: element.clientWidth,
        scrollWidth: element.scrollWidth,
        color: getComputedStyle(element).color,
      }));
      assert(metrics.scrollWidth <= metrics.width + 1);
      assert.equal(metrics.color, "rgb(25, 25, 27)");
      await card.getByRole("button", { name: "画像を拡大", exact: true }).click();
      const lightbox = page.getByRole("dialog", { name: "メディア", exact: true });
      await expect(lightbox).toHaveJSProperty("open", true);
      await expect(lightbox.getByRole("img")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(lightbox).toHaveCount(0);
      const hostScroll = await page.evaluate(() => ({
        y: scrollY,
        frameTop: document.querySelector("iframe")?.getBoundingClientRect().top,
      }));
      const nativeScroll = await native.locator("html").evaluate(() =>
        Array.from(document.querySelectorAll("*"))
          .filter((element) => element.scrollTop !== 0)
          .map((element) => ({
            tag: element.tagName,
            id: element.id,
            top: element.scrollTop,
            overflow: getComputedStyle(element).overflow,
          })),
      );
      assert.equal(hostScroll.y, 0);
      assert.deepEqual(nativeScroll.filter((element) => element.id === "composeApp"), []);
      await page.screenshot({ path: resolve(output, `${mode}-hosted.png`) });
      await page.evaluate(async () => {
        const resources = performance.getEntriesByType("resource").map((entry) => entry.name);
        const { useStore } = await import(
          resources.find((url) => /\/src\/lib\/store\.ts(?:\?|$)/.test(url))!
        );
        const { useDesignSystemStore } = await import(
          resources.find((url) => /\/src\/ui\/design-system-store\.ts(?:\?|$)/.test(url))!
        );
        const state = useStore.getState();
        if (!state.demoMode || state.accountId !== null) throw new Error("Demo-only check");
        useStore.setState({
          settings: {
            ...state.settings,
            fontScale: 1.3,
            compactDensity: true,
            animationMode: "none",
          },
        });
        useDesignSystemStore.getState().setAppearance("dark");
      });
      await expect(card).toHaveCSS("color", "rgb(245, 245, 247)");
      await expect
        .poll(() =>
          card.evaluate((element) =>
            getComputedStyle(element).getPropertyValue("--vy-font-scale").trim(),
          ),
        )
        .toBe("1.3");
      await expect
        .poll(() =>
          card.evaluate((element) =>
            getComputedStyle(element).getPropertyValue("--vy-msg-pad-x").trim(),
          ),
        )
        .toBe("0.55rem");
      await expect
        .poll(() =>
          card.evaluate(
            (element) =>
              ((element.getRootNode() as ShadowRoot).host as HTMLElement).dataset.animationMode,
          ),
        )
        .toBe("none");
      await page.mouse.move(800, 450);
      await page.mouse.wheel(0, 600);
      await expect(card.getByRole("button", { name: "画像を拡大", exact: true })).toBeInViewport();
      await page.screenshot({ path: resolve(output, `${mode}-hosted-dark.png`) });
      assert.deepEqual(errors, []);
      console.log({
        mode,
        nestedEdit: true,
        partialCopy: true,
        history: true,
        lightbox: true,
        sender: true,
        displaySettings: true,
        metrics,
        errors,
      });
    } catch (error) {
      await page.screenshot({ path: resolve(output, `${mode}-failure.png`) });
      console.error({ mode, errors, dialogs: await page.locator("dialog").allTextContents() });
      throw error;
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}
