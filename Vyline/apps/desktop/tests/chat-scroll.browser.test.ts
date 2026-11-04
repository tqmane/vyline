import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "@playwright/test";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

let browser: Browser;
let script: string;
let style: string;
const desktop = resolve(import.meta.dir, "..");
beforeAll(async () => {
  const result = await Bun.build({
    entrypoints: [join(import.meta.dir, "chat-scroll-harness.tsx")],
    target: "browser",
    format: "iife",
    tsconfig: join(desktop, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [
      {
        name: "local-svg",
        setup(build) {
          build.onResolve({ filter: /\.svg\?url$/ }, (args) => ({
            path: resolve(args.resolveDir, args.path.slice(0, -4)),
            namespace: "svg-url",
          }));
          build.onLoad({ filter: /\.svg$/, namespace: "svg-url" }, async ({ path }) => ({
            contents: `export default ${JSON.stringify(`data:image/svg+xml,${encodeURIComponent(await Bun.file(path).text())}`)};`,
            loader: "js",
          }));
        },
      },
    ],
  });
  if (!result.success) throw new Error(result.logs.join("\n"));
  script = await result.outputs.find((item) => item.path.endsWith(".js"))!.text();
  const css = (await readdir(join(desktop, "dist/assets"))).find((name) =>
    /^index-.*\.css$/.test(name),
  );
  style = await Bun.file(join(desktop, "dist/assets", css!)).text();
  for (const item of result.outputs.filter((item) => item.path.endsWith(".css")))
    style += await item.text();
  browser = await chromium.launch({ channel: "chrome", headless: true });
});
afterAll(async () => {
  await browser?.close();
});
async function fixture(run: (page: Page) => Promise<void>) {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 850 },
    serviceWorkers: "block",
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://127.0.0.1" || route.request().method() !== "GET") {
      errors.push(`Unexpected request ${url.origin}`);
      return route.abort();
    }
    if (url.pathname === "/fixture")
      return route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><meta charset="utf-8"><style>${style}body{margin:0} .vy-chat-messages{overflow-anchor:none}</style><div id="root"></div><script src="/fixture.js"></script>`,
      });
    if (url.pathname === "/fixture.js")
      return route.fulfill({ contentType: "text/javascript", body: script });
    if (url.pathname.startsWith("/fixture-image/"))
      return route.fulfill({
        contentType: "image/svg+xml",
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="${url.pathname.includes("large") ? 700 : 25}"><rect width="100%" height="100%" fill="#568"/></svg>`,
      });
    errors.push(`Unexpected route ${url.pathname}`);
    return route.abort();
  });
  try {
    await page.goto("http://127.0.0.1/fixture");
    await page.waitForFunction(() => (window as any).scrollFixture?.read().gap < 3);
    await page.waitForTimeout(250);
    await run(page);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
}
const read = (page: Page, pane = 0) =>
  page.evaluate((pane) => (window as any).scrollFixture.read(pane), pane);
async function settle(page: Page) {
  await page.waitForFunction(() => [...document.images].every((image) => image.complete));
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
      ),
  );
}
async function wheel(page: Page, delta: number, pane = 0) {
  const box = await page.locator(`[data-pane="${pane}"] .vy-chat-messages`).boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.wheel(0, delta);
  await page.waitForTimeout(100);
}

test(
  "middle image/Flex resize preserves the visible message and ongoing wheel direction",
  () =>
    fixture(async (page) => {
      for (let i = 0; i < 14; i++) await wheel(page, -400);
      const before = await read(page);
      await page.evaluate(() => (window as any).scrollFixture.expand());
      await page.waitForTimeout(350);
      const after = await read(page);
      const row = after.rows.find((row: any) => row.id === before.anchor.id);
      expect(row).toBeDefined();
      expect(Math.abs(row.top - before.anchor.top)).toBeLessThan(3);
      let previous = Number(after.anchor.id.split("-").at(-1));
      for (let i = 0; i < 10; i++) {
        if (i === 3) await page.evaluate(() => (window as any).scrollFixture.expand());
        await wheel(page, -200);
        const current = Number((await read(page)).anchor.id.split("-").at(-1));
        expect(current).toBeLessThanOrEqual(previous);
        expect(previous - current).toBeLessThan(12);
        previous = current;
      }
      const reading = await read(page);
      await page.evaluate(() => (window as any).scrollFixture.append());
      await settle(page);
      const same = (await read(page)).rows.find((row: any) => row.id === reading.anchor.id);
      expect(same).toBeDefined();
      expect(Math.abs(same.top - reading.anchor.top)).toBeLessThan(3);
    }),
  20_000,
);

test(
  "returning to bottom resumes following late media and incoming messages",
  () =>
    fixture(async (page) => {
      await wheel(page, -500);
      await wheel(page, 1000);
      expect((await read(page)).gap).toBeLessThan(3);
      await page.evaluate(() => (window as any).scrollFixture.append());
      await page.waitForTimeout(250);
      expect((await read(page)).gap).toBeLessThan(3);
      await page.evaluate(() => (window as any).scrollFixture.expand());
      await page.waitForTimeout(300);
      expect((await read(page)).gap).toBeLessThan(3);
      await wheel(page, -70);
      expect((await read(page)).gap).toBeGreaterThan(3);
      await page.evaluate(() => (window as any).scrollFixture.append());
      await page.waitForTimeout(220);
      expect((await read(page)).gap).toBeLessThan(3);
      await page.evaluate(() => (window as any).scrollFixture.append());
      await wheel(page, 300);
      await page.evaluate(() => (window as any).scrollFixture.expand());
      await settle(page);
      expect((await read(page)).gap).toBeLessThan(3);
    }),
  10_000,
);

test(
  "prepend preserves the current viewport, chat changes reset to the correct latest row",
  () =>
    fixture(async (page) => {
      for (let i = 0; i < 8; i++) await wheel(page, -400);
      const before = await read(page);
      await page.evaluate(() => (window as any).scrollFixture.prepend());
      await page.waitForTimeout(300);
      const row = (await read(page)).rows.find((row: any) => row.id === before.anchor.id);
      expect(row).toBeDefined();
      expect(Math.abs(row.top - before.anchor.top)).toBeLessThan(3);
      await page.evaluate(() => (window as any).scrollFixture.switchFirst());
      await page.waitForTimeout(350);
      const next = await read(page);
      expect(next.gap).toBeLessThan(3);
      expect(next.anchor.id).toContain("c-scroll-5");
    }),
  10_000,
);

test(
  "two to four panes keep independent anchors while image/Flex heights settle",
  () =>
    fixture(async (page) => {
      for (const count of [2, 3, 4]) {
        await page.evaluate((count) => (window as any).scrollFixture.panes(count), count);
        await page.waitForTimeout(250);
        for (let pane = 0; pane < count; pane++) {
          await wheel(page, -1300, pane);
          await settle(page);
          const before = await read(page, pane);
          const others = await Promise.all(
            Array.from({ length: count }, (_, index) => read(page, index)),
          );
          await page.evaluate((pane) => (window as any).scrollFixture.expand(pane), pane);
          await page.waitForTimeout(220);
          await settle(page);
          const after = await read(page, pane);
          const row = after.rows.find((row: any) => row.id === before.anchor.id);
          if (row && Math.abs(row.top - before.anchor.top) >= 3)
            console.info(JSON.stringify({ count, pane, before: before.anchor, after: row }));
          expect(row).toBeDefined();
          expect(Math.abs(row.top - before.anchor.top)).toBeLessThan(3);
          for (let index = 0; index < count; index++) {
            if (index === pane) continue;
            const untouched = await read(page, index);
            const stable = untouched.rows.find((row: any) => row.id === others[index].anchor.id);
            expect(stable).toBeDefined();
            expect(Math.abs(stable.top - others[index].anchor.top)).toBeLessThan(3);
          }
        }
      }
    }),
  20_000,
);
