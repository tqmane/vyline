import { afterAll, beforeAll, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "@playwright/test";
import type {} from "./agent-i-harness";

let server: ReturnType<typeof Bun.serve>;
let browser: Browser;
beforeAll(async () => {
  const build = await Bun.build({
    entrypoints: [fileURLToPath(new URL("agent-i-harness.tsx", import.meta.url))],
    target: "browser",
  });
  if (!build.success) throw Error(`Agent I fixture did not build: ${build.logs.join("\n")}`);
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      return new URL(request.url).pathname === "/fixture.js"
        ? new Response(build.outputs[0], { headers: { "content-type": "text/javascript" } })
        : new Response(
            '<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><body><script type="module" src="/fixture.js"></script>',
            { headers: { "content-type": "text/html" } },
          );
    },
  });
  browser = await chromium.launch({
    ...(process.platform === "win32" ? { channel: "chrome" } : {}),
    headless: true,
  });
});
afterAll(async () => {
  await browser?.close();
  server?.stop();
});

async function open() {
  const page = await browser.newPage();
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === server.url.origin ? route.continue() : route.abort(),
  );
  await page.goto(server.url.href);
  await waitControl(page, "Agent Iへの質問");
  return page;
}
async function waitControl(page: Page, label: string, value?: string) {
  try {
    await page.waitForFunction(
      ({ label, value }) =>
        window.agentIFixture
          .controls()
          .some(
            (item) => item.label.startsWith(label) && (value === undefined || item.value === value),
          ),
      { label, value },
      { timeout: 5000 },
    );
  } catch {
    throw Error(
      `Missing Agent I control: ${label}; controls: ${await page.evaluate(() =>
        window.agentIFixture
          .controls()
          .map((item) => item.label)
          .join(" | "),
      )}; selects: ${await page.locator("select").count()}`,
    );
  }
}
async function change(page: Page, label: string, value: string) {
  await waitControl(page, label);
  expect(
    await page.evaluate(({ label, value }) => window.agentIFixture.change(label, value), {
      label,
      value,
    }),
  ).toBe(true);
  await waitControl(page, label, value);
}
async function click(page: Page, label: string) {
  await page.waitForFunction(
    (label) =>
      window.agentIFixture.controls().some((item) => item.label === label && !item.disabled),
    label,
  );
  expect(await page.evaluate((label) => window.agentIFixture.click(label), label)).toBe(true);
}
async function register(page: Page) {
  await change(page, "Agent Iの利用モード", "authenticated");
  await change(page, "Yahoo Cookie", "Y=synthetic-ui-secret");
  await change(page, "Yahooアカウントを使い", "true");
  await click(page, "Cookieを一時登録");
  await page.waitForFunction(() => window.agentIFixture.configured("fixture-a"));
  await page.waitForFunction(() =>
    window.agentIFixture.controls().some((item) => item.label.startsWith("Yahoo Cookie登録済み")),
  );
}

test("native controller exposes consent, masked credentials, explicit history and manual clear", async () => {
  const page = await open();
  await change(page, "Agent Iの利用モード", "authenticated");
  await change(page, "Yahoo Cookie", "Y=synthetic-ui-secret");
  expect(
    await page.evaluate(
      () => window.agentIFixture.controls().find((item) => item.label === "Yahoo Cookie")?.secret,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () =>
        window.agentIFixture.controls().find((item) => item.label === "Cookieを一時登録")?.disabled,
    ),
  ).toBe(true);
  await change(page, "Yahooアカウントを使い", "true");
  await click(page, "Cookieを一時登録");
  await page.waitForFunction(() => window.agentIFixture.configured("fixture-a"));
  await change(page, "Agent Iへの質問", "first private question");
  await click(page, "質問する");
  await page.waitForFunction(() =>
    window.agentIFixture
      .controls()
      .some((item) => item.label.includes("AI会話履歴（自動送信しません）")),
  );
  await change(page, "Agent Iへの質問", "second question");
  await click(page, "質問する");
  await page.waitForFunction(
    () => window.agentIFixture.requests.filter((item) => item.path === "chat").length === 2,
  );
  await change(page, "次の質問に表示中", "true");
  await change(page, "Agent Iへの質問", "with explicit history");
  await click(page, "質問する");
  await page.waitForFunction(
    () => window.agentIFixture.requests.filter((item) => item.path === "chat").length === 3,
  );
  const chats = await page.evaluate(() =>
    window.agentIFixture.requests.filter((item) => item.path === "chat"),
  );
  expect(chats.map((item) => item.authMode)).toEqual([
    "authenticated",
    "authenticated",
    "authenticated",
  ]);
  expect(chats.map((item) => item.history?.length)).toEqual([0, 0, 4]);
  await waitControl(page, "次の質問に表示中", "false");
  await click(page, "CookieとAI履歴を消去");
  await waitControl(page, "Agent Iの利用モード", "anonymous");
  expect(await page.evaluate(() => window.agentIFixture.configured("fixture-a"))).toBe(false);
  await page.close();
}, 20_000);

test("rejected credential input is cleared and never echoed in a controller label or sent as a prompt", async () => {
  const page = await open();
  await page.evaluate(() => window.agentIFixture.reject());
  await change(page, "Agent Iの利用モード", "authenticated");
  await change(page, "Yahoo Cookie", "Y=synthetic-rejected-input");
  await change(page, "Yahooアカウントを使い", "true");
  await click(page, "Cookieを一時登録");
  await waitControl(page, "Yahoo Cookie", "");
  await page.waitForFunction(() =>
    window.agentIFixture
      .controls()
      .some((item) => item.label.includes("同意とYahoo Cookieの形式を確認")),
  );
  expect(
    await page.evaluate(() =>
      window.agentIFixture
        .controls()
        .map((item) => item.label)
        .join(" "),
    ),
  ).not.toContain("synthetic-rejected-input");
  expect(await page.evaluate(() => window.agentIFixture.configured("fixture-a"))).toBe(false);
  expect(
    await page.evaluate(
      () => window.agentIFixture.requests.filter((item) => item.path === "chat").length,
    ),
  ).toBe(0);
  await page.close();
}, 20_000);

test("account switch, OFF, logout and late responses cannot retain credentials or another account's text", async () => {
  const page = await open();
  await register(page);
  await page.evaluate(() => window.agentIFixture.defer());
  await change(page, "Agent Iへの質問", "private account A question");
  await click(page, "質問する");
  await page.waitForFunction(() =>
    window.agentIFixture.requests.some((item) => item.path === "chat"),
  );
  await page.evaluate(() => window.agentIFixture.account("fixture-b"));
  await waitControl(page, "Agent Iへの質問", "");
  await page.waitForFunction(() => !window.agentIFixture.configured("fixture-a"));
  await page.evaluate(() => window.agentIFixture.finish());
  await waitControl(page, "Agent Iの利用モード", "anonymous");
  expect(await page.evaluate(() => JSON.stringify(window.agentIFixture.controls()))).not.toContain(
    "fixture answer for fixture-a",
  );
  await page.evaluate(() => window.agentIFixture.account("fixture-a"));
  await register(page);
  await page.evaluate(() => window.agentIFixture.enabled(false));
  await page.waitForFunction(() => !window.agentIFixture.configured("fixture-a"));
  await page.waitForFunction(
    () => !window.agentIFixture.controls().some((item) => item.label === "Agent Iへの質問"),
  );
  await page.evaluate(() => {
    window.agentIFixture.enabled(true);
    window.agentIFixture.account("fixture-a");
  });
  await register(page);
  await page.evaluate(() => window.agentIFixture.account(null));
  await page.waitForFunction(() => !window.agentIFixture.configured("fixture-a"));
  expect(
    await page.evaluate(() =>
      window.agentIFixture.requests
        .filter((item) => item.method === "DELETE")
        .map((item) => item.account),
    ),
  ).toContain("fixture-a");
  await page.close();
}, 20_000);

test("a late credential registration after OFF is discarded; rejected authentication returns to anonymous", async () => {
  const page = await open();
  await page.evaluate(() => window.agentIFixture.deferRegistration());
  await change(page, "Agent Iの利用モード", "authenticated");
  await change(page, "Yahoo Cookie", "Y=synthetic-late-registration");
  await change(page, "Yahooアカウントを使い", "true");
  await click(page, "Cookieを一時登録");
  await page.waitForFunction(() =>
    window.agentIFixture.requests.some((item) => item.method === "PUT"),
  );
  await page.evaluate(() => window.agentIFixture.enabled(false));
  await page.waitForFunction(() =>
    window.agentIFixture.requests.some((item) => item.method === "DELETE"),
  );
  await page.waitForFunction(
    () => !window.agentIFixture.controls().some((item) => item.label === "Agent Iの利用モード"),
  );
  await page.evaluate(() => window.agentIFixture.finishRegistration());
  await page.waitForFunction(
    () => window.agentIFixture.requests.filter((item) => item.method === "DELETE").length >= 2,
  );
  expect(await page.evaluate(() => window.agentIFixture.configured("fixture-a"))).toBe(false);
  await page.evaluate(() => window.agentIFixture.enabled(true));
  await register(page);
  await page.evaluate(() => window.agentIFixture.rejectAuth());
  await change(page, "Agent Iへの質問", "authentication rejection");
  await click(page, "質問する");
  await waitControl(page, "Agent Iの利用モード", "anonymous");
  expect(await page.evaluate(() => window.agentIFixture.configured("fixture-a"))).toBe(false);
  await page.close();
}, 20_000);

test("TTL returns to anonymous, and visible controls work at supported widths without network sends", async () => {
  const page = await open();
  await page.evaluate(() => window.agentIFixture.ttl(1500));
  await register(page);
  await waitControl(page, "Agent Iの利用モード", "anonymous");
  await page.waitForFunction(() => !window.agentIFixture.configured("fixture-a"));
  await page.evaluate(() => window.agentIFixture.visible());
  for (const width of [375, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByLabel("Agent Iの利用モード").selectOption("authenticated");
    await page.getByLabel("Yahoo Cookie", { exact: true }).fill("Y=synthetic-draft");
    expect(await page.getByLabel("Yahoo Cookie", { exact: true }).getAttribute("type")).toBe(
      "password",
    );
    await page.getByLabel("Agent Iの利用モード").selectOption("anonymous");
  }
  expect(
    await page.evaluate(
      () => window.agentIFixture.requests.filter((item) => item.path === "chat").length,
    ),
  ).toBe(0);
  await page.getByLabel("Agent Iの利用モード").selectOption("authenticated");
  await page.getByLabel("Yahoo Cookie", { exact: true }).fill("Y=synthetic-pagehide-draft");
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await page.waitForFunction(
    () =>
      document.querySelector<HTMLInputElement>('input[type="password"]')?.value !==
      "Y=synthetic-pagehide-draft",
  );
  await page.close();
}, 20_000);
