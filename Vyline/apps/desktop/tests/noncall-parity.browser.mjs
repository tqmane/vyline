import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Disconnected product demo; no account, message send, or external network.
const output = join(tmpdir(), "vyline-noncall-parity-20261103");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
const modes = process.env.VYLINE_PARITY_MODE ? [process.env.VYLINE_PARITY_MODE] : ["legacy", "nezu", "apple", "fluent", "miuix"];
try {
  for (const mode of modes) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
    await context.addInitScript(() => {
      Error.stackTraceLimit = 80;
      window.__qaModel = {};
      window.addEventListener("message", event => {
        try {
          const value = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
          if (value?.channel === "vyline-ui" && ["snapshot", "patch"].includes(value.type))
            Object.assign(window.__qaModel, value);
        } catch { /* Other product messages are irrelevant to this fixture. */ }
      });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(25_000);
    const errors = [];
    let stage = "open-demo";
    page.on("pageerror", error => {
      errors.push(error.message);
      console.error(JSON.stringify({ mode, stage, url: page.url(), error: error.message, stack: error.stack }));
    });
    await page.goto("http://127.0.0.1:5187/pr-demo");
    await expect(page.getByText("DEMO MODE ON · 仮データのみ · 実アカウント接続なし")).toBeVisible();
    await page.evaluate(async mode => {
      // Vite's HMR URLs identify the running modules; a plain import creates a second store.
      const loadedModule = path => performance.getEntriesByType("resource").find(resource => new URL(resource.name).pathname === path)?.name ?? path;
      const { useStore } = await import(loadedModule("/src/lib/store.ts"));
      const { useDesignSystemStore } = await import(loadedModule("/src/ui/design-system-store.ts"));
      window.__qaUseStore = useStore;
      useDesignSystemStore.getState().setMode(mode);
      const state = useStore.getState();
      const chatId = state.activeChatId;
      const base = { chatId, authorId: "fixture-peer", kind: "text", text: "保存済みの原文・取消後も表示", createdAt: Date.now(), status: "sent", read: false, messageState: "normal" };
      useStore.setState({ messages: [{ ...base, id: "991" }], showUpdateNote: false });
      useStore.getState().applyRevoked(chatId, "991");
    }, mode);
    const native = ["apple", "fluent", "miuix"].includes(mode);
    let frame;
    if (native) {
      await expect(page.locator("iframe")).toHaveCount(1);
      frame = page.frames().find(frame => frame !== page.mainFrame());
      await frame.waitForFunction(() => window.__qaModel?.messages?.some(message => message.id === "991" && message.hostContent));
      await expect(frame.getByText("保存済みの原文・取消後も表示", { exact: true })).toBeVisible();
    } else await expect(page.getByText("保存済みの原文・取消後も表示", { exact: true })).toBeVisible();
    for (const [width, height] of [[375, 667], [390, 844], [768, 1024], [1440, 900]]) {
      stage = `viewport-${width}x${height}`;
      await page.setViewportSize({ width, height });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      await expect((native ? frame : page).getByText("保存済みの原文・取消後も表示", { exact: true })).toBeVisible();
      await page.screenshot({ path: join(output, `${mode}-${width}-retained.png`) });
      results.push({ mode, width, height, retained: true });
    }
    if (native) {
      stage = "settings-open";
      await frame.evaluate(() => window.parent.postMessage(JSON.stringify({ channel: "vyline-ui", version: 1, type: "action", action: "settings", epoch: window.__qaModel.epoch }), location.origin));
      await frame.waitForFunction(() => JSON.stringify(window.__qaModel.nativePanel).includes("サポート"));
      const labels = await frame.evaluate(() => JSON.stringify(window.__qaModel.nativePanel));
      expect(labels).toContain("サポート"); expect(labels).toContain("設定JSON");
      for (const [label, expected] of [["サポート", "問題の概要"], ["設定JSON", "設定JSONを書き出す"], ["プライバシー", "配信者モード"]]) {
        stage = `settings-${label}`;
        await frame.evaluate(label => {
          const flatten = items => items.flatMap(item => [item, ...flatten(item.items || [])]);
          const model = window.__qaModel;
          const item = flatten(model.nativePanel.items).find(item => item.label === label);
          if (!item) throw Error(`Missing native category ${label}`);
          window.parent.postMessage(JSON.stringify({ channel: "vyline-ui", version: 1, type: "action", action: "panel-action", id: item.id, epoch: model.epoch }), location.origin);
        }, label);
        await frame.waitForFunction(expected => JSON.stringify(window.__qaModel.nativePanel).includes(expected), expected);
        await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        expect(errors, `${mode}: ${stage}`).toEqual([]);
      }
    } else {
      await page.evaluate(() => window.__qaUseStore.getState().setScreen("settings"));
      await page.getByRole("button", { name: "サポート", exact: true }).click();
      await expect(page.getByRole("textbox", { name: "問題の概要" })).toBeVisible();
      await page.getByRole("button", { name: "設定JSON", exact: true }).click();
      await expect(page.getByRole("button", { name: /エクスポート/ }).first()).toBeVisible();
    }
    await page.screenshot({ path: join(output, `${mode}-settings.png`) });
    expect(errors).toEqual([]);
    await context.close();
  }
  await writeFile(join(output, "results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ checks: results.length, modes: modes.length, errors: 0, artifacts: output }));
} finally { await browser.close(); }
