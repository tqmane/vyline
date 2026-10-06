import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { usePublishNativePanel, useNativePanelSnapshot, invokeNativePanel } from "../src/ui/native-panel";
import { useStore } from "../src/lib/store";
globalThis.fetch = async () => { throw Error("Unexpected network request"); };
useStore.setState({ accountId: null, demoMode: true });
let snapshot: ReturnType<typeof useNativePanelSnapshot>;
let disable!: (value: boolean) => void;
let reset!: (value: string) => void;
const calls: string[] = [];
let selected: [number, number] | null = null;
function Probe() {
  const [value, setValue] = useState("");
  const [disabled, setDisabled] = useState(false);
  disable = setDisabled; reset = setValue;
  usePublishNativePanel({ accountId: null, title: "Offline input", onClose() {}, items: [
    { id: "field", kind: "input", label: "Fixture", value, disabled,
      onChange(next) { calls.push(next); if (next !== "reject") setValue(next.trim()); } },
    { id: "live-value", kind: "input", label: "Canonical getter", value: "", getValue: () => "abcdef",
      onSelection(start, end) { selected = [start, end]; } },
  ] });
  snapshot = useNativePanelSnapshot();
  return createElement("pre", null, JSON.stringify(snapshot));
}
const root = createRoot(document.body.appendChild(document.createElement("div")));
root.render(createElement(Probe));
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const until = async (ready: () => boolean) => { for (let i = 0; i < 120; i++) { if (ready()) return; await frame(); } throw Error("input acknowledgement not published"); };
const assert = (ok: unknown, text: string) => { if (!ok) throw Error(text); };
async function run() {
  await until(() => !!snapshot);
  const liveId = snapshot!.items[1].id;
  assert(invokeNativePanel("panel-selection", liveId, undefined, 2, 6), "selection validation used the stale projection instead of canonical value");
  assert(selected?.[0] === 2 && selected?.[1] === 6, "canonical selection was not applied");
  const id = snapshot!.items[0].id;
  invokeNativePanel("panel-change", id, " canonical ", undefined, undefined, 16, 16, undefined, 1);
  await until(() => snapshot!.items[0].ackSeq === 1);
  assert(snapshot!.items[0].value === "canonical", "normalization echo was not canonical");
  invokeNativePanel("panel-change", id, "reject", undefined, undefined, 16, 16, undefined, 2);
  await until(() => snapshot!.items[0].ackSeq === 2);
  assert(snapshot!.items[0].value === "canonical", "rejected input changed the host value");
  assert(!invokeNativePanel("panel-change", id, "duplicate", undefined, undefined, 16, 16, undefined, 2), "duplicate sequence dispatched");
  assert(!invokeNativePanel("panel-change", id, "old", undefined, undefined, 16, 16, undefined, 1), "older sequence dispatched");
  assert(calls.length === 2, "old input ran a setter");
  disable(true); await until(() => snapshot!.items[0].disabled === true);
  invokeNativePanel("panel-change", id, "blocked", undefined, undefined, 16, 16, undefined, 3);
  await until(() => snapshot!.items[0].ackSeq === 3);
  assert(snapshot!.items[0].value === "canonical" && calls.length === 2, "disabled input was accepted");
  reset(""); await until(() => snapshot!.items[0].value === "");
  assert(snapshot!.items[0].ackSeq === 3, "reset lost the acknowledged sequence");
  disable(false); await until(() => !snapshot!.items[0].disabled);
  const limit = "x".repeat(32000);
  assert(invokeNativePanel("panel-change", id, limit), "legacy maximum-length input rejected");
  await until(() => snapshot!.items[0].value === limit);
  assert(!invokeNativePanel("panel-change", id, `${limit}x`), "legacy oversized input accepted");
  assert(invokeNativePanel("panel-change", id, limit, undefined, undefined, 16, 16, undefined, 4), "sequenced maximum-length input rejected");
  await until(() => snapshot!.items[0].ackSeq === 4);
  const before = calls.length;
  assert(!invokeNativePanel("panel-change", id, `${limit}x`, undefined, undefined, 16, 16, undefined, 5), "sequenced oversized input accepted");
  await until(() => snapshot!.items[0].ackSeq === 5);
  assert(calls.length === before && snapshot!.items[0].value === limit, "rejected oversized input altered the canonical value");
  root.unmount();
  return "PASS: canonical, rejected, duplicate, disabled and reset input acknowledgements";
}
const button = document.createElement("button"); button.textContent = "入力受理を検証";
const output = document.createElement("pre"); document.body.prepend(button, output);
button.onclick = () => { button.disabled = true; void run().then(text => { output.textContent = text; })
  .catch(error => { output.textContent = `FAIL: ${error.message}`; }); };
