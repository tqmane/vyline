// Actual useLineData instance, synthetic accounts and responses only.
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { api } from "../src/api/client";
import { useLineData } from "../src/hooks/useLineData";
import { useStore } from "../src/lib/store";
import { emitAppEvent } from "../src/lib/appEvents";

globalThis.fetch = async () => { throw Error("Unexpected network request"); };
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const until = async (ready: () => boolean) => {
  for (let attempt = 0; attempt < 120; attempt++) { if (ready()) return; await frame(); }
  throw Error("hook did not reach the expected response boundary");
};
const assert = (ok: unknown, label: string) => { if (!ok) throw Error(label); };
async function scenario(source: "android" | "ios", roundTrip: boolean) {
  const suffix = `${source}-${roundTrip}-${crypto.randomUUID()}`;
  const a = `fixture-A-${suffix}`;
  const b = `fixture-B-${suffix}`;
  const originalGroup = `c${"1".repeat(32)}`;
  const freshGroup = `c${"2".repeat(32)}`;
  const restored = Promise.withResolvers<any>();
  const fresh = Promise.withResolvers<any>();
  let bootstrapA = 0;
  let initialChats = 0;
  let finalPhase = false;
  const calls: Array<{ account: string; chat: string }> = [];
  let line: ReturnType<typeof useLineData>;
  const message = (id: string, text: string) => ({ id, text, from: `u${"3".repeat(32)}`, to: freshGroup,
    contentType: "NONE", createdTime: Date.now(), isMyMessage: false });
  api.line.profile = async () => ({ ok: false, error: "offline fixture" });
  api.line.vylineCache = async () => ({ ok: true, profiles: {} });
  api.line.contactProfile = async () => ({ ok: false, error: "offline fixture" });
  api.line.chats = async account => {
    if (account === a && !finalPhase) { initialChats++; return { ok: true, chats: [] }; }
    return { ok: true, chats: [{ mid: freshGroup, name: "Fresh group", kind: "group", hasMessages: true }] };
  };
  api.line.bootstrap = async account => {
    if (account === a && ++bootstrapA === 2) return restored.promise;
    return { ok: true, chats: [], messagesByChat: {} };
  };
  api.line.messages = async (account, chat) => {
    calls.push({ account, chat });
    if (finalPhase && account === (roundTrip ? a : b) && chat === freshGroup) return fresh.promise;
    return { ok: true, hasMore: false, messages: [message("old", "Retired history")] };
  };
  useStore.setState({ accountId: a, demoMode: false, activeChatId: null, chats: [], messages: [],
    _activateChat: id => useStore.setState({ activeChatId: id }),
  });
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  function Probe({ account }: { account: string }) {
    line = useLineData({ accountId: account });
    return createElement("pre", null, JSON.stringify({ account: line.dataAccountId, ids: line.messages.map(value => value.id) }));
  }
  try {
    root.render(createElement(Probe, { account: a }));
    await until(() => initialChats > 0 && line?.dataAccountId === a);
    emitAppEvent("backup:restored", { accountId: a, chatMids: [originalGroup], source });
    await until(() => bootstrapA === 2 && calls.some(value => value.account === a));
    useStore.setState({ accountId: b, activeChatId: freshGroup, chats: [], messages: [] });
    finalPhase = !roundTrip;
    root.render(createElement(Probe, { account: b }));
    await until(() => line?.dataAccountId === b && calls.some(value => value.account === b));
    if (roundTrip) {
      finalPhase = true;
      useStore.setState({ accountId: a, activeChatId: freshGroup, chats: [], messages: [] });
      root.render(createElement(Probe, { account: a }));
      await until(() => line?.dataAccountId === a && calls.some(value => value.account === a && value.chat === freshGroup));
    }
    const before = calls.filter(value => value.account === a && value.chat === originalGroup).length;
    restored.resolve({ ok: true, chats: [], messagesByChat: {} });
    await frame(); await frame();
    fresh.resolve({ ok: true, hasMore: false, messages: [message("fresh", "Current account history")] });
    await until(() => !line.loadingMessages);
    await frame(); await frame();
    assert(line.dataAccountId === (roundTrip ? a : b), "history owner changed");
    assert(line.messages.length === 1 && line.messages[0].id === "fresh", "retired restore displaced the current history request");
    assert(calls.filter(value => value.account === a && value.chat === originalGroup).length === before,
      "retired restore started another old history request");
  } finally {
    restored.resolve({ ok: true, chats: [], messagesByChat: {} });
    fresh.resolve({ ok: true, hasMore: false, messages: [] });
    root.unmount(); host.remove();
  }
}
const button = document.createElement("button");
button.textContent = "復元のアカウント分離を検証";
const output = document.createElement("pre");
document.body.prepend(button, output);
button.onclick = () => {
  button.disabled = true;
  void (async () => {
    for (const source of ["android", "ios"] as const) for (const roundTrip of [false, true]) await scenario(source, roundTrip);
    output.textContent = "PASS: Android/iOS restore and account round trips preserve current history";
  })().catch(error => { output.textContent = `FAIL: ${error.message}`; });
};
