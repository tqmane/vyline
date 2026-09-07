import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";

const base = new URL(process.env.VYLINE_TEST_URL ?? "http://127.0.0.1:5173");
assert(["127.0.0.1", "localhost"].includes(base.hostname), "Local login check only");
const output = resolve(import.meta.dir, "../test-results/login-presentation");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results: object[] = [];
try {
  const preflight = await browser.newContext();
  try {
    const accounts = await preflight.request.get(new URL("/api/auth/accounts", base).href);
    const sessions = await preflight.request.get(new URL("/api/auth/sessions", base).href);
    assert.equal(accounts.status(), 200);
    assert.equal(sessions.status(), 200);
    const accountData = await accounts.json();
    const sessionData = await sessions.json();
    assert.equal(accountData.active?.length, 0, "Requires an empty local backend");
    assert.equal(accountData.saved?.length, 0, "Requires an empty local backend");
    assert.equal(sessionData.sessions?.length, 0, "Requires an empty local backend");
  } finally {
    await preflight.close();
  }

  for (const mode of ["legacy", "apple", "fluent", "miuix", "nezu"]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors: string[] = [];
    const apiRequests: string[] = [];
    const fontRequests: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    // Only read the empty local account/session inventories; never initiate login or QR.
    await page.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const local = url.origin === base.origin;
      const readOnly = request.method() === "GET" || request.method() === "HEAD";
      const inventory = ["/api/auth/accounts", "/api/auth/sessions"].includes(url.pathname);
      const font = ["fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname);
      if ((!local && !font) || !readOnly || (url.pathname.startsWith("/api/") && !inventory)) {
        errors.push(`Unexpected request: ${request.method()} ${url.pathname}`);
        await route.abort();
        return;
      }
      if (url.pathname.startsWith("/api/")) apiRequests.push(`${request.method()} ${url.pathname}`);
      if (font) fontRequests.push(request.url());
      await route.continue();
    });
    await page.addInitScript(
      (mode) =>
        localStorage.setItem(
          "vyline:design-system",
          JSON.stringify({ state: { mode, appearance: "light" }, version: 0 }),
        ),
      mode,
    );
    try {
      await page.goto(new URL("/login", base).href);
      await expect(page.getByRole("heading", { name: "Vyline", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "ログイン", exact: true })).toBeEnabled();
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const viewports: object[] = [];
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await expect(page.locator('input[type="email"]')).toHaveValue("");
        await expect(page.locator('input[type="password"]')).toHaveValue("");
        const bounds = await page.locator("form").evaluate((form) => ({
          left: form.getBoundingClientRect().left,
          right: form.getBoundingClientRect().right,
          scrollWidth: document.documentElement.scrollWidth,
        }));
        assert(bounds.left >= 0 && bounds.right <= width && bounds.scrollWidth <= width);
        viewports.push({ width, ...bounds });
      }
      await page.getByRole("button", { name: "QR コード", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "QR コードを生成", exact: true }),
      ).toBeEnabled();
      await expect(page.locator("svg")).toHaveCount(0);
      await page.getByRole("button", { name: "トークン", exact: true }).click();
      await expect(page.locator("textarea")).toHaveValue("");
      await page.getByRole("button", { name: "メール", exact: true }).click();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() =>
        Promise.all(
          document.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
        ),
      );
      await page.screenshot({ path: resolve(output, `${mode}-390.png`), fullPage: true });
      assert.deepEqual(errors, []);
      assert(apiRequests.includes("GET /api/auth/accounts"));
      assert(apiRequests.includes("GET /api/auth/sessions"));
      results.push({ mode, viewports, errors, apiRequests, fontRequests });
    } finally {
      await page.close();
    }
  }
  await writeFile(resolve(output, "results.json"), JSON.stringify(results, null, 2));
  console.log(
    "PASS: Chrome login forms in all 5 modes at 320/390/1440px; empty local backend, real fonts, no console errors or login requests",
  );
} finally {
  await browser.close();
}
