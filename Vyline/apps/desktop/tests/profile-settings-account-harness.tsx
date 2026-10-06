// Real shared settings component; every account and API result is synthetic.
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { SettingsSections } from "../src/components/settings-sections";
import { api } from "../src/api/client";
import { useStore } from "../src/lib/store";
import { useDesignSystemStore } from "../src/ui/design-system-store";

globalThis.fetch = async () => { throw Error("Unexpected network request"); };
useDesignSystemStore.setState({ mode: "legacy" });
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const until = async (ready: () => boolean) => {
  for (let index = 0; index < 120; index++) { if (ready()) return; await frame(); }
  throw Error("settings did not commit expected state");
};
const assert = (ok: unknown, text: string) => { if (!ok) throw Error(text); };
const field = (name: string) => document.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`);
const self = (name: string) => ({ name, status: `${name} status`, mid: `${name}-mid`, avatar: name,
  avatarUrl: `/${name}-avatar.png`, backgroundUrl: `/${name}-cover.png` });
const host = document.body.appendChild(document.createElement("div"));
let root = createRoot(host);
const mount = () => root.render(createElement(MemoryRouter, null, createElement(SettingsSections, { initialSection: "profile" })));
const save = () => [...host.querySelectorAll("button")].find(button => button.textContent === "LINE に保存")!.click();

async function run() {
  useStore.setState({ accountId: "fixture-A", demoMode: false, self: self("Alice") });
  mount(); await until(() => field("表示名")?.value === "Alice");
  useStore.setState({ accountId: "fixture-B", self: self("Bob") });
  await frame(); await frame();
  assert(field("表示名")?.value === "Bob", "account B retained account A's name draft");
  assert(field("ステータスメッセージ")?.value === "Bob status", "account B retained A's status draft");
  let sent: { account: string; name?: string } | null = null;
  api.line.updateProfile = async (account, body) => {
    sent = { account, name: body.displayName };
    return { ok: true, profile: { mid: "Bob-mid", displayName: "Bob", statusMessage: "Bob status" } } as never;
  };
  save(); await until(() => !!sent);
  assert(sent?.account === "fixture-B" && sent.name === "Bob", "the previous account's draft was sent as B");
  root.unmount(); root = createRoot(host);

  useStore.setState({ accountId: "fixture-hydrate", self: { ...self("Pending"), mid: "" } });
  mount(); await until(() => field("表示名")?.value === "Pending");
  const pendingName = field("表示名")!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(pendingName, "Hydration draft");
  pendingName.dispatchEvent(new Event("input", { bubbles: true }));
  await frame();
  useStore.setState({ self: self("Alice") }); await frame(); await frame();
  assert(field("表示名")?.value === "Hydration draft", "initial MID hydration discarded an edited draft");
  api.line.updateProfile = async () => ({ ok: true, profile: { mid: "", displayName: "Hydration draft" } }) as never;
  save(); await until(() => [...host.querySelectorAll("button")].some(button => button.textContent === "LINE に保存" && !button.disabled));
  assert(useStore.getState().self.mid === "Alice-mid", "empty profile response discarded the known LINE identity");
  root.unmount(); root = createRoot(host);

  useStore.setState({ accountId: "fixture-same", self: self("Alice") });
  mount(); await until(() => field("表示名")?.value === "Alice");
  const name = field("表示名")!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "Alice draft");
  name.dispatchEvent(new Event("input", { bubbles: true }));
  await frame();
  useStore.setState({ self: { ...self("Pending"), mid: "" } }); await frame(); await frame();
  useStore.setState({ self: self("Bob") });
  await frame(); await frame();
  assert(field("表示名")?.value === "Bob", "same-alias identity change retained the previous identity's draft");
  root.unmount(); root = createRoot(host);

  for (const operation of ["name", "avatar", "background"] as const) for (const transition of ["away", "round-trip", "same-alias"] as const) {
    const roundTrip = transition === "round-trip";
    const response = Promise.withResolvers<any>();
    let started = false;
    api.line.updateProfile = async () => { started = true; return response.promise; };
    api.line.updateProfileImage = async () => { started = true; return response.promise; };
    api.line.updateProfileBackground = async () => { started = true; return response.promise; };
    useStore.setState({ accountId: "fixture-A", self: self("Alice") });
    mount(); await until(() => field("表示名")?.value === "Alice");
    if (operation === "name") save();
    else {
      const files = new DataTransfer(); files.items.add(new File(["fixture"], "profile.png", { type: "image/png" }));
      const input = host.querySelectorAll<HTMLInputElement>('input[type="file"]')[operation === "avatar" ? 1 : 0];
      input.files = files.files; input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    await until(() => started);
    useStore.setState({ accountId: transition === "same-alias" ? "fixture-A" : "fixture-B", self: self("Bob") });
    await frame(); await frame();
    if (roundTrip) { useStore.setState({ accountId: "fixture-A", self: self("FreshA") }); await frame(); await frame(); }
    const before = JSON.stringify(useStore.getState().self);
    if (!roundTrip) root.unmount();
    response.resolve({ ok: true, profile: { mid: "Alice-mid", displayName: "Alice", thumbnailUrl: "/Alice-new-avatar.png" },
      backgroundUrl: "/Alice-new-cover.png" });
    await frame(); await frame();
    assert(JSON.stringify(useStore.getState().self) === before, `retired ${operation} completion mutated the active account`);
    if (roundTrip) root.unmount();
    root = createRoot(host);
  }
  root.unmount(); host.remove();
  return "PASS: profile drafts and name/avatar/background responses stay account-scoped";
}
const button = document.createElement("button"); button.textContent = "プロフィール設定の分離を検証";
const output = document.createElement("pre"); document.body.prepend(button, output);
button.onclick = () => { button.disabled = true; void run().then(text => { output.textContent = text; })
  .catch(error => { output.textContent = `FAIL: ${error.message}`; }); };
