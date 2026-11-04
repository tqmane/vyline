import { chromium, expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const build = await Bun.build({
  entrypoints: [fileURLToPath(new URL("./theme-persistence-harness.tsx", import.meta.url))],
  target: "browser",
  tsconfig: resolve(import.meta.dir, "../tsconfig.json"),
});
if (!build.success) throw new AggregateError(build.logs, "Cannot build theme fixture");
const apiRequests: string[] = [];
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const path = new URL(request.url).pathname;
    if (path.startsWith("/api/")) {
      apiRequests.push(path);
      return new Response("No backend in this fixture", { status: 503 });
    }
    if (path === "/fixture.js")
      return new Response(build.outputs[0], { headers: { "content-type": "text/javascript" } });
    return new Response(
      '<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="theme-color" content="#000000"><body><script type="module" src="/fixture.js"></script>',
      { headers: { "content-type": "text/html" } },
    );
  },
});
const browser = await chromium.launch({
  headless: true,
  ...(process.platform === "win32" ? { channel: "chrome" } : {}),
});
const legacyCustom = {
  accent: "#00aa66",
  surface0: "#101010",
  surface1: "#202020",
  surface2: "#303030",
  msgIn: "#404040",
  msgOut: "#005533",
  textPrimary: "#ffffff",
  textSecondary: "#aaaaaa",
  messageRadiusPx: 16,
  chatBgImage: null,
};
const cases = [
  { mode: "legacy", legacyId: null, custom: false },
  { mode: "legacy", legacyId: "line-dark", custom: false },
  { mode: "legacy", legacyId: "custom", custom: true },
  { mode: "nezu", legacyId: "line-dark", custom: false },
  { mode: "apple", legacyId: "custom", custom: false },
  { mode: "fluent", legacyId: null, custom: false },
  { mode: "miuix", legacyId: "line-dark", custom: false },
] as const;
const expectedReadMarks = {
  "fixture-account-a:fixture-chat": {
    lastMessageId: "101",
    lastMessageTime: 1000,
    unreadCount: 13,
  },
  "fixture-account-b:fixture-chat": { lastMessageId: "202", lastMessageTime: 2000, unreadCount: 7 },
};

async function readTheme(page: Page, id: string) {
  return JSON.parse((await page.locator(`#${id}`).textContent()) ?? "null");
}
async function assertApplied(page: Page) {
  const theme = await readTheme(page, "resolved-theme");
  const expected = {
    "--vy-bg": theme.bg,
    "--vy-surface": theme.surface,
    "--vy-surface-2": theme.surface2,
    "--vy-chat-bg": theme.chatBg,
    "--vy-accent": theme.accent,
    "--vy-msg-in": theme.msgIn,
    "--vy-msg-out": theme.msgOut,
    "--vy-text": theme.text,
    "--vy-chat-pattern": String(theme.pattern),
    "--vy-message-radius": `${theme.radius}rem`,
  };
  await expect
    .poll(() =>
      page.evaluate(
        (keys) =>
          Object.fromEntries(
            keys.map((key) => [key, document.documentElement.style.getPropertyValue(key)]),
          ),
        Object.keys(expected),
      ),
    )
    .toEqual(expected);
}

let checks = 0;
try {
  for (const scenario of cases) {
    const context = await browser.newContext({ colorScheme: "light" });
    const failures: string[] = [];
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === server.url.origin
        ? route.continue()
        : route.abort(),
    );
    await context.addInitScript(
      ({ id, custom }) => {
        // A stale legacy backup may coexist with the real selected theme.
        if (id && !localStorage.getItem("vyline:theme"))
          localStorage.setItem(
            "vyline:theme",
            JSON.stringify({ state: { themeId: id, custom }, version: 0 }),
          );
      },
      { id: scenario.legacyId, custom: legacyCustom },
    );
    const page = await context.newPage();
    page.on("pageerror", (error) => failures.push(error.message));
    try {
      await page.goto(server.url.href);
      // Seed through the real store once; init scripts must not re-seed these on reload.
      await page.getByRole("button", { name: "合成既読位置を保存", exact: true }).click();
      expect(await readTheme(page, "read-marks")).toEqual(expectedReadMarks);
      await page.getByRole("button", { name: "Sakura Dusk", exact: true }).click();
      if (scenario.custom) {
        await page.getByRole("button", { name: "コード", exact: true }).click();
        const theme = await readTheme(page, "saved-theme");
        await page
          .getByLabel("テーマコードを貼り付け")
          .fill(
            JSON.stringify({ ...theme, id: "custom", name: "Synthetic custom", msgOut: "#a4007f" }),
          );
        await page.getByRole("button", { name: "適用", exact: true }).click();
      }
      const saved = await readTheme(page, "saved-theme");
      if (scenario.mode !== "legacy")
        await page.locator(`input[name="design-system"][value="${scenario.mode}"]`).check();
      await assertApplied(page);
      await page.getByRole("button", { name: "設定を開く", exact: true }).click();
      await expect(page.getByText("設定・テーマのバックアップ", { exact: true })).toBeVisible();
      expect(await readTheme(page, "saved-theme")).toEqual(saved);
      expect(
        await page.evaluate(
          () => JSON.parse(localStorage.getItem("vyline:store")!).state.localReadMarks,
        ),
      ).toEqual(expectedReadMarks);
      await assertApplied(page);
      await page.reload();
      await expect(page.getByText("設定・テーマのバックアップ", { exact: true })).toBeVisible();
      expect(await readTheme(page, "saved-theme")).toEqual(saved);
      expect(await readTheme(page, "read-marks")).toEqual(expectedReadMarks);
      expect(
        await page.evaluate(
          () => JSON.parse(localStorage.getItem("vyline:store")!).state.localReadMarks,
        ),
      ).toEqual(expectedReadMarks);
      await assertApplied(page);
      await page.getByRole("button", { name: "チャットへ戻る", exact: true }).click();
      await assertApplied(page);
      expect(failures).toEqual([]);
      checks++;
      console.log(
        `PASS ${scenario.mode} / ${scenario.legacyId ?? "no legacy backup"}${scenario.custom ? " / custom" : ""}`,
      );
    } finally {
      await context.close();
    }
  }
  expect(apiRequests).toEqual([]);
  console.log(
    `PASS ${checks}/${cases.length} theme persistence scenarios; settings lazy load, real reload preserves account/chat read marks, return to chat; 0 API requests`,
  );
} finally {
  await browser.close();
  server.stop(true);
}
