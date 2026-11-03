import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext();
  await context.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  for (const width of [320, 375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("http://127.0.0.1:5187/tests/flex-layout-harness.html");
    for (const id of ["1", "2", "4"]) {
      const cards = page.locator(`[data-case="${id}"] .T1`);
      await expect(cards).toHaveCount(id === "2" ? 2 : 1);
      for (const card of await cards.all()) {
        await expect.poll(() => card.evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(200);
        await expect.poll(() => card.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(200);
      }
    }
    const carousel = page.locator('[data-case="2"] .vfx.flex');
    await expect.poll(() => carousel.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
    await carousel.evaluate(element => { element.scrollLeft = element.scrollWidth; });
    await expect.poll(() => carousel.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await expect(page.getByText("Empty carousel fallback", { exact: true })).toBeVisible();
  }
  expect(errors).toEqual([]);
  console.log("Image-only Flex single/carousel layout passed at 320/375/768/1440px; horizontal scroll retained; no page errors");
} finally { await browser.close(); }
