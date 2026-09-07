import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect, type Locator, type Page } from "@playwright/test";

// Exercise the real Compose canvas against /pr-demo. Store reads only verify
// the effects of UI input; no injected message, Kotlin state, or LINE account.
const base = process.env.VYLINE_TEST_URL ?? "http://127.0.0.1:5173";
const output = resolve(import.meta.dir, "../test-results/kmp-parity");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results: object[] = [];

async function click(page: Page, locator: Locator, button: "left" | "right" = "left") {
  await expect(locator).toBeAttached();
  let previous = "";
  await expect
    .poll(
      async () => {
        const current = JSON.stringify(await locator.boundingBox());
        const stable = current !== "null" && current === previous;
        previous = current;
        return stable;
      },
      { intervals: [100] },
    )
    .toBe(true);
  const bounds = await locator.boundingBox();
  assert(bounds && bounds.width > 0 && bounds.height > 0, "Native control must have canvas bounds");
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, { button });
}

try {
  for (const mode of ["apple", "fluent", "miuix"]) {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
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
      console.log(`Checking ${mode} feature parity`);
      await page.goto(`${base}/pr-demo`);
      await expect(page.locator('[data-kmp-ready="true"]')).toBeVisible({ timeout: 60_000 });
      const native = page.frameLocator('iframe[title="Vyline Compose UI"]');
      const editor = native.getByRole("textbox", { name: "メッセージを入力", exact: true });
      const hostEditor = page.locator('.vy-react-renderer textarea[aria-label="メッセージを入力"]');
      const original = "個人情報を含まない安全なPRデモです。";
      const bubble = native.getByRole("button", { name: original, exact: true });
      await expect(bubble).toBeAttached();
      const fixture = await page.evaluate(async () => {
        const path = performance
          .getEntriesByType("resource")
          .find((entry) => new URL(entry.name).pathname === "/src/lib/store.ts")?.name;
        if (!path) throw new Error("The loaded store module was not observed");
        const { useStore, formatTime } = await import(path);
        if (!useStore.getState().demoMode || useStore.getState().accountId !== null)
          throw new Error("Expected the loaded account-free demo store");
        const message = useStore
          .getState()
          .messages.find((message: { id: string }) => message.id === "demo-message-4");
        return {
          time: formatTime(message.createdAt),
          readerTimes: Object.values(message.readByAt).map((time) =>
            new Intl.DateTimeFormat("ja-JP", {
              month: "numeric",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            }).format(new Date(time as number)),
          ),
        };
      });
      await expect(native.getByText(fixture.time, { exact: true }).first()).toBeAttached();
      await click(page, native.getByRole("button", { name: "既読者一覧 2人", exact: true }).last());
      for (const [index, name] of ["あおい", "れん"].entries())
        await expect(
          native.getByRole("button", {
            name: `${name}、${fixture.readerTimes[index]}、プロフィールを開く`,
            exact: true,
          }),
        ).toBeAttached();
      await page.screenshot({ path: resolve(output, `${mode}-reader-times.png`) });
      await page.keyboard.press("Escape");
      await expect(
        native.getByRole("button", { name: "既読一覧を閉じる", exact: true }),
      ).toHaveCount(0);

      // A real held pointer must open the same menu as a context click.
      const bounds = await bubble.boundingBox();
      assert(bounds);
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(700);
      await page.mouse.up();
      for (const name of [
        "返信",
        "コピー",
        "編集",
        "送信を取り消す",
        "詳細・その他の操作",
        "いいね",
        "ハート",
        "笑い",
        "驚き",
        "悲しい",
        "びっくり",
      ])
        await expect(native.getByRole("button", { name, exact: true })).toBeAttached();
      await page.screenshot({ path: resolve(output, `${mode}-longpress.png`) });
      await click(page, native.getByRole("button", { name: "返信", exact: true }));
      await expect(
        native.getByRole("button", { name: "返信をキャンセル", exact: true }),
      ).toBeAttached();
      await click(page, editor);
      await page.keyboard.insertText("返信先ジャンプの確認");
      await expect(hostEditor).toHaveValue("返信先ジャンプの確認");
      await page.keyboard.press("Enter");
      // The quote is a Compose semantic label, exposed as an accessible name.
      const quoteControl = native.locator('[aria-label="返信先へ移動"]');
      await expect(quoteControl).toBeAttached();
      await click(page, quoteControl);
      await expect
        .poll(() =>
          page.evaluate(async () => {
            const path = performance
              .getEntriesByType("resource")
              .find((entry) => new URL(entry.name).pathname === "/src/lib/store.ts")?.name;
            if (!path) throw new Error("The loaded store module was not observed");
            const { useStore } = await import(path);
            if (!useStore.getState().demoMode || useStore.getState().accountId !== null)
              throw new Error("Expected the loaded account-free demo store");
            return useStore.getState().highlightMessageId;
          }),
        )
        .toBe("demo-message-4");

      if (mode === "apple")
        await click(page, native.getByRole("button", { name: "添付とその他の操作", exact: true }));
      await click(page, native.getByRole("button", { name: "トーク内を検索", exact: true }));
      const search = native.getByRole("textbox", { name: "トーク内を検索", exact: true });
      await click(page, search);
      await page.keyboard.insertText("検索");
      await expect(native.getByText("1/1", { exact: true })).toBeAttached();
      await expect(
        native.getByRole("button", {
          name: "検索、返信、スタンプ、テーマ変更などを実際のUIで操作できます。",
          exact: true,
        }),
      ).toBeAttached();
      await click(page, native.getByRole("button", { name: "次の一致", exact: true }));
      await expect(native.getByText("1/1", { exact: true })).toBeAttached();
      await click(page, native.getByRole("button", { name: "検索を閉じる", exact: true }));
      await expect(search).toHaveCount(0);

      await click(page, bubble, "right");
      await click(page, native.getByRole("button", { name: "詳細・その他の操作", exact: true }));
      const details = page.getByRole("dialog", { name: "メッセージの詳細", exact: true });
      await expect(details).toBeVisible();
      await details.getByRole("button", { name: "メッセージの操作", exact: true }).click();
      await details.getByRole("menuitem", { name: "アナウンスを追加", exact: true }).click();
      await details.getByRole("button", { name: "閉じる", exact: true }).click();
      const announcement = native.getByRole("button", {
        name: `アナウンス: ${original}`,
        exact: true,
      });
      await expect(announcement).toBeAttached();
      await click(page, announcement);
      await click(page, native.getByRole("button", { name: "アナウンスを展開", exact: true }));
      await click(
        page,
        native.getByRole("button", { name: `アナウンスを解除: ${original}`, exact: true }),
      );
      await expect(announcement).toHaveCount(0);

      const url = `${base}/pr-demo?link-check=1`;
      await click(page, editor);
      await page.keyboard.insertText(url);
      await expect(hostEditor).toHaveValue(url);
      await page.keyboard.press("Enter");
      // Compose mirrors the enclosing bubble as a button; aim inside the
      // underlined URL so the actual LinkAnnotation receives the pointer.
      const link = native.getByRole("button", { name: url, exact: true });
      await expect(link).toBeAttached();
      const opened = page.waitForEvent("popup");
      await click(page, link);
      const linkedPage = await opened;
      await expect(linkedPage).toHaveURL(url);
      await linkedPage.close();

      if (mode === "apple") {
        await page.setViewportSize({ width: 390, height: 844 });
        await expect
          .poll(async () => {
            const bounds = await editor.boundingBox();
            return !!bounds && bounds.x + bounds.width <= 390;
          })
          .toBe(true);
        for (const appearance of ["light", "dark"]) {
          if (appearance === "dark") {
            await click(
              page,
              native.getByRole("button", { name: "添付とその他の操作", exact: true }),
            );
            await click(page, native.getByRole("button", { name: "設定", exact: true }).last());
            await click(page, native.getByRole("button", { name: "すべての設定", exact: true }));
            await click(page, native.getByRole("button", { name: "ダーク", exact: true }));
            await expect(page.locator("html")).toHaveAttribute("data-appearance", "dark");
            await click(page, native.getByRole("button", { name: "設定を閉じる", exact: true }));
          }
          await click(page, bubble, "right");
          await expect(
            native.getByRole("button", { name: "既読者を確認", exact: true }),
          ).toBeAttached();
          await expect
            .poll(async () => {
              const bounds = await native
                .getByRole("button", { name: "閉じる", exact: true })
                .boundingBox();
              return (
                !!bounds &&
                bounds.x >= 0 &&
                bounds.x + bounds.width <= 390 &&
                bounds.y + bounds.height <= 844
              );
            })
            .toBe(true);
          await page.screenshot({ path: resolve(output, `apple-phone-menu-${appearance}-2x.png`) });
          await page.keyboard.press("Escape");
          await expect(
            native.getByRole("button", { name: "既読者を確認", exact: true }),
          ).toHaveCount(0);
        }
      }

      assert.deepEqual(errors, []);
      results.push({
        mode,
        visibleMessageTime: fixture.time,
        readersAndTimes: true,
        longPressActions: true,
        replyJump: true,
        search: true,
        announcementAddJumpRemove: true,
        nativeUrlClick: true,
        errors,
      });
    } catch (error) {
      await page.screenshot({ path: resolve(output, `${mode}-failure.png`) });
      console.error({
        mode,
        errors,
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
  console.log(results);
} finally {
  await browser.close();
}
