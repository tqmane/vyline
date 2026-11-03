import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "@playwright/test";
import { join } from "node:path";

let browser: Browser;
let server: ReturnType<typeof Bun.serve>;
beforeAll(async () => {
  const build = await Bun.build({
    entrypoints: [join(import.meta.dir, "useLinkPreviews.harness.tsx")],
    target: "browser",
    tsconfig: join(import.meta.dir, "../../tsconfig.json"),
    define: { "process.env.NODE_ENV": '"development"' },
  });
  if (!build.success) throw new Error(build.logs.join("\n"));
  const script = await build.outputs[0]!.text();
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) =>
      new URL(request.url).pathname === "/fixture.js"
        ? new Response(script, { headers: { "content-type": "text/javascript" } })
        : new Response('<div id="root"></div><script type="module" src="/fixture.js"></script>', {
            headers: { "content-type": "text/html" },
          }),
  });
  browser = await chromium.launch({ headless: true, channel: "chrome" });
});
afterAll(async () => {
  await browser?.close();
  server?.stop(true);
});

async function fixture(run: (page: Page, requests: string[]) => Promise<void>) {
  const page = await browser.newPage();
  const requests: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== server.url.origin) {
      errors.push(`Unexpected external request: ${url.origin}`);
      return route.abort();
    }
    if (url.pathname.startsWith("/api/")) {
      requests.push(url.pathname);
      expect(url.pathname).toContain("/link-preview");
      return route.fulfill({
        json: {
          ok: true,
          preview: { title: "Fetched card", description: "Offline fixture", site: "site.org" },
        },
      });
    }
    return route.continue();
  });
  try {
    await page.goto(server.url.href);
    await page.waitForFunction(() => "harness" in window);
    await run(page, requests);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
}

test(
  "real message bubble: opt-in displays a card; off/zero/privacy/revoked never fetch",
  () =>
    fixture(async (page, requests) => {
      await page.waitForSelector("[data-vy-message]");
      expect(requests).toHaveLength(0);
      for (const settings of [
        { requestUrlPreviews: true, linkPreviewMaxUrls: 0 },
        { requestUrlPreviews: true, streamerMode: true },
      ]) {
        await page.evaluate((settings) => (window as any).harness.settings(settings), settings);
        await page.waitForTimeout(30);
        expect(requests).toHaveLength(0);
      }
      expect(await page.locator('a[href*="site.org"]').count()).toBe(0);
      expect(await page.locator("[data-vy-message]").innerText()).toContain("[URL]");
      await page.evaluate(() =>
        (window as any).harness.render(
          { messageState: "revoked-by-other", text: undefined },
          { requestUrlPreviews: true },
        ),
      );
      await page.getByText("保存済み本文なし").waitFor();
      expect(requests).toHaveLength(0);
      await page.evaluate(() => (window as any).harness.render({}, { requestUrlPreviews: true }));
      await page.getByText("Fetched card").waitFor();
      expect(requests).toHaveLength(1);
      await page.evaluate(() => (window as any).harness.settings({ requestUrlPreviews: false }));
      await page.getByText("Fetched card").waitFor({ state: "detached" });
    }),
  15_000,
);

test(
  "real bubble keeps metadata cards, masks partial copy and original/history text",
  () =>
    fixture(async (page, requests) => {
      await page.evaluate(() =>
        (window as any).harness.render({
          linkPreview: {
            url: "https://site.org/article",
            title: "Existing card",
            site: "site.org",
            description: "Metadata",
            thumb: "E",
          },
        }),
      );
      await page.getByText("Existing card").waitFor();
      expect(requests).toHaveLength(0);
      await page.evaluate(() => (window as any).harness.settings({ streamerMode: true }));
      await page.getByText("Existing card").waitFor({ state: "detached" });
      await page.locator("[data-vy-message]").click({ button: "right" });
      await page.getByRole("menuitem", { name: "部分コピー" }).click();
      expect(await page.locator("textarea[readonly]").inputValue()).toBe("[URL]");
      await page.getByRole("button", { name: "閉じる", exact: true }).click();
      await page.evaluate(() =>
        Object.defineProperty(document, "execCommand", {
          value: () => {
            (window as any).copied = (document.activeElement as HTMLTextAreaElement)?.value;
            return true;
          },
        }),
      );
      await page.locator("[data-vy-message]").click({ button: "right" });
      await page.getByRole("menuitem", { name: "コピー", exact: true }).click();
      expect(await page.evaluate(() => (window as any).copied)).toBe("[URL]");
      await page.evaluate(() =>
        (window as any).harness.render(
          {
            edited: true,
            originalText: "original https://original.org",
            history: [
              {
                state: "normal",
                text: "history https://history.org",
                contentType: "TEXT",
                updatedTime: 1,
              },
            ],
          },
          { streamerMode: true },
        ),
      );
      await page.locator("[data-vy-message]").click({ button: "right" });
      await page.getByRole("menuitem", { name: "編集前のメッセージを表示", exact: true }).click();
      expect(await page.locator("[data-vy-message]").innerText()).toContain("original [URL]");
      await page.locator("[data-vy-message]").click({ button: "right" });
      await page.getByRole("menuitem", { name: "履歴を表示", exact: true }).click();
      await page
        .getByRole("dialog")
        .filter({ hasText: "メッセージ履歴" })
        .getByText("history [URL]", { exact: true })
        .waitFor();
      expect(await page.locator('a[href*="original.org"], a[href*="history.org"]').count()).toBe(0);
    }),
  15_000,
);

test(
  "real revoked bubble deletes only after confirmation, keeps failed rows and supports native controller",
  () =>
    fixture(async (page) => {
      await page.evaluate(() =>
        (window as any).harness.render({
          messageState: "revoked-by-other",
          revokedSnapshot: {
            id: "saved",
            chatId: "chat-fixture",
            authorId: "me",
            kind: "text",
            text: "Saved original",
            createdAt: 1,
            status: "sent",
            read: false,
            messageState: "normal",
          },
        }),
      );
      await page.getByText("Saved original").waitFor();
      await page.locator("[data-vy-message]").click({ button: "right" });
      await page.getByRole("menuitem", { name: "この端末から削除" }).click();
      expect(await page.evaluate(() => (window as any).harness.deletes)).toBe(0);
      await page.getByRole("button", { name: "キャンセル", exact: true }).click();
      expect(await page.evaluate(() => (window as any).harness.deletes)).toBe(0);
      await page.locator("[data-vy-message]").click({ button: "right" });
      await page.getByRole("menuitem", { name: "この端末から削除" }).click();
      await page.evaluate(() => (window as any).harness.behavior("failure"));
      await page.getByRole("button", { name: "この端末から削除", exact: true }).click();
      expect(await page.evaluate(() => (window as any).harness.notice)).toContain(
        "削除できませんでした",
      );
      expect(await page.locator("[data-vy-message]").count()).toBe(1);
      await page.evaluate(() => (window as any).harness.behavior("success"));
      await page.getByRole("button", { name: "この端末から削除", exact: true }).click();
      await page.locator("[data-vy-message]").waitFor({ state: "detached" });
      await page.evaluate(() =>
        (window as any).harness.render({ messageState: "revoked-by-other" }, {}, true),
      );
      await page.waitForFunction(() =>
        (window as any).harness.menu?.items.some((item: any) => item.label === "この端末から削除"),
      );
      await page.evaluate(() => (window as any).harness.settings({ streamerMode: true }));
      await page.waitForFunction(() => (window as any).harness.menu?.message?.text === "[URL]");
      await page.evaluate(() => {
        const h = (window as any).harness;
        h.invokeNativeMenu(h.menu.items.find((item: any) => item.label === "この端末から削除").id);
      });
      await page.waitForFunction(
        () => (window as any).harness.panel?.title === "この端末から削除しますか？",
      );
      expect(await page.evaluate(() => (window as any).harness.deletes)).toBe(0);
      await page.evaluate(() => {
        const h = (window as any).harness;
        const find = (items: any[]): any =>
          items.find((item) => item.kind === "button" && item.label === "この端末から削除") ??
          items
            .flatMap((item) => item.items ?? [])
            .map((item) => find([item]))
            .find(Boolean);
        h.invokeNativePanel("panel-action", find(h.panel.items).id);
      });
      await page.waitForFunction(() => (window as any).harness.deletes === 1);
    }),
  15_000,
);
