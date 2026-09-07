import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect, type Locator } from "@playwright/test";

const base = process.env.VYLINE_TEST_URL ?? "http://127.0.0.1:5173";
const output = resolve(
  import.meta.dir,
  process.env.VYLINE_TEST_OUTPUT ?? "../test-results/kmp-actions",
);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});
const results: object[] = [];
try {
  for (const mode of process.env.VYLINE_TEST_MODES?.split(",") ?? ["apple", "fluent", "miuix"]) {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    async function click(locator: Locator, button: "left" | "right" = "left") {
      await expect(locator).toBeAttached();
      const bounds = await locator.boundingBox();
      assert(bounds && bounds.width > 0);
      await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, { button });
    }
    try {
      console.log(`Checking ${mode} actions`);
      await page.addInitScript(
        (mode) =>
          localStorage.setItem(
            "vyline:design-system",
            JSON.stringify({ state: { mode, appearance: "light" }, version: 0 }),
          ),
        mode,
      );
      await page.goto(`${base}/pr-demo`);
      await expect(page.locator('[data-kmp-ready="true"]')).toBeVisible({ timeout: 60_000 });
      const native = page.frameLocator('iframe[title="Vyline Compose UI"]');
      const editor = native.getByRole("textbox", { name: "メッセージを入力", exact: true });
      const hostEditor = page.locator('.vy-react-renderer textarea[aria-label="メッセージを入力"]');
      const tools = native.getByRole("button", { name: "添付とその他の操作", exact: true });
      const record = native.getByRole("button", {
        name: mode === "apple" ? "音声メッセージを録音" : "音声",
        exact: true,
      });
      const row = native
        .getByRole("button")
        .filter({ hasText: "Vyline開発チーム" })
        .filter({ hasText: "あなた:" });

      await click(row, "right");
      await click(native.getByRole("button", { name: "ピン留めを解除", exact: true }));
      await expect(native.getByRole("button", { name: "ピン留めを解除", exact: true })).toHaveCount(
        0,
      );
      await click(row, "right");
      await expect(native.getByRole("button", { name: "ピン留め", exact: true })).toBeAttached();
      await page.keyboard.press("Escape");
      await expect(native.getByRole("button", { name: "ピン留め", exact: true })).toHaveCount(0);

      await click(editor);
      await page.keyboard.insertText("@");
      await click(native.getByRole("button", { name: "あおいをメンション", exact: true }));
      await expect(hostEditor).toHaveValue("@あおい");
      if (mode === "apple") await click(tools);
      await click(native.getByRole("button", { name: "スタンプと絵文字", exact: true }));
      const picker = page.getByRole("dialog", { name: "スタンプ・絵文字", exact: true });
      await expect(picker).toBeVisible();
      await picker.getByRole("button", { name: "絵文字", exact: true }).click();
      await picker.getByRole("button", { name: "✨", exact: true }).click();
      await expect(picker).toHaveCount(0);
      await expect(hostEditor).toHaveValue("@あおい\uFFFC");
      // The picker closes without moving focus into the hidden React composer.
      await expect(page.locator('iframe[title="Vyline Compose UI"]')).toBeFocused();
      if (mode === "apple") {
        await click(tools);
        await expect(
          native.getByRole("button", { name: "スタンプと絵文字", exact: true }),
        ).toHaveCount(0);
      }
      await click(native.getByRole("button", { name: "送信", exact: true }));
      await expect(hostEditor).toHaveValue("");
      await expect(native.getByRole("button", { name: /@あおい/ }).last()).toBeAttached();
      await expect(record).toBeAttached();

      await click(editor);
      await page.keyboard.insertText("編集を確認");
      await expect(hostEditor).toHaveValue("編集を確認");
      await page.keyboard.press("Enter");
      const sent = native.getByRole("button", { name: "編集を確認", exact: true });
      await click(sent, "right");
      await click(native.getByRole("button", { name: "編集", exact: true }));
      await click(native.getByRole("textbox", { name: "編集するメッセージ", exact: true }));
      await page.keyboard.press("Control+A");
      await page.keyboard.insertText("編集後のメッセージ");
      await expect(
        native.getByRole("textbox", { name: "編集するメッセージ", exact: true }),
      ).toContainText("編集後のメッセージ");
      await click(native.getByRole("button", { name: "変更を保存", exact: true }));
      const edited = native.getByRole("button", { name: "編集後のメッセージ", exact: true });
      await expect(edited).toBeAttached();
      await click(edited, "right");
      await click(native.getByRole("button", { name: "いいね", exact: true }));
      await expect(native.getByRole("button", { name: "いいね 1件", exact: true })).toBeAttached();
      await click(edited, "right");
      await click(native.getByRole("button", { name: "送信を取り消す", exact: true }));
      await expect(native.getByText("送信を取り消しますか？", { exact: true })).toBeAttached();
      await click(native.getByRole("button", { name: "送信を取り消す", exact: true }));
      await expect(edited).toHaveCount(0);

      await click(record);
      await expect(native.getByText(/録音中 0:0[1-9]/)).toBeAttached();
      await page.setViewportSize({ width: 390, height: 844 });
      await expect
        .poll(
          async () =>
            (await native.getByRole("button", { name: "取消", exact: true }).boundingBox())?.x ??
            1000,
        )
        .toBeLessThan(390);
      await click(native.getByRole("button", { name: "取消", exact: true }));
      await expect(native.getByText(/録音中/)).toHaveCount(0);
      await expect(editor).toBeAttached();
      await page.screenshot({ path: resolve(output, `${mode}-phone-light-2x.png`) });
      await click(native.getByRole("button", { name: "トーク一覧に戻る", exact: true }));
      await expect(
        native.getByRole("textbox", { name: "トークを検索", exact: true }),
      ).toBeAttached();
      await page.screenshot({ path: resolve(output, `${mode}-list-light-2x.png`) });
      assert.deepEqual(errors, []);
      const result = {
        base,
        mode,
        hostContextMenu: true,
        mentionAndSticon: true,
        edit: true,
        reaction: true,
        revoke: true,
        syntheticRecordingAndResize: true,
        mobileBackToList: true,
        deviceScaleFactor: 2,
        errors,
      };
      results.push(result);
      console.log(result);
    } catch (error) {
      await page.screenshot({ path: resolve(output, `${mode}-failure.png`) });
      console.error({
        mode,
        errors,
        focused: await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 700)),
        buttons: await page
          .frameLocator('iframe[title="Vyline Compose UI"]')
          .getByRole("button")
          .allTextContents()
          .catch(() => []),
      });
      throw error;
    } finally {
      await page.close();
    }
  }
  await writeFile(resolve(output, "results.json"), JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
