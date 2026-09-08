import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect, type FrameLocator, type Locator, type Page } from "@playwright/test";

const base = process.env.VYLINE_TEST_URL ?? "http://127.0.0.1:5173";
const output = resolve(import.meta.dir, "../test-results/kmp-announcement-interactions");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results: object[] = [];
const failures: object[] = [];
async function click(page: Page, locator: Locator, touch = false) {
  await expect(locator).toBeAttached();
  let previous = "";
  await expect
    .poll(
      async () => {
        const current = JSON.stringify(await locator.boundingBox());
        const stable = current !== "null" && current === previous;
        previous = current;
        return stable;
      },
      { intervals: [100] },
    )
    .toBe(true);
  const bounds = await locator.boundingBox();
  assert(bounds && bounds.width > 0 && bounds.height > 0);
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  if (touch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

async function checkScrollPosition(page: Page, native: FrameLocator, mode: string) {
  const expand = native.getByRole("button", { name: "アナウンスを展開", exact: true });
  const collapse = native.getByRole("button", { name: "アナウンスを折りたたむ", exact: true });
  const latest = native.getByRole("button", { name: "最新のメッセージへ", exact: true });
  const observations: object[] = [];
  await page.evaluate(async () => {
    const path = performance.getEntriesByType("resource").find((entry) => new URL(entry.name).pathname === "/src/lib/store.ts")!.name;
    const { useStore } = await import(path);
    const state = useStore.getState();
    if (!state.demoMode || state.accountId !== null) throw new Error("Account-free demo required");
    (window as any).announcementAuditOriginal = { messages: state.messages, announcements: state.announcements };
    const original = state.messages.find((message: any) => message.id === "demo-message-1");
    useStore.setState({ messages: Array.from({ length: 80 }, (_, index) => ({ ...original,
      id: `announcement-position-${index}`, text: `位置保持確認 ${String(index).padStart(2, "0")} メッセージ本文`,
      createdAt: original.createdAt - (80 - index) * 60_000,
    })), announcements: { "demo-chat-team": [] }, highlightMessageId: null });
  });
  try {
    for (const count of [0, 2, 24]) {
      if (await collapse.count()) await click(page, collapse);
      await page.evaluate(async (count) => {
        const path = performance.getEntriesByType("resource").find((entry) => new URL(entry.name).pathname === "/src/lib/store.ts")!.name;
        (await import(path)).useStore.setState({ announcements: { "demo-chat-team": Array.from({ length: count }, (_, index) => ({
          announcementSeq: `position-${index}`, text: `位置確認アナウンス ${index + 1}`,
          link: "line://nv/chat?messageId=announcement-position-40",
        })) } });
      }, count);
      await page.waitForTimeout(350);
      if (count === 0) {
        await expect(expand).toHaveCount(0);
        await expect(collapse).toHaveCount(0);
        if (await latest.count()) await click(page, latest);
        await expect(latest).toHaveCount(0);
        observations.push({ count, emptyAnnouncements: "no disclosure or false latest button" });
        continue;
      }
      for (const position of ["top", "middle", "end", "end-40"]) {
        if (position === "end") {
          if (await latest.count()) await click(page, latest);
        } else if (position === "end-40") {
          const bounds = await native.getByRole("list", { name: "メッセージ履歴", exact: true }).boundingBox();
          assert(bounds);
          await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height * .65);
          await page.mouse.wheel(0, -40 * await page.evaluate(() => devicePixelRatio));
        } else {
          await page.evaluate(async (position) => {
            const path = performance.getEntriesByType("resource").find((entry) => new URL(entry.name).pathname === "/src/lib/store.ts")!.name;
            (await import(path)).useStore.setState({ highlightMessageId: `announcement-position-${position === "top" ? 0 : 40}` });
          }, position);
        }
        await page.waitForTimeout(350);
        const visible = native.getByRole("button", { name: /^位置保持確認 / });
        let target: Locator | undefined;
        for (const candidate of await visible.all()) {
          const box = await candidate.boundingBox();
          // Keep the tracked bubble below even the fully expanded banner.
          if (box && box.y > 530 && box.y + box.height < 745) target = candidate;
        }
        assert(target, `${mode}/${count}/${position}: a visible history anchor is required`);
        const name = await target.getAttribute("aria-label") ?? (await target.innerText()).trim();
        assert(name);
        const tracked = native.getByRole("button", { name, exact: true });
        const before = await tracked.boundingBox();
        assert(before);
        if (position === "end-40") {
          const end = observations.findLast((item: any) => item.count === count && item.position === "end") as { name: string; before: number };
          assert(end && end.name === name && Math.abs(before.y - end.before - 40) < 3,
            "The near-end fixture must actually move 40 CSS pixels above the end");
        }
        const latestBefore = await latest.count();
        await click(page, expand, count === 24 && position === "end");
        await expect(collapse).toBeAttached();
        await page.waitForTimeout(300);
        const expanded = await tracked.count() ? await tracked.boundingBox() : null;
        const latestExpanded = await latest.count();
        await click(page, collapse, count === 24 && position === "end");
        await page.waitForTimeout(300);
        const collapsed = await tracked.count() ? await tracked.boundingBox() : null;
        const latestCollapsed = await latest.count();
        const observation = { mode, count, position, name, before: before.y, expanded: expanded?.y, collapsed: collapsed?.y, latestBefore, latestExpanded, latestCollapsed };
        observations.push(observation);
        console.log("announcement scroll", observation);
        assert(expanded && Math.abs(expanded.y - before.y) < 3, `${mode}/${count}/${position}: expansion moved the message`);
        assert(collapsed && Math.abs(collapsed.y - before.y) < 3, `${mode}/${count}/${position}: collapse moved the message`);
        assert.equal(latestExpanded, latestBefore, `${mode}/${count}/${position}: expansion changed the latest position`);
        assert.equal(latestCollapsed, latestBefore, `${mode}/${count}/${position}: collapse changed the latest position`);
      }
    }
    await page.evaluate(async () => {
      const path = performance.getEntriesByType("resource").find((entry) => new URL(entry.name).pathname === "/src/lib/store.ts")!.name;
      (await import(path)).useStore.setState({ messages: [], highlightMessageId: null });
    });
    await click(page, expand);
    await expect(collapse).toBeAttached();
    await expect(latest).toHaveCount(0);
    await click(page, collapse);
    await expect(collapse).toHaveCount(0);
    await expect(latest).toHaveCount(0);
    observations.push({ count: 24, emptyHistory: "expand/collapse preserves an empty history" });
    return observations;
  } finally {
    await writeFile(resolve(output, `${mode}-scroll.json`), JSON.stringify(observations, null, 2));
    if (await collapse.count()) {
      await click(page, collapse);
      await expect(collapse).toHaveCount(0);
    }
    await page.evaluate(async () => {
      const path = performance.getEntriesByType("resource").find((entry) => new URL(entry.name).pathname === "/src/lib/store.ts")!.name;
      (await import(path)).useStore.setState({ ...(window as any).announcementAuditOriginal, highlightMessageId: null });
    });
  }
}

try {
  for (const mode of process.env.VYLINE_TEST_MODES?.split(",") ?? ["apple", "fluent", "miuix"]) {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      hasTouch: true,
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(
      (mode) =>
        localStorage.setItem(
          "vyline:design-system",
          JSON.stringify({ state: { mode, appearance: "light" }, version: 0 }),
        ),
      mode,
    );
    try {
      await page.goto(`${base}/pr-demo`);
      await expect(page.locator('[data-kmp-ready="true"]')).toBeVisible({ timeout: 60_000 });
      const native = page.frameLocator('iframe[title="Vyline Compose UI"]');
      const scrollObservations = await checkScrollPosition(page, native, mode);
      await page.evaluate(async () => {
        const path = performance
          .getEntriesByType("resource")
          .find((entry) => new URL(entry.name).pathname === "/src/lib/store.ts")?.name;
        if (!path) throw new Error("Loaded store module missing");
        const { useStore } = await import(path);
        if (!useStore.getState().demoMode || useStore.getState().accountId !== null)
          throw new Error("Account-free demo required");
        useStore.setState({
          announcements: {
            "demo-chat-team": Array.from({ length: 24 }, (_, index) => ({
              announcementSeq: `audit-${index}`,
              text: `操作確認 ${String(index + 1).padStart(2, "0")} 複数アナウンスの本文`,
              link: `line://nv/chat?messageId=demo-message-${(index % 4) + 1}`,
            })),
          },
        });
      });
      const expand = native.getByRole("button", { name: "アナウンスを展開", exact: true });
      const collapse = native.getByRole("button", { name: "アナウンスを折りたたむ", exact: true });
      const first = native.getByRole("button", {
        name: "アナウンス: 操作確認 01 複数アナウンスの本文",
        exact: true,
      });
      const last = native.getByRole("button", {
        name: "アナウンス: 操作確認 24 複数アナウンスの本文",
        exact: true,
      });
      const editor = native.getByRole("textbox", { name: "メッセージを入力", exact: true });
      await expect(first).toBeAttached();
      console.log(`${mode}: disclosure cycles`);
      await expect(last).toHaveCount(0);
      const trackedMessage = native.getByRole("button", { name: "個人情報を含まない安全なPRデモです。", exact: true });
      const latestMessage = native.getByRole("button", { name: "最新のメッセージへ", exact: true });
      for (let cycle = 0; cycle < 2; cycle++) {
        const before = await trackedMessage.boundingBox();
        assert(before);
        const latestBefore = await latestMessage.count();
        console.log(`${mode}: announcement before`, { before, latestBefore });
        await click(page, expand);
        await expect(collapse).toBeAttached();
        await page.waitForTimeout(250);
        const expandedPosition = await trackedMessage.count() ? await trackedMessage.boundingBox() : null;
        console.log(`${mode}: announcement position`, { before, expandedPosition, latestBefore, latestAfter: await latestMessage.count() });
        assert(expandedPosition && Math.abs(expandedPosition.y - before.y) < 3, "Expanding announcements must preserve the visible message position");
        assert.equal(await latestMessage.count(), latestBefore, "Expanding announcements must preserve the latest-message state");
        const box = await native.locator('[aria-label="アナウンス一覧"]').boundingBox();
        const input = await editor.boundingBox();
        assert(box && box.height <= 290, "Expanded announcements must be bounded");
        assert(
          input && input.y > box.y + box.height && input.y + input.height <= 844,
          "Composer must remain usable",
        );
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.wheel(0, 2200);
        await expect
          .poll(async () => {
            const end = await last.boundingBox();
            return !!end && end.y >= box.y && end.y < box.y + box.height;
          })
          .toBe(true);
        await click(page, collapse);
        await expect(last).toHaveCount(0);
        await page.waitForTimeout(250);
        const collapsedPosition = await trackedMessage.boundingBox();
        assert(collapsedPosition && Math.abs(collapsedPosition.y - before.y) < 3, "Collapsing announcements must preserve the visible message position");
      }
      await click(page, expand);
      console.log(`${mode}: settings return`);
      // Opening settings must not lose the shared disclosure state.
      if (mode === "apple") {
        await click(page, native.getByRole("button", { name: "添付とその他の操作", exact: true }));
        await click(page, native.getByRole("button", { name: "設定", exact: true }).last());
        await click(page, native.getByRole("button", { name: "すべての設定", exact: true }));
      } else await click(page, native.getByRole("button", { name: "設定", exact: true }).last());
      await expect(
        native.getByRole("button", { name: "設定を閉じる", exact: true }),
      ).toBeAttached();
      await page.keyboard.press("Escape");
      await expect(native.getByRole("button", { name: "設定を閉じる", exact: true })).toHaveCount(
        0,
      );
      await expect
        .poll(() =>
          page.evaluate(async () => {
            const path = performance
              .getEntriesByType("resource")
              .find((entry) => new URL(entry.name).pathname === "/src/lib/store.ts")!.name;
            return (await import(path)).useStore.getState().screen;
          }),
        )
        .toBe("chat");
      await expect(collapse).toBeAttached();
      console.log(`${mode}: jump and remove`);
      await click(page, collapse);
      await click(page, first);
      await expect
        .poll(() =>
          page.evaluate(async () => {
            const path = performance
              .getEntriesByType("resource")
              .find((entry) => new URL(entry.name).pathname === "/src/lib/store.ts")!.name;
            return (await import(path)).useStore.getState().highlightMessageId;
          }),
        )
        .toBe("demo-message-1");
      await click(page, expand);
      await click(
        page,
        native.getByRole("button", {
          name: "アナウンスを解除: 操作確認 01 複数アナウンスの本文",
          exact: true,
        }),
      );
      await expect(first).toHaveCount(0);
      await expect(native.getByText("アナウンス (23)", { exact: true })).toBeAttached();
      await page.screenshot({ path: resolve(output, `${mode}-expanded.png`) });
      await click(page, collapse);
      console.log(`${mode}: keyboard search`);
      if (mode === "apple")
        await click(page, native.getByRole("button", { name: "添付とその他の操作", exact: true }));
      await click(page, native.getByRole("button", { name: "トーク内を検索", exact: true }));
      const search = native.getByRole("textbox", { name: "トーク内を検索", exact: true });
      await click(page, search);
      await page.keyboard.insertText("。");
      await expect(native.getByText("1/3", { exact: true })).toBeAttached();
      await page.keyboard.press("Enter");
      await expect(native.getByText("2/3", { exact: true })).toBeAttached();
      await page.keyboard.press("Shift+Enter");
      await expect(native.getByText("1/3", { exact: true })).toBeAttached();
      await page.keyboard.press("Escape");
      await expect(search).toHaveCount(0);
      assert.deepEqual(errors, []);
      results.push({
        mode,
        scrollObservations,
        passed: [
          "24 announcements bounded scroll",
          "repeated expand/collapse",
          "settings return preserves state",
          "jump",
          "remove",
          "search Enter/Shift+Enter/Escape",
        ],
        errors,
      });
    } catch (error) {
      console.log(mode, error);
      await page.screenshot({ path: resolve(output, `${mode}-failure.png`) });
      failures.push({ mode, error: String(error) });
    } finally {
      await page.close();
    }
  }
  await writeFile(resolve(output, "results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  assert.deepEqual(failures, [], "Every theme must retain the announcement/history interaction");
} finally {
  await browser.close();
}
