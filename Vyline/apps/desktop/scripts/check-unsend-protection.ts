import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect, type Locator, type Page } from "@playwright/test";

// A disconnected demo exercises the real store -> renderer path. All media is
// local, and the fixture never opens an account or sends a LINE message.
const base = new URL(process.env.VYLINE_TEST_URL ?? "http://127.0.0.1:5173");
assert(["127.0.0.1", "localhost"].includes(base.hostname), "A local demo server is required");
const output = resolve(import.meta.dir, "../test-results/unsend-protection");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results: object[] = [];
type Fixture = "text" | "image" | "video" | "file" | "unknown" | "own";
const bodyText = "送信取り消し保護の本文";
const fileName = "保護した資料.pdf";
const missing = "元のメッセージは保存されていません";

async function fixture(page: Page, kind: Fixture, cancel: boolean) {
  await page.evaluate(
    async ({ kind, cancel, bodyText, fileName }) => {
      const module = performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .findLast((url) => /\/src\/lib\/store\.ts(?:\?|$)/.test(url));
      if (!module) throw new Error("Loaded store module required");
      const { useStore } = await import(module);
      const state = useStore.getState();
      if (!state.demoMode || state.accountId !== null)
        throw new Error("Account-free demo required");
      const id = `demo-protected-${kind}`;
      if (cancel) {
        const source = state.messages.find((message: { id: string }) => message.id === id);
        if (!source || source.messageState !== "normal")
          throw new Error("Received original required");
        useStore.setState({
          messages: [
            {
              ...source,
              kind: "system",
              text: "取り消されたメッセージ",
              messageState: kind === "own" ? "revoked-by-self" : "revoked-by-other",
              revokedSnapshot: source,
            },
          ],
        });
        return;
      }
      let video: string | undefined;
      if (kind === "video") {
        const canvas = document.createElement("canvas");
        canvas.width = 160;
        canvas.height = 90;
        const context = canvas.getContext("2d")!;
        context.fillStyle = "#007aff";
        context.fillRect(0, 0, 160, 90);
        const stream = canvas.captureStream(12);
        const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
        const chunks: Blob[] = [];
        recorder.ondataavailable = (event) => chunks.push(event.data);
        const stopped = new Promise<void>((resolve) => {
          recorder.onstop = () => resolve();
        });
        recorder.start();
        for (let frame = 0; frame < 24; frame++) {
          context.fillStyle = frame % 2 ? "#34c759" : "#007aff";
          context.fillRect(0, 0, 160, 90);
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        recorder.stop();
        await stopped;
        stream.getTracks().forEach((track) => track.stop());
        video = URL.createObjectURL(new Blob(chunks, { type: "video/webm" }));
      }
      useStore.setState({
        messages: [
          {
            id,
            chatId: state.activeChatId,
            authorId: kind === "own" ? "me" : "demo-alice",
            kind: kind === "unknown" ? "system" : kind === "own" ? "text" : kind,
            text:
              kind === "text" || kind === "own"
                ? bodyText
                : kind === "unknown"
                  ? "取り消されたメッセージ"
                  : undefined,
            imageSrc: kind === "image" ? "/demo/chat-photo.svg" : video,
            file:
              kind === "file"
                ? { name: fileName, size: 2048 }
                : kind === "image"
                  ? { name: "保護した画像.svg" }
                  : undefined,
            createdAt: Date.now(),
            status: "sent",
            read: false,
            messageState: kind === "unknown" ? "revoked-by-other" : "normal",
          },
        ],
        replyToId: null,
        settings: { ...state.settings, showReaderList: false },
      });
    },
    { kind, cancel, bodyText, fileName },
  );
}

async function point(page: Page, locator: Locator, button: "left" | "right" = "left") {
  await expect(locator).toBeAttached();
  let previous = "";
  await expect
    .poll(
      async () => {
        const next = JSON.stringify(await locator.boundingBox());
        const stable = next !== "null" && next === previous;
        previous = next;
        return stable;
      },
      { intervals: [100] },
    )
    .toBe(true);
  const box = await locator.boundingBox();
  assert(box);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button });
}

try {
  for (const mode of process.env.VYLINE_TEST_MODES?.split(",") ?? [
    "legacy",
    "nezu",
    "apple",
    "fluent",
    "miuix",
  ]) {
    for (const width of [1440, 390]) {
      const nativeMode = ["apple", "fluent", "miuix"].includes(mode);
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        hasTouch: width === 390,
        reducedMotion: "reduce",
      });
      const errors: string[] = [];
      const blocked: string[] = [];
      let stage = "load";
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/*", (route) => {
        const url = new URL(route.request().url());
        if (url.hostname === "fonts.googleapis.com")
          return route.fulfill({ contentType: "text/css", body: "" });
        if (url.origin !== base.origin || url.pathname.startsWith("/api/")) {
          blocked.push(`${route.request().method()} ${url.pathname}`);
          return route.abort();
        }
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
        await page.goto(new URL("/pr-demo", base).href);
        if (nativeMode)
          await expect(page.locator('[data-kmp-ready="true"]')).toBeVisible({ timeout: 60_000 });
        else
          await expect(
            page.getByRole("textbox", { name: "メッセージを入力", exact: true }),
          ).toBeVisible();
        const scope = nativeMode ? page.frameLocator('iframe[title="Vyline Compose UI"]') : page;
        for (const kind of ["text", "image", "video", "file", "unknown", "own"] as const) {
          stage = kind;
          await fixture(page, kind, false);
          if (kind !== "unknown") {
            await expect
              .poll(
                async () =>
                  await scope.getByText("送信が取り消されました", { exact: true }).count(),
              )
              .toBe(0);
            await fixture(page, kind, true);
          }
          const mergedSystemCell = nativeMode && kind === "unknown";
          const notice = mergedSystemCell
            ? scope.getByRole("button", { name: new RegExp(`${missing}.*送信が取り消されました`) })
            : scope
                .getByText(
                  kind === "own" ? "あなたが送信を取り消しました" : "送信が取り消されました",
                  { exact: true },
                )
                .first();
          await expect(notice).toBeVisible();
          const content =
            kind === "image"
              ? nativeMode
                ? scope.getByLabel("保護した画像.svg", { exact: true })
                : scope.getByRole("button", { name: "画像を拡大", exact: true })
              : kind === "video"
                ? scope.locator("video")
                : kind === "text" || kind === "own"
                  ? nativeMode
                    ? scope.getByRole("button", { name: bodyText, exact: true })
                    : scope.getByText(bodyText, { exact: true })
                  : mergedSystemCell
                    ? notice
                    : scope.getByText(kind === "file" ? fileName : missing, { exact: true });
          await expect(content).toBeVisible();
          const body = await content.boundingBox();
          const foot = await notice.boundingBox();
          assert(body && foot);
          // Compose merges this centered system cell into one accessibility node;
          // the screenshot verifies its two separate visual lines.
          assert(
            mergedSystemCell || foot.y >= body.y + body.height - 1,
            `${mode}/${width}/${kind}: notice must be under the content`,
          );
          assert(
            body.x >= -1 && body.x + body.width <= width + 1,
            `${mode}/${width}/${kind}: body fits the viewport`,
          );
          assert(
            foot.x >= -1 && foot.x + foot.width <= width + 1,
            `${mode}/${width}/${kind}: notice fits the viewport`,
          );

          if (kind === "text") {
            if (nativeMode) await point(page, content, "right");
            else {
              await page.getByRole("button", { name: "メッセージの操作", exact: true }).focus();
              await page.keyboard.press("Enter");
            }
            await expect(
              scope.getByRole(nativeMode ? "button" : "menuitem", { name: "コピー", exact: true }),
            ).toBeVisible();
            for (const name of [
              "返信",
              "リプライ",
              "リアクション",
              "いいね",
              "編集",
              "再送信",
              "送信を取り消す",
              "送信を取り消し",
            ])
              await expect(
                scope.getByRole(nativeMode ? "button" : "menuitem", { name, exact: true }),
              ).toHaveCount(0);
            await page.keyboard.press("Escape");
            await expect(
              scope.getByRole(nativeMode ? "button" : "menuitem", { name: "コピー", exact: true }),
            ).toHaveCount(0);
          } else if (kind === "image") {
            if (nativeMode) {
              await point(page, content);
              await expect(
                scope.getByRole("button", { name: "閉じる", exact: true }),
              ).toBeVisible();
              await expect(
                scope.getByRole("img", { name: "保護した画像.svg", exact: true }),
              ).toBeVisible();
            } else {
              await content.click();
              await expect(
                page.getByRole("dialog", { name: "メディア", exact: true }).getByRole("img"),
              ).toBeVisible();
            }
            await page.keyboard.press("Escape");
            await expect(notice).toBeVisible();
          } else if (kind === "video") {
            stage = "video start";
            await expect
              .poll(() => content.evaluate((element) => (element as HTMLMediaElement).readyState))
              .toBeGreaterThanOrEqual(1);
            await content.focus();
            await page.keyboard.press("Space");
            await expect
              .poll(() => content.evaluate((element) => (element as HTMLMediaElement).currentTime))
              .toBeGreaterThan(0);
            stage = "video pause";
            if (await content.evaluate((element) => !(element as HTMLMediaElement).paused))
              await page.keyboard.press("Space");
            await expect
              .poll(() => content.evaluate((element) => (element as HTMLMediaElement).paused))
              .toBe(true);
          }
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
          if (nativeMode)
            assert.equal(
              await scope.locator("html").evaluate((html) => html.scrollWidth),
              await scope.locator("html").evaluate((html) => html.clientWidth),
            );
          if (["text", "image", "video", "file", "unknown"].includes(kind))
            await page.screenshot({ path: resolve(output, `${mode}-${width}-${kind}.png`) });
          results.push({
            mode,
            width,
            kind,
            content: body,
            notice: foot,
            mergedSystemCell,
            videoPlayback: kind === "video",
            imageViewer: kind === "image",
          });
        }
        assert.deepEqual(errors, []);
        assert.deepEqual(
          blocked,
          [],
          "Demo validation must not request a backend or external server",
        );
        console.log(
          `${mode}/${width}: protected text/image/video/file, missing original, own unsend, actions and bounds PASS`,
        );
      } catch (error) {
        await page.screenshot({ path: resolve(output, `${mode}-${width}-failure.png`) });
        console.error({ mode, width, stage, errors, blocked });
        throw error;
      } finally {
        await page.close();
      }
    }
  }
  await writeFile(resolve(output, "results.json"), JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
