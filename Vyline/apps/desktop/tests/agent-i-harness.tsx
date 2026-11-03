// Isolated browser fixture: all accounts, credentials and API replies are synthetic.
import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { AgentIBetaPanel } from "../src/components/agent-i-beta-panel";
import { useStore } from "../src/lib/store";
import { NativeControllerSurface } from "../src/ui/native-controller-surface";
import {
  invokeNativePanel,
  useNativePanelSnapshot,
  type NativePanelItem,
} from "../src/ui/native-panel";

type Dialogue = { role: "user" | "assistant"; text: string }[];
const sessions = new Map<
  string,
  { yahooCookieConfigured: boolean; expiresAt: number | null; history: Dialogue }
>();
const requests: {
  account: string;
  method: string;
  path: string;
  prompt?: string;
  history?: Dialogue;
  authMode?: string;
}[] = [];
let deferChat = false;
let finishChat: (() => void) | undefined;
let credentialTtl = 30 * 60_000;
let rejectCredentials = false;
let deferCredentials = false;
let finishCredentials: (() => void) | undefined;
let rejectChat = false;
const empty = () => ({ yahooCookieConfigured: false, expiresAt: null, history: [] as Dialogue });
globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
  const match = String(url).match(
    /^\/api\/beta\/agent-i\/([^/]+)\/(credentials|session|history|chat)$/,
  );
  if (!match) throw Error("Unexpected network request");
  const [, rawAccount, path] = match;
  const account = decodeURIComponent(rawAccount!);
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  requests.push({ account, method, path: path!, ...(path === "chat" ? body : {}) });
  const session = sessions.get(account) ?? empty();
  sessions.set(account, session);
  if (method === "DELETE") {
    sessions.delete(account);
    return Response.json({ ok: true });
  }
  if (path === "credentials") {
    if (method === "PUT") {
      if (deferCredentials) {
        deferCredentials = false;
        await new Promise<void>((resolve) => {
          finishCredentials = resolve;
        });
      }
      if (rejectCredentials) return Response.json({ ok: false }, { status: 400 });
      session.yahooCookieConfigured = true;
      session.expiresAt = Date.now() + credentialTtl;
      session.history = [];
    }
    return Response.json({
      ok: true,
      yahooCookieConfigured: session.yahooCookieConfigured,
      expiresAt: session.expiresAt,
    });
  }
  if (path === "history") return Response.json({ ok: true, history: session.history });
  if (rejectChat) {
    sessions.delete(account);
    return Response.json({ ok: false }, { status: 401 });
  }
  if (deferChat) {
    deferChat = false;
    await new Promise<void>((resolve) => {
      finishChat = resolve;
    });
  }
  const text = `fixture answer for ${account}`;
  session.history.push({ role: "user", text: body.prompt }, { role: "assistant", text });
  session.expiresAt ??= Date.now() + 30 * 60_000;
  return Response.json({
    ok: true,
    text,
    authMode:
      body.authMode === "authenticated" && session.yahooCookieConfigured
        ? "authenticated"
        : "anonymous",
  });
}) as unknown as typeof fetch;

useStore.setState({
  accountId: "fixture-a",
  demoMode: false,
  chats: [],
  messages: [],
  settings: { ...useStore.getState().settings, betaAgentI: true },
});
let controls: NativePanelItem[] = [];
let setNative!: (native: boolean) => void;
const flatten = (items: NativePanelItem[]): NativePanelItem[] =>
  items.flatMap((item) => [item, ...flatten(item.items ?? [])]);
function Harness() {
  const [native, updateNative] = useState(true);
  setNative = updateNative;
  const snapshot = useNativePanelSnapshot();
  controls = flatten(snapshot?.items ?? []);
  return (
    <NativeControllerSurface title="Agent I fixture" onClose={() => {}} native={native}>
      <AgentIBetaPanel />
    </NativeControllerSurface>
  );
}
const root = createRoot(document.body.appendChild(document.createElement("div")));
root.render(createElement(Harness));

export const fixture = {
  requests,
  controls: () => controls,
  change(label: string, value: string) {
    const control = controls.find((item) => item.label.startsWith(label));
    return !!control && invokeNativePanel("panel-change", control.id, value);
  },
  click(label: string) {
    const control = controls.find((item) => item.label === label);
    return !!control && invokeNativePanel("panel-action", control.id);
  },
  account: (accountId: string | null) => useStore.setState({ accountId }),
  enabled: (betaAgentI: boolean) =>
    useStore.setState({ settings: { ...useStore.getState().settings, betaAgentI } }),
  demo: () => useStore.setState({ demoMode: true }),
  visible: () => setNative(false),
  defer: () => {
    deferChat = true;
  },
  finish: () => finishChat?.(),
  deferRegistration: () => {
    deferCredentials = true;
  },
  finishRegistration: () => finishCredentials?.(),
  rejectAuth: () => {
    rejectChat = true;
  },
  ttl: (ms: number) => {
    credentialTtl = ms;
  },
  reject: () => {
    rejectCredentials = true;
  },
  configured: (account: string) => sessions.get(account)?.yahooCookieConfigured ?? false,
  unmount: () => root.unmount(),
};
declare global {
  interface Window {
    agentIFixture: typeof fixture;
  }
}
window.agentIFixture = fixture;
