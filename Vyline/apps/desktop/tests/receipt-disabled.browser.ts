import { chromium, expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

// RED uses the real pre-fix store from the branch base without editing the shared working tree.
const baseline = process.env.RECEIPT_DISABLED_BASELINE === "1";
const baseSource = baseline
  ? Bun.spawnSync(["git", "show", "e461841:Vyline/apps/desktop/src/lib/store.ts"], {
      cwd: resolve(import.meta.dir, "../../.."),
    })
  : null;
if (baseSource && baseSource.exitCode !== 0) throw new Error(baseSource.stderr.toString());
const build = await Bun.build({
  entrypoints: [fileURLToPath(new URL("./receipt-disabled-harness.tsx", import.meta.url))],
  target: "browser",
  tsconfig: resolve(import.meta.dir, "../tsconfig.json"),
  plugins: baseline
    ? [
        {
          name: "pre-fix-production-store",
          setup(builder) {
            builder.onLoad({ filter: /[\\/]src[\\/]lib[\\/]store\.ts$/ }, () => ({
              contents: baseSource!.stdout.toString(),
              loader: "ts",
            }));
          },
        },
      ]
    : [],
});
if (!build.success) throw new AggregateError(build.logs, "Cannot build receipt-disabled fixture");
const serverRequests: string[] = [];
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/fixture.js")
      return new Response(build.outputs[0], { headers: { "content-type": "text/javascript" } });
    if (path.startsWith("/api/")) {
      serverRequests.push(path);
      return new Response("No backend in fixture", { status: 503 });
    }
    return new Response(
      '<!doctype html><html lang="ja"><meta charset="utf-8"><body><script type="module" src="/fixture.js"></script>',
      { headers: { "content-type": "text/html" } },
    );
  },
});
const browser = await chromium.launch({
  headless: true,
  ...(process.platform === "win32" ? { channel: "chrome" } : {}),
});
const account = "receipt-disabled-fixture";
const chat = "u-receipt-disabled-peer";
async function snapshot(page: Page) {
  return JSON.parse((await page.locator("#snapshot").textContent()) ?? "null");
}
async function action(page: Page, name: string) {
  await page.getByRole("button", { name, exact: true }).click();
  await expect(page.locator("#completed")).toHaveText(name);
  await expect(page.locator("#error")).toBeEmpty();
}
async function assertUnread(page: Page, unread: number, stage: string) {
  await expect.poll(async () => (await snapshot(page))?.unread, { message: stage }).toBe(unread);
  const state = await snapshot(page);
  expect(state.marks, `${stage}: automatic receipts`).toHaveLength(0);
  expect(state.blockedFetch, `${stage}: unexpected fetch`).toEqual([]);
}

let checks = 0;
try {
  for (const mode of ["global", "chat"]) {
    const context = await browser.newContext();
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === server.url.origin
        ? route.continue()
        : route.abort(),
    );
    await context.addInitScript(
      ({ account, chat }) => {
        if (!localStorage.getItem("vyline:store"))
          localStorage.setItem(
            "vyline:store",
            JSON.stringify({
              version: 0,
              state: {
                localReadMarks: {
                  [`${account}:${chat}`]: {
                    lastMessageId: "113",
                    lastMessageTime: 113000,
                    unreadCount: 13,
                    serverUnreadCount: 13,
                  },
                },
              },
            }),
          );
      },
      { account, chat },
    );
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(`${server.url}?mode=${mode}`);
      await assertUnread(page, 13, `${mode}: bootstrap ignores PR79 automatic mark`);
      expect((await snapshot(page)).globalEnabled).toBe(mode === "chat");
      expect((await snapshot(page)).individuallyDisabled).toBe(mode === "chat");
      for (const name of [
        "open",
        "automatic",
        "history",
        "close",
        "list",
        "bootstrap",
        "poll",
        "open",
      ]) {
        await action(page, name);
        await assertUnread(page, 13, `${mode}: ${name}`);
      }
      await action(page, "delta-14");
      await assertUnread(page, 14, `${mode}: active incoming message 114`);
      expect((await snapshot(page)).active).toBe(chat);
      expect((await snapshot(page)).messageIds).toContain("114");
      for (const name of ["poll", "list", "bootstrap", "close"]) {
        await action(page, name);
        await assertUnread(page, 14, `${mode}: ${name} after incoming`);
      }
      const exercised = (await snapshot(page)).calls;
      for (const name of ["history", "delta", "poll", "list"])
        expect(exercised[name]).toBeGreaterThan(0);
      await page.reload();
      await assertUnread(page, 14, `${mode}: real reload`);
      expect((await snapshot(page)).globalEnabled).toBe(mode === "chat");
      expect((await snapshot(page)).individuallyDisabled).toBe(mode === "chat");
      for (const name of ["open", "history", "automatic", "list", "bootstrap"]) {
        await action(page, name);
        await assertUnread(page, 14, `${mode}: ${name} after reload`);
      }
      const beforeManual = await snapshot(page);
      expect(beforeManual.calls.history).toBeGreaterThan(0);
      expect(beforeManual.calls.list).toBeGreaterThan(0);
      const manual = mode === "global" ? "manual-full" : "manual-partial";
      await action(page, manual);
      const expected = mode === "global" ? 0 : 7;
      expect((await snapshot(page)).unread).toBe(expected);
      expect((await snapshot(page)).marks).toEqual([
        { account, chat, messageId: mode === "global" ? "114" : "107" },
      ]);
      await action(page, "list");
      expect((await snapshot(page)).unread).toBe(expected);
      expect((await snapshot(page)).marks).toHaveLength(1);
      expect((await snapshot(page)).blockedFetch).toEqual([]);
      expect(errors).toEqual([]);
      checks++;
      console.log(
        `PASS ${mode} OFF: 13 through open/history/poll/list/bootstrap; active incoming 14; real reload 14; ${manual}=${expected}, exactly one mock receipt`,
      );
    } finally {
      await context.close();
    }
  }
  expect(serverRequests).toEqual([]);
  console.log(
    `PASS ${checks}/2 production-store receipt-disabled browser scenarios; zero real backend requests${baseline ? " (pre-fix base)" : ""}`,
  );
} finally {
  await browser.close();
  server.stop(true);
}
