import { expect, test } from "bun:test";
import { api } from "../api/client";
import { useStore } from "./store";

test("mute choice is captured for every send and survives retries and setting changes", async () => {
  const before = useStore.getState();
  const previousFetch = globalThis.fetch;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const requests: Array<{ url: string; body: Record<string, unknown>; headers: Headers }> = [];
  globalThis.fetch = (async (url, init) => {
    requests.push({
      url: String(url),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : {},
      headers: new Headers(init?.headers),
    });
    // Leave retryable sends failed without scheduling a real history refresh.
    return Response.json({ ok: false, error: "synthetic send failure" });
  }) as typeof fetch;
  Object.defineProperty(globalThis, "window", { configurable: true, value: { alert() {} } });
  const chatId = `u${"1".repeat(32)}`;
  type Options = { mute?: boolean } | undefined;
  const variants = [
    {
      endpoint: "send",
      run: (opts: Options) => useStore.getState().sendMessage(chatId, "fixture", opts),
      retry: true,
    },
    {
      endpoint: "send-sticker",
      run: (opts: Options) =>
        useStore.getState().sendSticker(chatId, "pack", "sticker", false, opts),
      retry: true,
    },
    {
      endpoint: "send-combination-sticker",
      run: (opts: Options) =>
        useStore
          .getState()
          .sendCombinationSticker(chatId, [{ packageId: "pack", stickerId: "sticker" }], opts),
      retry: true,
    },
    {
      endpoint: "send-emoji",
      run: (opts: Options) => useStore.getState().sendLineEmoji(chatId, "pack", "emoji", opts),
      retry: true,
    },
    {
      endpoint: "send-media",
      run: (opts: Options) =>
        useStore
          .getState()
          .sendImageFile(chatId, new File(["image"], "fixture.png", { type: "image/png" }), opts),
      retry: false,
    },
    {
      endpoint: "send-media",
      run: (opts: Options) =>
        useStore.getState().sendAudio(chatId, 1, new Blob(["audio"], { type: "audio/webm" }), opts),
      retry: false,
    },
  ];
  try {
    useStore.setState({
      accountId: "mute-fixture",
      demoMode: false,
      blockedMids: [],
      chats: [],
      messages: [],
      replyToId: null,
    });
    for (const choice of [
      { always: false, opts: { mute: true }, expected: true },
      { always: true, opts: { mute: false }, expected: false },
      { always: true, opts: undefined, expected: true },
      { always: false, opts: undefined, expected: false },
    ]) {
      for (const variant of variants) {
        requests.length = 0;
        useStore.setState({
          messages: [],
          settings: {
            ...before.settings,
            highQualityImages: true,
            alwaysMuteMessages: choice.always,
          },
        });
        await variant.run(choice.opts);
        // Store sends detach their API continuations; flush the mocked fetch/JSON microtasks.
        for (let i = 0; i < 12; i++) await Promise.resolve();
        expect(requests).toHaveLength(1);
        expect(requests[0]!.url).toBe(`/api/line/mute-fixture/${variant.endpoint}`);
        if (variant.endpoint === "send-media") {
          expect(requests[0]!.headers.get("X-Vyline-Media-Mute")).toBe(
            choice.expected ? "true" : null,
          );
        } else {
          expect(requests[0]!.body.mute).toBe(choice.expected);
        }
        if (variant.retry) {
          const failed = useStore.getState().messages[0]!;
          expect(failed.status).toBe("failed");
          expect(failed.retry?.mute).toBe(choice.expected);
          useStore.setState({
            settings: { ...useStore.getState().settings, alwaysMuteMessages: !choice.expected },
          });
          await useStore.getState().retryMessage(failed.id);
          expect(requests).toHaveLength(2);
          expect(requests[1]!.body.mute).toBe(choice.expected);
        }
      }
    }
    for (const mute of [true, false]) {
      requests.length = 0;
      await api.line.sendMediaBatch("mute-fixture", chatId, [{ body: new Blob(["image"]) }], 1, {
        mute,
      });
      expect(requests).toHaveLength(1);
      expect(requests[0]!.url).toBe("/api/line/mute-fixture/send-media-batch/start");
      expect(requests[0]!.body).toEqual({ chatMid: chatId, itemCount: 1, mute });
    }
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    useStore.setState(before, true);
  }
});
