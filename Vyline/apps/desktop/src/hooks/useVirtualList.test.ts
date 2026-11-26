import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser } from "@playwright/test";
import { join } from "node:path";

let browser: Browser;
let server: ReturnType<typeof Bun.serve>;

beforeAll(async () => {
  const build = await Bun.build({
    entrypoints: [join(import.meta.dir, "useVirtualList.harness.tsx")],
    target: "browser",
    tsconfig: join(import.meta.dir, "../../tsconfig.json"),
    define: { "process.env.NODE_ENV": '"production"' },
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

test("useVirtualList converges without React #185 when image rows diverge sharply from estimates", async () => {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
  });

  try {
    await page.goto(server.url.origin);
    await page.waitForFunction(() => {
      const api = (window as unknown as { __vh?: { metrics: () => { hasMeasured: boolean } } }).__vh;
      return Boolean(api?.metrics().hasMeasured);
    });

    for (const top of [1800, 900, 240, 0, 1400]) {
      await page.evaluate((y) => {
        (window as unknown as { __vh: { scrollTo: (t: number) => void } }).__vh.scrollTo(y);
      }, top);
      await page.waitForTimeout(40);
    }

    await page.evaluate(() => {
      (window as unknown as { __vh: { mutateImageHeights: () => void } }).__vh.mutateImageHeights();
    });
    await page.waitForTimeout(80);

    await page.evaluate(() => {
      const vh = (window as unknown as { __vh: { switchChat: (k: string) => void; scrollToBottom: () => void } }).__vh;
      vh.switchChat("chat-b");
      vh.scrollToBottom();
    });
    await page.waitForTimeout(80);

    const metrics = await page.evaluate(() =>
      (window as unknown as {
        __vh: {
          metrics: () => { visibleCount: number; hasMeasured: boolean; scrollHeight: number };
        };
      }).__vh.metrics(),
    );

    expect(errors).toEqual([]);
    expect(metrics.hasMeasured).toBe(true);
    expect(metrics.visibleCount).toBeGreaterThan(0);
    expect(metrics.scrollHeight).toBeGreaterThan(420);
  } finally {
    await page.close();
  }
});
