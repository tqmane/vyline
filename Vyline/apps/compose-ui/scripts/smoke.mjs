import assert from "node:assert/strict";
import { runThemeMotionProbes } from "./theme-motion-probes.mjs";
import { runMobileInputProbes } from "./mobile-input-probes.mjs";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { chromium, expect } = createRequire(join(project, "../desktop/package.json"))(
  "@playwright/test",
);
const distribution = join(
  project,
  "dist/gradle/dist/wasmJs",
  process.argv.includes("--production") ? "productionExecutable" : "developmentExecutable",
);
const artifacts = join(
  project,
  "dist/gradle/browser-smoke",
  `${process.argv.includes("--production") ? "prod" : "dev"}-${Date.now()}`,
);
console.log(`Artifacts: ${artifacts}`);
const chatMode = process.argv.includes("--chat");
await mkdir(artifacts, { recursive: true });
const server = createServer(async (request, response) => {
  if (request.url === "/") {
    response.setHeader("Content-Type", "text/html;charset=utf-8");
    response.end(`<!doctype html><html style="height:100%;overflow:hidden"><body style="margin:0;height:100%;overflow:hidden"><iframe title="sidebar" src="/index.html?selftest=1" style="display:block;border:0;width:100%;height:100%"></iframe><script>
      window.actions=[];window.slotEvents=[];window.ready=false;
      window.sendSnapshot=(state)=>document.querySelector('iframe').contentWindow.postMessage(JSON.stringify({channel:'vyline-ui',version:1,type:'snapshot',...state}),location.origin);
      window.sendPatch=(state)=>document.querySelector('iframe').contentWindow.postMessage(JSON.stringify({channel:'vyline-ui',version:1,type:'patch',...state}),location.origin);
      addEventListener('message',event=>{if(event.source!==document.querySelector('iframe').contentWindow||event.origin!==location.origin)return;const value=event.data;if(value.type==='ready'){window.ready=true;window.messageDelta=value.messageDelta;window.readyCount=(window.readyCount||0)+1;}if(value.type==='action')window.actions.push(value);if(value.type==='error')window.frameError=value.message;if(value.type==='content-slot'||value.type==='content-slot-removed')window.slotEvents.push(value);});
    </script></body></html>`);
    return;
  }
  const path = resolve(distribution, `.${decodeURIComponent((request.url ?? "/").split("?")[0])}`);
  if (!path.startsWith(distribution + sep)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const bytes = await readFile(path);
    response.setHeader(
      "Content-Type",
      {
        ".wasm": "application/wasm",
        ".js": "text/javascript",
        ".html": "text/html;charset=utf-8",
        ".ttf": "font/ttf",
      }[extname(path)] ?? "application/octet-stream",
    );
    response.end(bytes);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((accept) => server.listen(0, "127.0.0.1", accept));
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {}),
});
try {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: process.argv.includes("--profile") ? 2 : 1,
  });
  if (process.argv.includes("--regressions")) page.setDefaultTimeout(10_000);
  const errors = [];
  const clickNative = async (locator) => {
    const bounds = await locator.boundingBox();
    assert.ok(bounds, "Compose must provide semantic bounds");
    // The a11y DOM mirror deliberately sits behind the canvas; exercise real native pointer input.
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  };
  const openSettings = async (frame, mode) => {
    if (mode === "apple") {
      await clickNative(frame.getByRole("button", { name: "添付とその他の操作", exact: true }));
      await clickNative(frame.getByRole("button", { name: "設定", exact: true }).last());
    } else await clickNative(frame.getByRole("button", { name: "設定", exact: true }).last());
  };
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.ready || window.frameError, null, { timeout: 60_000 });
  assert.equal(
    await page.evaluate(() => window.frameError),
    undefined,
    "font loading must succeed",
  );
  const state = {
    mode: "apple",
    dark: false,
    reducedMotion: false,
    query: "",
    tab: "all",
    tabs: [
      { id: "all", label: "すべて" },
      { id: "unread", label: "未読" },
      { id: "groups", label: "グループ" },
    ],
    rows: Array.from({ length: 1200 }, (_, index) => ({
      id: `chat-${index}`,
      title: `${["高橋 美咲", "週末の予定", "Vyline 開発", "写真を共有", "山田 太郎"][index % 5]} ${index + 1}`,
      preview: [
        "明日は何時に集合する？",
        "写真を送信しました",
        "このUI、いい感じですね",
        "ありがとう！また後で連絡します",
      ][index % 4],
      time: index % 2 ? "昨日" : "12:34",
      unread: index % 4 === 0 ? 3 : 0,
      avatar: ["高", "週", "V", "写", "山"][index % 5],
      color: "#7C98B8",
      selected: index === 1,
      pinned: index === 2,
      muted: false,
      locked: false,
    })),
    profile: { name: "検証ユーザー", status: "" },
    sortLabel: "新しい順",
    canRefresh: true,
    splitPick: false,
  };
  const sampleSvg = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="360" height="240"><rect width="360" height="240" rx="20" fill="#D5E8F5"/><path d="M0 210L100 70L200 200L260 110L360 210V240H0Z" fill="#77A28F"/><circle cx="280" cy="55" r="26" fill="#F9CC79"/></svg>')}`;
  if (chatMode)
    Object.assign(state, {
      chat: {
        id: "chat-0",
        title: "高橋 美咲",
        status: "オンライン",
        avatar: "高",
        color: "#7C98B8",
        isGroup: false,
        locked: false,
        blocked: false,
      },
      view: "chat",
      appearance: "light",
      notice: "",
      messages: Array.from({ length: 1200 }, (_, index) => ({
        id: `message-${index}`,
        authorId: index % 3 ? "friend" : "me",
        authorName: index % 3 ? "高橋 美咲" : "自分",
        avatar: "高",
        color: "#7C98B8",
        kind: "text",
        text: [
          "明日の待ち合わせ、駅のカフェでどう？",
          "いいね！10時くらいに行けると思う",
          "了解です。楽しみにしています！",
        ][index % 3],
        createdAt: 1788706800000 + index * 60_000,
        time: "12:34",
        status: "sent",
        messageState: "normal",
        canReact: true,
        readCount: 1,
        reactions: [],
        groupStart: index % 3 !== 2,
        groupEnd: index % 3 !== 1,
      })),
      composer: {
        text: "",
        pending: [],
        recording: false,
        recordingSeconds: 0,
        sending: false,
        enterToSend: true,
        voiceEnabled: true,
        mute: false,
        available: true,
        canSendMedia: false,
      },
      settings: {
        enterToSend: true,
        voiceMessagesEnabled: true,
        compactDensity: false,
        bubbleTail: true,
        fontScale: 1,
        showReaderList: true,
      },
    });
  for (const mode of ["apple", "fluent", "miuix"]) {
    state.mode = mode;
    state.epoch ??= 1;
    await page.evaluate((state) => window.sendSnapshot(state), state);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: join(artifacts, `${mode}${chatMode ? "-chat" : ""}-light.png`) });
    const frame = page.frames()[1];
    if (process.argv.includes("--mobile")) {
      await runMobileInputProbes({ page, frame, state, artifacts, expect, clickNative });
      continue;
    }
    if (process.argv.includes("--motion")) {
      assert.ok(chatMode, "--motion requires --chat");
      await runThemeMotionProbes({ page, frame, state, artifacts, expect, clickNative });
    }
    if (chatMode && process.argv.includes("--regressions")) {
      const message = {
        ...state.messages.at(-1),
        id: "live-menu",
        authorId: "me",
        text: "更新前の本文",
      };
      const editor = frame.getByRole("textbox", { name: "メッセージを入力", exact: true });
      const reply = { ...state.composer, replyToId: message.id, replyText: message.text };
      await page.evaluate(
        (state) => {
          window.actions = [];
          window.sendSnapshot(state);
        },
        { ...state, messages: [message], composer: reply },
      );
      await expect(
        frame.getByRole("button", { name: "返信をキャンセル", exact: true }),
      ).toBeAttached();
      await clickNative(editor);
      await page.keyboard.press("Escape");
      await page.waitForFunction(
        () => window.actions.some((item) => item.action === "cancel-reply"),
        null,
        { timeout: 5000 },
      );
      await page.evaluate(
        (composer) => {
          window.actions = [];
          window.sendPatch({ composer });
        },
        {
          ...reply,
          text: "@",
          mentionOptions: [{ all: true, name: "全員" }],
          mentionIndex: 0,
        },
      );
      await expect(
        frame.getByRole("button", { name: "全員をメンション", exact: true }),
      ).toBeAttached();
      await clickNative(editor);
      await page.keyboard.press("Tab");
      await page.waitForFunction(
        () => window.actions.some((item) => item.action === "mention" && item.id === "0"),
        null,
        { timeout: 5000 },
      );
      // Escape dismisses suggestions before cancelling the reply on a second press.
      await clickNative(editor);
      await page.keyboard.press("Escape");
      await expect(
        frame.getByRole("button", { name: "全員をメンション", exact: true }),
      ).toHaveCount(0);
      assert.equal(
        await page.evaluate(() => window.actions.some((item) => item.action === "cancel-reply")),
        false,
      );
      await page.keyboard.press("Escape");
      await page.waitForFunction(
        () => window.actions.some((item) => item.action === "cancel-reply"),
        null,
        { timeout: 5000 },
      );
      await page.evaluate((composer) => window.sendPatch({ composer }), state.composer);
      await expect(editor).toHaveText("");
      console.log(`${mode}: reply/mention keyboard passed`);
      const openMenu = async (text) => {
        const bubble = frame.getByRole("button", { name: text, exact: true });
        await expect(bubble).toBeAttached();
        const box = await bubble.boundingBox();
        assert.ok(box);
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
        await expect(frame.getByRole("button", { name: "返信", exact: true })).toBeAttached();
      };
      await openMenu(message.text);
      const edited = { ...message, text: "別端末で更新した本文", edited: true };
      await page.evaluate((message) => window.sendPatch({ messages: [message] }), edited);
      await expect(frame.getByText(message.text, { exact: true })).toHaveCount(0);
      await expect(frame.getByRole("button", { name: "返信", exact: true })).toBeAttached();
      await clickNative(frame.getByRole("button", { name: "編集", exact: true }));
      await expect(
        frame.getByRole("textbox", { name: "編集するメッセージ", exact: true }),
      ).toHaveText(edited.text);
      await page.evaluate((message) => window.sendPatch({ messages: [message] }), {
        ...edited,
        text: "メッセージの送信を取り消しました",
        messageState: "revoked",
      });
      await expect(
        frame.getByRole("textbox", { name: "編集するメッセージ", exact: true }),
      ).toHaveCount(0);
      await expect(frame.getByRole("button", { name: "返信", exact: true })).toHaveCount(0);
      await expect(frame.getByRole("button", { name: "編集", exact: true })).toHaveCount(0);
      await page.evaluate((message) => window.sendPatch({ messages: [message] }), edited);
      await openMenu(edited.text);
      await page.evaluate(() => window.sendPatch({ messages: [] }));
      await expect(frame.getByRole("button", { name: "返信", exact: true })).toHaveCount(0);
      console.log(`${mode}: live menu updates passed`);
      await page.evaluate((message) => window.sendPatch({ messages: [message] }), message);
      await clickNative(editor);
      await page.keyboard.insertText("前のアカウントの未反映入力");
      await expect(editor).toHaveText("前のアカウントの未反映入力");
      await openMenu(message.text);
      // The same chat ID can be visible in two accounts: no local draft/menu may survive its epoch.
      state.epoch += 1;
      await page.evaluate((state) => window.sendSnapshot(state), { ...state, messages: [message] });
      await expect(editor).toHaveText("");
      await expect(frame.getByRole("button", { name: "返信", exact: true })).toHaveCount(0);
      console.log(`${mode}: account isolation passed`);
      if (mode === "apple") {
        for (const chatState of [{ locked: true }, { blocked: true }]) {
          await page.evaluate(
            ({ chat, composer }) => window.sendPatch({ chat, composer, profileOpen: true }),
            {
              chat: { ...state.chat, ...chatState },
              composer: state.composer,
            },
          );
          await expect(editor).toHaveCount(0);
          await clickNative(frame.getByRole("button", { name: "トーク内を検索", exact: true }));
          await page.waitForFunction(() =>
            window.actions.some((item) => item.action === "chat-search"),
          );
          await page.evaluate(() => {
            window.actions = [];
            window.sendPatch({ profileOpen: false });
          });
          await expect(
            frame.getByRole("button", { name: "トーク内を検索", exact: true }),
          ).toHaveCount(0);
          await page.evaluate(() => window.sendPatch({ profileOpen: true }));
          await clickNative(frame.getByRole("button", { name: "トークの操作", exact: true }));
          await page.waitForFunction(() =>
            window.actions.some((item) => item.action === "chat-menu"),
          );
          await page.evaluate(() => {
            window.actions = [];
            window.sendPatch({ profileOpen: false });
          });
        }
      }
      await page.evaluate((state) => window.sendSnapshot(state), state);
      console.log(
        `${mode}: reply/mention keyboard, live menu updates, account isolation and locked-chat controls passed`,
      );
      continue;
    }
    if (chatMode && process.argv.includes("--slots")) {
      await page.evaluate(() => {
        window.slotEvents = [];
      });
      await page.evaluate(
        (message) =>
          window.sendPatch({
            messages: [{ ...message, id: "shared-content", hostContent: true }],
            hostContentHeights: { "shared-content": 245 },
          }),
        state.messages.at(-1),
      );
      await page.waitForFunction(() =>
        window.slotEvents.some(
          (event) =>
            event.type === "content-slot" &&
            event.id === "shared-content" &&
            event.chatId === "chat-0" &&
            event.epoch === 1,
        ),
      );
      await frame.waitForFunction(
        () => window.__vylineMessageSlots?.get("shared-content")?.isConnected,
      );
      const slot = await frame.evaluate(() => {
        const element = window.__vylineMessageSlots.get("shared-content");
        element.textContent = "共有レンダラーの内容";
        return {
          height: element.getBoundingClientRect().height,
          width: element.getBoundingClientRect().width,
        };
      });
      assert.ok(
        Math.abs(slot.height - 245) < 1 && slot.width <= 360,
        "inline shared content must follow the measured native layout",
      );
      await page.evaluate(() =>
        window.sendPatch({ hostContentHeights: { "shared-content": 312 } }),
      );
      await frame.waitForFunction(
        () =>
          Math.abs(
            window.__vylineMessageSlots.get("shared-content").getBoundingClientRect().height - 312,
          ) < 1,
      );
      await page.evaluate(() => window.sendPatch({ chat: null, messages: [] }));
      await page.waitForFunction(() =>
        window.slotEvents.some(
          (event) => event.type === "content-slot-removed" && event.id === "shared-content",
        ),
      );
      assert.equal(
        await frame.evaluate(() => window.__vylineMessageSlots.has("shared-content")),
        false,
      );
      await frame.getByRole("list", { name: "メッセージ履歴" }).waitFor({ state: "detached" });
      await page.evaluate((state) => window.sendSnapshot(state), state);
      await frame.getByRole("list", { name: "メッセージ履歴" }).waitFor({ state: "attached" });
      console.log(`${mode}: inline shared content creation, resize, scope and cleanup passed`);
    }
    if (chatMode && process.argv.includes("--delta")) {
      assert.equal(
        await page.evaluate(() => window.messageDelta),
        true,
        "renderer must advertise delta support",
      );
      const added = {
        ...state.messages.at(-1),
        id: `delta-${mode}`,
        text: "差分で受信したメッセージ",
        createdAt: state.messages.at(-1).createdAt + 1000,
      };
      await page.evaluate(
        ({ updates, ids }) => window.sendPatch({ messageDelta: { updates, ids } }),
        { updates: [added], ids: [...state.messages.map((message) => message.id), added.id] },
      );
      await expect(frame.getByRole("list", { name: "メッセージ履歴" })).toContainText(
        "差分で受信したメッセージ",
      );
      await page.evaluate((message) => window.sendPatch({ messageDelta: { updates: [message] } }), {
        ...added,
        text: "差分を更新しました",
      });
      await expect(frame.getByRole("list", { name: "メッセージ履歴" })).toContainText(
        "差分を更新しました",
      );
      await page.evaluate(
        (ids) => window.sendPatch({ messageDelta: { updates: [], ids } }),
        state.messages.map((message) => message.id),
      );
      await expect(frame.getByRole("list", { name: "メッセージ履歴" })).not.toContainText(
        "差分を更新しました",
      );
      console.log(`${mode}: delta append/update/remove passed`);
    }
    const accessible = await frame.locator("body").ariaSnapshot();
    assert.match(
      accessible,
      /高橋 美咲/,
      "Japanese conversation labels must reach the accessibility tree",
    );
    assert.ok(
      (await frame.getByRole("button").count()) < 80,
      "1200 conversations must remain virtualized",
    );
    if (chatMode) {
      await clickNative(frame.getByRole("textbox", { name: "メッセージを入力", exact: true }));
      await page.keyboard.insertText("確認メッセージ");
      await page.waitForFunction(() =>
        window.actions.some((item) => item.action === "draft" && item.value === "確認メッセージ"),
      );
      await page.keyboard.press("Shift+Enter");
      await page.keyboard.insertText("二行目");
      await page.waitForFunction(() =>
        window.actions.some(
          (item) => item.action === "draft" && item.value === "確認メッセージ\n二行目",
        ),
      );
      await expect(
        frame.getByRole("textbox", { name: "メッセージを入力", exact: true }),
      ).toContainText("二行目");
      await clickNative(frame.getByRole("button", { name: "送信", exact: true }));
      await page.waitForFunction(() => window.actions.some((item) => item.action === "send"));
      await page.evaluate(
        (composer) => window.sendPatch({ composer: { ...composer, text: "" } }),
        state.composer,
      );
      await expect(
        frame.getByRole("textbox", { name: "メッセージを入力", exact: true }),
      ).toHaveText("");
      const incoming = frame
        .getByRole("list", { name: "メッセージ履歴" })
        .getByRole("button")
        .filter({ hasText: "了解です。楽しみにしています！" });
      const bubble = await incoming.nth(Math.floor((await incoming.count()) / 2)).boundingBox();
      assert.ok(bubble, "message actions require a real visible bubble");
      await page.mouse.click(bubble.x + bubble.width / 2, bubble.y + bubble.height / 2, {
        button: "right",
      });
      await page.waitForTimeout(150);
      assert.deepEqual(
        errors,
        [],
        "opening a message menu must not merge PaneTitle into the scrim",
      );
      await clickNative(frame.getByRole("button", { name: "返信", exact: true }));
      await page.waitForFunction(() => window.actions.some((item) => item.action === "reply"));
      await expect(frame.getByRole("button", { name: "返信", exact: true })).toHaveCount(0);
      await clickNative(frame.getByRole("textbox", { name: "メッセージを入力", exact: true }));
      await page.keyboard.insertText("送信後の新しい下書き");
      await page.waitForFunction(() =>
        window.actions.some(
          (item) => item.action === "draft" && item.value === "送信後の新しい下書き",
        ),
      );
      await openSettings(frame, mode);
      await page.waitForFunction(() => window.actions.some((item) => item.action === "settings"));
      await page.evaluate(() => window.sendPatch({ view: "settings" }));
      await page.waitForTimeout(250);
      await clickNative(frame.getByRole("button", { name: "ダーク", exact: true }));
      await page.waitForFunction(() =>
        window.actions.some((item) => item.action === "appearance" && item.value === "dark"),
      );
      await page.evaluate(() => window.sendPatch({ view: "chat" }));
    } else {
      await clickNative(frame.getByRole("button", { name: /グループを作成/ }));
      await page.waitForFunction(() =>
        window.actions.some((item) => item.action === "create-group"),
      );
      await clickNative(frame.getByRole("textbox", { name: "トークを検索", exact: true }));
      await page.keyboard.insertText("確認");
      await page.waitForFunction(() =>
        window.actions.some((item) => item.action === "search" && item.value === "確認"),
      );
    }
    await page.evaluate(() => {
      window.actions = [];
    });
    state.dark = true;
    await page.evaluate((state) => window.sendSnapshot(state), state);
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(artifacts, `${mode}${chatMode ? "-chat" : ""}-dark.png`) });
    state.dark = false;
    if (chatMode && process.argv.includes("--profile")) {
      await page.evaluate((state) => window.sendSnapshot(state), state);
      for (const width of [280, 768, 1280, 1920]) {
        await page.setViewportSize({ width, height: 900 });
        if (mode === "apple") {
          const expectedCenter =
            width < 760 ? width / 2 : (Math.max(280, Math.min(384, width * 0.28)) + width) / 2;
          await expect
            .poll(async () => {
              const bounds = await frame
                .getByRole("button", { name: /高橋 美咲の情報/ })
                .boundingBox();
              return bounds
                ? Math.abs(bounds.x + bounds.width / 2 - expectedCenter)
                : Number.POSITIVE_INFINITY;
            })
            .toBeLessThan(10);
        } else
          await expect
            .poll(
              async () =>
                (
                  await frame
                    .getByRole("button", { name: "設定", exact: true })
                    .last()
                    .boundingBox()
                )?.x ?? 0,
            )
            .toBeGreaterThan(width - 100);
        const bounds = await frame.locator("canvas").first().boundingBox();
        assert.ok(
          bounds && Math.abs(bounds.width - width) < 1,
          "canvas must resize to the viewport",
        );
        await page.screenshot({ path: join(artifacts, `${mode}-${width}-dpr2.png`) });
      }
      await clickNative(frame.getByRole("textbox", { name: "メッセージを入力", exact: true }));
      const probe = frame.evaluate(
        () =>
          new Promise((resolve) => {
            const intervals = [];
            const longTasks = [];
            const observer = new PerformanceObserver((list) =>
              longTasks.push(...list.getEntries().map((entry) => entry.duration)),
            );
            observer.observe({ type: "longtask" });
            let previous;
            function tick(time) {
              if (previous !== undefined) intervals.push(time - previous);
              previous = time;
              if (intervals.length < 90) requestAnimationFrame(tick);
              else {
                observer.disconnect();
                resolve({ intervals, longTasks });
              }
            }
            requestAnimationFrame(tick);
          }),
      );
      await page.mouse.move(1500, 400);
      for (let index = 0; index < 15; index++) {
        await page.mouse.wheel(0, -350);
        if (index === 7) await page.keyboard.insertText("スクロール中の入力");
        await page.waitForTimeout(25);
      }
      const timing = await probe;
      timing.intervals.sort((a, b) => a - b);
      console.log(
        `${mode} DPR2 1920px scroll+typing: median=${timing.intervals[45].toFixed(1)}ms p95=${timing.intervals[85].toFixed(1)}ms longTasks=${timing.longTasks.length}`,
      );
      await page.setViewportSize({ width: 390, height: 844 });
    }
    if (chatMode && process.argv.includes("--extended")) {
      const mediaMessages = [
        {
          ...state.messages.at(-2),
          id: "native-photo",
          kind: "image",
          text: "",
          mediaUrl: sampleSvg,
          fileName: "SVG photo",
        },
        {
          ...state.messages.at(-1),
          id: "native-sticker",
          kind: "sticker",
          text: "SVG sticker",
          mediaUrl: sampleSvg,
        },
        {
          ...state.messages.at(-1),
          id: "native-animated-sticker",
          kind: "sticker",
          text: "animated sticker",
          mediaUrl: sampleSvg,
          stickerAnimated: true,
        },
      ];
      const composer = {
        ...state.composer,
        pending: [{ id: "pending-image", name: "添付画像.svg", kind: "image", url: sampleSvg }],
      };
      await page.evaluate(
        ({ messages, composer }) => window.sendPatch({ messages, composer, dark: false }),
        { messages: mediaMessages, composer },
      );
      await page.waitForTimeout(800);
      assert.ok(
        await frame
          .locator("img")
          .evaluateAll((images) => images.some((image) => image.naturalWidth > 0)),
        "Kotlin-owned animated sticker must decode SVG",
      );
      assert.equal(
        await frame.locator('img[alt="SVG sticker"]').count(),
        0,
        "static stickers must render in Skia for glass sampling",
      );
      await page.screenshot({ path: join(artifacts, `${mode}-media.png`) });
      const readerMessage = {
        ...state.messages.at(-1),
        id: "readers-probe",
        text: "絵文字も確認 😀 👍 ❤️ 🎉",
        readCount: 2,
        readers: [
          { id: "reader-1", name: "青木", readAt: 1788706800000 },
          { id: "reader-2", name: "佐藤" },
        ],
      };
      await page.evaluate(
        ({ chat, message }) =>
          window.sendPatch({
            chat: { ...chat, isGroup: true },
            messages: [message],
            composer: { text: "", available: true },
          }),
        { chat: state.chat, message: readerMessage },
      );
      await clickNative(frame.getByRole("button", { name: "既読者一覧 2人", exact: true }));
      await page.waitForFunction(() =>
        window.actions.some((item) => item.action === "readers" && item.id === "readers-probe"),
      );
      await page.evaluate(() =>
        window.sendPatch({ readersPanel: { messageId: "readers-probe", loading: false } }),
      );
      await expect(frame.getByRole("button", { name: /青木.*プロフィールを開く/ })).toBeAttached();
      await page.screenshot({ path: join(artifacts, `${mode}-readers.png`) });
      await page.keyboard.press("Tab");
      await page.keyboard.press("Enter");
      await page.waitForFunction(() =>
        window.actions.some((item) => item.action === "reader-profile" && item.id === "reader-1"),
      );
      await page.keyboard.press("Escape");
      await page.waitForFunction(() =>
        window.actions.some((item) => item.action === "close-readers"),
      );
      await page.evaluate(
        ({ messages, composer, chat }) =>
          window.sendPatch({ messages, composer, chat, readersPanel: null }),
        { messages: mediaMessages, composer, chat: state.chat },
      );
      await clickNative(frame.getByRole("button", { name: /添付画像.svgを削除/ }));
      await page.waitForFunction(() =>
        window.actions.some(
          (item) => item.action === "remove-attachment" && item.id === "pending-image",
        ),
      );
      await page.evaluate(
        (composer) =>
          window.sendPatch({
            composer: {
              ...composer,
              text: "@",
              pending: [],
              mentionOptions: [
                { all: true, name: "全員" },
                { mid: "member-1", name: "高橋 美咲" },
              ],
              mentionIndex: 0,
            },
          }),
        composer,
      );
      await page.waitForTimeout(200);
      await clickNative(frame.getByRole("textbox", { name: "メッセージを入力", exact: true }));
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await page.waitForFunction(() =>
        window.actions.some((item) => item.action === "mention" && item.id === "1"),
      );
      await page.evaluate(() => window.sendPatch({ chat: null, messages: [] }));
      await frame
        .getByRole("list", { name: "メッセージ履歴" })
        .waitFor({ state: "detached", timeout: 5000 });
      await page.screenshot({ path: join(artifacts, `${mode}-after-back.png`) });
      assert.equal(
        await frame.getByRole("list", { name: "メッセージ履歴" }).count(),
        0,
        "a null chat patch must clear the native conversation",
      );
      console.log(
        `${mode}: SVG/sticker, pending removal, native mention keyboard selection and null-chat patch passed`,
      );
    }
    console.log(
      `${mode}: native ${chatMode ? "multiline draft/send/settings" : "create-group/search"}, Japanese semantics and 1200-row virtualization passed`,
    );
  }
  assert.deepEqual(errors, [], "native controls must render without runtime exceptions");
  console.log(`Browser screenshots: ${artifacts}`);
} finally {
  await browser.close();
  server.close();
}
