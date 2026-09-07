import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";

// Run against Vite: bun Vyline/apps/desktop/scripts/check-composer-resize.ts
// An isolated /pr-demo context uses synthetic media and never sends to LINE.
const base = process.env.VYLINE_TEST_URL ?? "http://127.0.0.1:5173";
const browser = await chromium.launch({
  headless: true,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 840 } });
  await page.goto(`${base}/pr-demo`, { waitUntil: "domcontentloaded" });
  const composer = page.getByLabel("メッセージを入力", { exact: true });
  await expect(composer).toBeVisible();
  await composer.fill("幅を切り替えても残る下書き\n2行目");
  const editor = await composer.elementHandle();
  assert(editor);
  await page.locator('input[type="file"][accept="image/*,video/*"]').setInputFiles({
    name: "resize-check.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(page.getByText("1 件のメディアを待機中")).toBeVisible();
  for (const width of [390, 1024, 767, 768, 1440]) {
    await page.setViewportSize({ width, height: 840 });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    assert.equal(
      await editor.evaluate((node) => node.isConnected),
      true,
      `Composer remounted at ${width}px`,
    );
    await expect(composer).toHaveValue("幅を切り替えても残る下書き\n2行目");
    await expect(page.getByText("1 件のメディアを待機中")).toBeVisible();
  }
  await composer.fill("");
  await page.getByRole("button", { name: "音声メッセージを録音", exact: true }).click();
  await expect(page.getByText("録音中", { exact: true })).toBeVisible();
  const recording = await page.getByText("録音中", { exact: true }).elementHandle();
  assert(recording);
  for (const width of [390, 1100]) {
    await page.setViewportSize({ width, height: 840 });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    assert.equal(
      await recording.evaluate((node) => node.isConnected),
      true,
      `Recording remounted at ${width}px`,
    );
    await expect(page.getByText("録音中", { exact: true })).toBeVisible();
  }
  await page.getByRole("button", { name: "録音をキャンセル", exact: true }).click();
  await expect(page.getByText("1 件のメディアを待機中")).toBeVisible();
  console.log(
    "PASS: same composer, pending file and recording survive 390/767/768/1024/1440px resize",
  );
} finally {
  await browser.close();
}
