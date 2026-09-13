import assert from "node:assert/strict";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";

// VYLINE_TEST_URL=http://127.0.0.1:5174 bun Vyline/apps/desktop/scripts/check-chat-scroll.ts
const base = process.env.VYLINE_TEST_URL ?? "http://127.0.0.1:5173";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 840 } });
const errors: string[] = [];
let stage = "hook";
page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
page.on("console", (entry) => {
  if (
    (entry.type() === "error" || entry.type() === "warning") &&
    !entry.text().includes("net::ERR_FAILED")
  ) {
    errors.push(entry.text());
  }
});
await page.route("**/*", (route) => {
  const url = new URL(route.request().url());
  if (url.origin !== base || url.pathname.startsWith("/api/")) return route.abort();
  if (url.pathname === "/src/main.tsx")
    return route.fulfill({
      contentType: "text/javascript",
      body: 'import "/scripts/scroll-probe.tsx";',
    });
  return route.continue();
});
const metrics = () =>
  page.getByTestId("viewport").evaluate((node) => ({
    top: node.scrollTop,
    gap: node.scrollHeight - node.clientHeight - node.scrollTop,
  }));
const settle = () => page.waitForTimeout(400);
try {
  await page.goto(`${base}/__scroll-probe.html`);
  await page.getByText("Open", { exact: true }).click();
  await expect.poll(async () => (await metrics()).gap).toBeLessThanOrEqual(1);
  await page.getByTestId("viewport").hover();
  await page.mouse.wheel(0, -350);
  await settle();
  assert((await metrics()).gap > 200, "A late-mounted chat must release bottom following on wheel");
  await page.getByText("Latest", { exact: true }).click();
  await settle();
  await page.getByTestId("viewport").click({ position: { x: 50, y: 50 } });
  await page.getByTestId("viewport").evaluate((node) => {
    node.scrollTop = 800;
  });
  await settle();
  assert(
    await page.locator("#msg-0").count(),
    "The viewport intersects the tall first row; it must remain rendered",
  );
  await page.getByText("Jump", { exact: true }).click();
  await settle();
  const targetOffset = () =>
    page
      .locator("#msg-40")
      .evaluate(
        (node) =>
          node.getBoundingClientRect().top -
          node.closest('[data-testid="viewport"]')!.getBoundingClientRect().top,
      );
  assert(Math.abs((await targetOffset()) - 200) < 2, "Message jump settles on the measured row");
  await page.getByTestId("viewport").hover();
  await page.mouse.wheel(0, 100);
  await settle();
  const reading = await page.getByTestId("viewport").evaluate((node) => {
    const top = node.getBoundingClientRect().top;
    const row = Array.from(node.querySelectorAll<HTMLElement>('[id^="msg-"]')).find(
      (row) => row.getBoundingClientRect().bottom > top,
    )!;
    return { id: row.id, top: row.getBoundingClientRect().top - top };
  });
  await page.getByText("Resize rows", { exact: true }).click();
  await settle();
  const after = await page
    .locator(`#${reading.id}`)
    .evaluate(
      (node) =>
        node.getBoundingClientRect().top -
        node.closest('[data-testid="viewport"]')!.getBoundingClientRect().top,
    );
  assert(
    Math.abs(after - reading.top) < 2,
    `Resizing above preserves ${reading.id}: ${reading.top} -> ${after}`,
  );
  await page.getByText("Latest", { exact: true }).click();
  await settle();
  await page.getByText("Append", { exact: true }).click();
  await expect.poll(async () => (await metrics()).gap).toBeLessThanOrEqual(1);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: late mount, user scroll, tall rows, measured jumps, resize anchoring, append at bottom",
  );
  await page.goto(`${base}/__scroll-probe.html?chat=1`);
  const chat = page.locator(".vy-chat-messages");
  const bottomGap = () =>
    chat.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop);
  stage = "real open";
  await page.getByText("Open", { exact: true }).click();
  await expect.poll(bottomGap).toBeLessThanOrEqual(1);
  stage = "real switch";
  await page.getByText("Switch", { exact: true }).click();
  await expect.poll(bottomGap).toBeLessThanOrEqual(1);
  stage = "real reopen";
  await page.getByText("Open", { exact: true }).click();
  await expect.poll(bottomGap).toBeLessThanOrEqual(1);
  for (const width of [320, 768, 1440]) {
    stage = `resize ${width}`;
    await page.setViewportSize({ width, height: 840 });
    await expect.poll(bottomGap).toBeLessThanOrEqual(1);
    stage = `hide/restore ${width}`;
    await page.getByText("Hide", { exact: true }).click();
    await expect(chat).toBeHidden();
    await page.getByText("Hide", { exact: true }).click();
    await expect.poll(bottomGap).toBeLessThanOrEqual(1);
  }
  await page.getByText("Nezu", { exact: true }).click();
  stage = "nezu";
  await expect.poll(bottomGap).toBeLessThanOrEqual(1);
  await chat.hover();
  await page.mouse.wheel(0, -300);
  await settle();
  assert((await bottomGap()) > 150, "History must remain under user control near the bottom");
  const stableTop = await chat.evaluate((node) => node.scrollTop);
  await settle();
  assert(
    Math.abs((await chat.evaluate((node) => node.scrollTop)) - stableTop) <= 1,
    "Idle position must not oscillate",
  );
  stage = "history prepend";
  const historyAnchor = await chat.evaluate((node) => {
    const top = node.getBoundingClientRect().top;
    const row = Array.from(node.querySelectorAll<HTMLElement>('[id^="msg-"]')).find(
      (row) => row.getBoundingClientRect().bottom > top,
    )!;
    return { id: row.id, top: row.getBoundingClientRect().top - top };
  });
  await page.getByText("Prepend", { exact: true }).click();
  await settle();
  const historyTop = () =>
    page
      .locator(`#${historyAnchor.id}`)
      .evaluate(
        (node) =>
          node.getBoundingClientRect().top -
          node.closest(".vy-chat-messages")!.getBoundingClientRect().top,
      );
  assert(
    Math.abs((await historyTop()) - historyAnchor.top) <= 1,
    "Prepending history preserves the visible message",
  );
  await page.getByText("Compact", { exact: true }).click();
  await settle();
  const compactTop = await historyTop();
  assert(
    Math.abs(compactTop - historyAnchor.top) <= 1,
    `Changing compact spacing preserves ${historyAnchor.id}: ${historyAnchor.top} -> ${compactTop}`,
  );
  await page.getByRole("button", { name: "トークの一番下へ移動" }).click();
  await expect.poll(bottomGap).toBeLessThanOrEqual(1);
  await page.screenshot({ path: resolve(import.meta.dir, "../../../shots/chat-scroll.png") });
  await chat.click({ position: { x: 20, y: 20 } });
  await chat.evaluate((node) => {
    node.scrollTop = 0;
  });
  await expect(page.getByText("2023年12月31日", { exact: true })).toBeVisible();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: real ChatArea reopen, 320/768/1440px resize, hide/restore, Nezu, bottom history, older year",
  );
} catch (error) {
  console.error({
    stage,
    errors,
    metrics: await page.locator(".vy-chat-messages").evaluateAll((nodes) =>
      nodes.map((node) => ({
        top: node.scrollTop,
        height: node.scrollHeight,
        viewport: node.clientHeight,
        rows: node.querySelectorAll('[id^="msg-"]').length,
      })),
    ),
  });
  throw error;
} finally {
  await browser.close();
}
