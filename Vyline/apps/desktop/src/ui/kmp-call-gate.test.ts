import { describe, expect, test } from "bun:test";
import { createKmpCallGate, type KmpCallGateState } from "./kmp-call-gate";

const direct = `u${"1".repeat(32)}`;
const group = `c${"2".repeat(32)}`;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture(chatId = direct, hooks: {
  onSubscribe?: () => void;
  onAbort?: () => void;
  onConfirm?: () => void;
} = {}) {
  let state: KmpCallGateState = {
    accountId: "synthetic-account", activeChatId: chatId, screen: "chat",
    chatPaneIds: [chatId], focusedChatPane: 0,
    chats: [{ id: chatId }], lockedChatMids: [], blockedMids: [], callRequest: null,
  };
  let epoch = 1;
  const listeners = new Set<() => void>();
  const dialogs: Array<ReturnType<typeof deferred<boolean>> & {
    text: string; options: unknown; signal?: AbortSignal; cancelled: boolean;
  }> = [];
  const calls: Array<{ to: string; kind: "voice" | "video" }> = [];
  const gate = createKmpCallGate({
    getState: () => state,
    getEpoch: () => epoch,
    subscribe: (listener) => {
      listeners.add(listener);
      hooks.onSubscribe?.();
      return () => { listeners.delete(listener); };
    },
    confirm: (text, options, signal?: AbortSignal) => {
      const result = deferred<boolean>();
      const dialog = { ...result, text, options, signal, cancelled: false };
      const abort = () => {
        dialog.cancelled = true;
        result.resolve(false);
        hooks.onAbort?.();
      };
      dialogs.push(dialog);
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort);
      hooks.onConfirm?.();
      return result.promise.finally(() => signal?.removeEventListener("abort", abort));
    },
    requestCall: (to, kind) => { calls.push({ to, kind }); },
  });
  return {
    gate, dialogs, calls, listeners,
    patch: (patch: Partial<KmpCallGateState>) => {
      state = { ...state, ...patch };
      for (const listener of listeners) listener();
    },
    nextEpoch: () => { epoch++; },
  };
}

describe("Compose host call confirmation gate (no store, device, or API)", () => {
  for (const [chatId, kind, label, suffix, acceptLabel] of [
    [direct, "voice", "音声通話", " に音声通話を発信しますか？", "発信する"],
    [direct, "video", "ビデオ通話", " にビデオ通話を発信しますか？", "発信する"],
    [group, "voice", "音声通話", " の音声通話に参加しますか？通話がない場合は開始します。", "参加 / 開始する"],
    [group, "video", "ビデオ通話", " のビデオ通話に参加しますか？通話がない場合は開始します。", "参加 / 開始する"],
  ] as const) {
    test(`${chatId[0]} ${kind}: asks before dispatch with explicit, cancel-first wording`, async () => {
      const f = fixture(chatId);
      const result = f.gate.request(chatId, kind, "表示名");
      expect(f.calls).toEqual([]);
      expect(f.dialogs[0]?.text).toBe(`表示名${suffix}`);
      expect(f.dialogs[0]?.options).toEqual({ title: `${label}の確認`, acceptLabel, cancelFirst: true });
      f.dialogs[0]!.resolve(true);
      expect(await result).toBe(true);
      expect(f.calls).toEqual([{ to: chatId, kind }]);
      expect(f.listeners.size).toBe(0);
      f.dialogs[0]!.resolve(true);
      expect(f.calls).toHaveLength(1);
    });
  }

  test("cancel / Escape / backdrop dismissal never dispatches and permits a fresh request", async () => {
    const f = fixture();
    const result = f.gate.request(direct, "voice", "Name");
    f.dialogs[0]!.resolve(false);
    expect(await result).toBe(false);
    expect(f.calls).toEqual([]);
    const retry = f.gate.request(direct, "voice", "Name");
    f.dialogs[1]!.resolve(true);
    expect(await retry).toBe(true);
  });

  test("double click shares one pending dialog, not two call requests", async () => {
    const f = fixture();
    const first = f.gate.request(direct, "voice", "Name");
    expect(await f.gate.request(direct, "voice", "Name")).toBe(false);
    expect(f.dialogs).toHaveLength(1);
    f.dialogs[0]!.resolve(true);
    await first;
    expect(f.calls).toHaveLength(1);
  });

  test("superseded voice acceptance cannot call or clear the newer video request", async () => {
    const f = fixture();
    const first = f.gate.request(direct, "voice", "Name");
    const second = f.gate.request(direct, "video", "Name");
    expect(f.dialogs[0]!.cancelled).toBe(true);
    expect(f.dialogs[0]!.signal?.aborted).toBe(true);
    expect(f.dialogs[1]!.signal?.aborted).toBe(false);
    expect(await first).toBe(false);
    expect(f.listeners.size).toBe(1);
    expect(f.calls).toEqual([]);
    f.dialogs[1]!.resolve(true);
    expect(await second).toBe(true);
    expect(f.calls).toEqual([{ to: direct, kind: "video" }]);
  });

  for (const [label, patch] of [
    ["accountless demo", { accountId: null }],
    ["not selected", { activeChatId: group }],
    ["closed scope", { chatPaneIds: [], activeChatId: null }],
    ["replaced pane", { chatPaneIds: [group], chats: [{ id: direct }, { id: group }] }],
    ["wrong focused pane", { chatPaneIds: [direct, group], chats: [{ id: direct }, { id: group }], focusedChatPane: 1 }],
    ["non-chat screen", { screen: "settings" }],
    ["locked", { lockedChatMids: [direct] }],
    ["blocked", { blockedMids: [direct] }],
    ["removed chat", { chats: [] }],
    ["already queued call", { callRequest: { to: direct, kind: "voice" } }],
  ] satisfies Array<[string, Partial<KmpCallGateState>]>) {
    test(`rejects ${label} before opening confirmation`, async () => {
      const f = fixture();
      f.patch(patch);
      expect(await f.gate.request(direct, "voice", "Name")).toBe(false);
      expect(f.dialogs).toHaveLength(0);
      expect(f.calls).toHaveLength(0);
    });
    test(`${label} while awaiting confirmation invalidates acceptance`, async () => {
      const f = fixture();
      const result = f.gate.request(direct, "voice", "Name");
      f.patch(patch);
      expect(f.dialogs[0]!.cancelled).toBe(true);
      expect(f.dialogs[0]!.signal?.aborted).toBe(true);
      expect(await result).toBe(false);
      expect(f.calls).toHaveLength(0);
      expect(f.listeners.size).toBe(0);
    });
  }

  for (const chatId of ["r-unsupported", "c-invalid", "", "demo-group"]) {
    test(`canStartCall disallows ${chatId || "empty ID"}`, async () => {
      const f = fixture(chatId);
      expect(await f.gate.request(chatId, "voice", "Name")).toBe(false);
      expect(f.dialogs).toHaveLength(0);
      expect(f.calls).toHaveLength(0);
    });
  }

  for (const [label, away, back] of [
    ["account", { accountId: "other-account" }, { accountId: "synthetic-account" }],
    ["selected chat", { activeChatId: group }, { activeChatId: direct }],
    ["focused pane", { focusedChatPane: 1 }, { focusedChatPane: 0 }],
    ["pane closure", { chatPaneIds: [] }, { chatPaneIds: [direct] }],
    ["screen", { screen: "settings" }, { screen: "chat" }],
    ["block", { blockedMids: [direct] }, { blockedMids: [] }],
    ["lock", { lockedChatMids: [direct] }, { lockedChatMids: [] }],
  ] satisfies Array<[string, Partial<KmpCallGateState>, Partial<KmpCallGateState>]>) {
    test(`${label} away/back within one render never revives old consent`, async () => {
      const f = fixture();
      const result = f.gate.request(direct, "voice", "Name");
      f.patch(away); f.patch(back);
      expect(f.dialogs[0]!.cancelled).toBe(true);
      expect(f.dialogs[0]!.signal?.aborted).toBe(true);
      expect(await result).toBe(false);
      expect(f.calls).toHaveLength(0);
    });
  }

  test("switch-away/back permits fresh consent without letting the retired request dispatch", async () => {
    const f = fixture();
    const old = f.gate.request(direct, "voice", "Name");
    f.patch({ accountId: "other-account" });
    f.patch({ accountId: "synthetic-account" });
    const current = f.gate.request(direct, "voice", "Name");
    expect(f.dialogs[0]!.cancelled).toBe(true);
    expect(f.dialogs[1]!.signal?.aborted).toBe(false);
    expect(await old).toBe(false);
    expect(f.calls).toHaveLength(0);
    expect(f.listeners.size).toBe(1);
    f.dialogs[1]!.resolve(true);
    expect(await current).toBe(true);
    expect(f.calls).toEqual([{ to: direct, kind: "voice" }]);
  });

  test("another controller request queued and consumed while confirming retires old consent", async () => {
    const f = fixture();
    const result = f.gate.request(direct, "voice", "Name");
    f.patch({ callRequest: { to: group, kind: "video" } });
    f.patch({ callRequest: null });
    expect(f.dialogs[0]!.cancelled).toBe(true);
    expect(await result).toBe(false);
    expect(f.calls).toHaveLength(0);
  });

  test("revalidates captured account epoch even without a store notification", async () => {
    const f = fixture();
    const result = f.gate.request(direct, "voice", "Name");
    f.nextEpoch();
    f.dialogs[0]!.resolve(true);
    expect(await result).toBe(false);
    expect(f.calls).toHaveLength(0);
  });

  test("unmount/retry disposal rejects pending and future requests and unsubscribes", async () => {
    const f = fixture();
    const result = f.gate.request(direct, "voice", "Name");
    f.gate.dispose();
    expect(f.listeners.size).toBe(0);
    expect(f.dialogs[0]!.cancelled).toBe(true);
    expect(f.dialogs[0]!.signal?.aborted).toBe(true);
    expect(await result).toBe(false);
    expect(await f.gate.request(direct, "video", "Name")).toBe(false);
    expect(f.calls).toHaveLength(0);
  });

  test("confirmation rejection fails closed and does not leave a pending latch", async () => {
    const f = fixture();
    const result = f.gate.request(direct, "voice", "Name");
    f.dialogs[0]!.reject(new Error("dialog unavailable"));
    expect(await result).toBe(false);
    expect(f.listeners.size).toBe(0);
    expect(f.calls).toHaveLength(0);
    const next = f.gate.request(direct, "video", "Name");
    f.dialogs[1]!.resolve(true);
    expect(await next).toBe(true);
  });

  for (const chatPaneIds of [[], ["removed-pane"]]) {
    test(`host active-chat fallback accepts consent with panes ${JSON.stringify(chatPaneIds)}`, async () => {
      const f = fixture();
      f.patch({ chatPaneIds });
      const result = f.gate.request(direct, "voice", "Name");
      expect(f.dialogs).toHaveLength(1);
      f.patch({ chatPaneIds: [...chatPaneIds] });
      expect(f.dialogs[0]!.cancelled).toBe(false);
      f.dialogs[0]!.resolve(true);
      expect(await result).toBe(true);
      expect(f.calls).toEqual([{ to: direct, kind: "voice" }]);
    });
  }

  test("host focus fallback accepts an out-of-range stored focus index", async () => {
    const f = fixture();
    f.patch({ focusedChatPane: 3 });
    const result = f.gate.request(direct, "voice", "Name");
    expect(f.dialogs).toHaveLength(1);
    f.dialogs[0]!.resolve(true);
    expect(await result).toBe(true);
  });

  test("a selected chat beyond the host's four rendered panes is ineligible", async () => {
    const f = fixture();
    const ids = ["other-1", "other-2", "other-3", "other-4", direct];
    f.patch({ chatPaneIds: ids, focusedChatPane: 4, chats: ids.map(id => ({ id })) });
    expect(await f.gate.request(direct, "voice", "Name")).toBe(false);
    expect(f.dialogs).toHaveLength(0);
  });

  for (const [origin, next] of [[[direct], []], [[], [direct]]] as string[][][]) {
    test(`pane representation ${JSON.stringify(origin)} -> ${JSON.stringify(next)} retires original consent`, async () => {
      const f = fixture();
      f.patch({ chatPaneIds: origin });
      const result = f.gate.request(direct, "voice", "Name");
      expect(f.dialogs).toHaveLength(1);
      f.patch({ chatPaneIds: next });
      expect(f.dialogs[0]!.cancelled).toBe(true);
      expect(f.listeners.size).toBe(0);
      expect(await result).toBe(false);
      const fresh = f.gate.request(direct, "voice", "Name");
      f.dialogs[1]!.resolve(true);
      expect(await fresh).toBe(true);
    });
  }

  test("fallback scope closure aborts rather than waiting for a response", async () => {
    const f = fixture();
    f.patch({ chatPaneIds: [] });
    const result = f.gate.request(direct, "voice", "Name");
    expect(f.dialogs).toHaveLength(1);
    f.patch({ activeChatId: null });
    expect(f.dialogs[0]!.cancelled).toBe(true);
    expect(await result).toBe(false);
    expect(f.calls).toHaveLength(0);
  });

  test("synchronous subscribe invalidation cleans up the returned subscription without opening a dialog", async () => {
    const f = fixture(direct, { onSubscribe: () => f.patch({ screen: "settings" }) });
    expect(await f.gate.request(direct, "voice", "Name")).toBe(false);
    expect(f.dialogs).toHaveLength(0);
    expect(f.listeners.size).toBe(0);
  });

  test("synchronous dialog publication can invalidate and settle its own confirmation", async () => {
    const f = fixture(direct, { onConfirm: () => f.patch({ screen: "settings" }) });
    const result = f.gate.request(direct, "voice", "Name");
    expect(f.dialogs[0]!.cancelled).toBe(true);
    expect(f.listeners.size).toBe(0);
    expect(await result).toBe(false);
    expect(f.calls).toHaveLength(0);
  });

  test("abort notification reentrancy cannot overwrite a newer request", async () => {
    let newest: Promise<boolean> | undefined;
    const f = fixture(direct, { onAbort: () => {
      if (!newest) newest = f.gate.request(direct, "voice", "Newest");
    } });
    const first = f.gate.request(direct, "voice", "First");
    const middle = f.gate.request(direct, "video", "Middle");
    expect(f.dialogs[0]!.cancelled).toBe(true);
    expect(await first).toBe(false);
    expect(await middle).toBe(false);
    expect(f.dialogs).toHaveLength(2);
    expect(f.dialogs[1]!.text).toStartWith("Newest");
    expect(f.dialogs[1]!.signal?.aborted).toBe(false);
    expect(f.listeners.size).toBe(1);
    f.dialogs[1]!.resolve(true);
    expect(await newest).toBe(true);
    expect(f.calls).toEqual([{ to: direct, kind: "voice" }]);
  });

  test("disposal during supersession cannot open the replacement confirmation", async () => {
    const f = fixture(direct, { onAbort: () => f.gate.dispose() });
    const first = f.gate.request(direct, "voice", "First");
    expect(await f.gate.request(direct, "video", "Next")).toBe(false);
    expect(f.dialogs).toHaveLength(1);
    expect(f.dialogs[0]!.cancelled).toBe(true);
    expect(await first).toBe(false);
    expect(f.listeners.size).toBe(0);
  });

  test("unrelated updates and equivalent pane arrays preserve a valid request", async () => {
    const f = fixture();
    const result = f.gate.request(direct, "voice", "Name");
    f.patch({ chatPaneIds: [direct], chats: [{ id: direct }], blockedMids: [group] });
    f.dialogs[0]!.resolve(true);
    expect(await result).toBe(true);
    expect(f.calls).toHaveLength(1);
  });
});
