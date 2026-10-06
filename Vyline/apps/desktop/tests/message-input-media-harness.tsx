// Loopback-only regression: no LINE account, network API, camera or microphone.
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { MessageInput } from "../src/components/message-input";
import { useStore, releaseOptimisticMediaObjectUrl } from "../src/lib/store";
import { api } from "../src/api/client";
import { useDesignSystemStore } from "../src/ui/design-system-store";
import { getComposerController } from "../src/ui/composer-controller";

const nativeFetch = fetch.bind(globalThis);
globalThis.fetch = async () => { throw Error("Unexpected network request"); };
window.alert = () => {};
useDesignSystemStore.setState({ mode: "legacy" });
useStore.setState({ accountId: "offline", demoMode: false, messages: [],
  chats: [{ id: "c-offline", type: "group", name: "Offline fixture", avatar: "T", color: "#123456", status: "", unread: 0 }],
  refreshMessages: async () => {},
  settings: { ...useStore.getState().settings, highQualityImages: true },
});
let sends = 0;
let finishRetry!: (value: { ok: boolean; count?: number }) => void;
api.line.sendMediaBatch = async () => ++sends === 2
  ? new Promise(resolve => { finishRetry = resolve; })
  : { ok: false, error: "mock staging failure" };
const root = createRoot(document.body.appendChild(document.createElement("div")));
root.render(createElement(MessageInput, { chatId: "c-offline" }));

const assert = (ok: unknown, label: string) => { if (!ok) throw Error(label); };
const until = async (ready: () => boolean) => {
  for (let frame = 0; frame < 120; frame++) {
    if (ready()) return;
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }
  throw Error("composer did not commit its expected state");
};
const readable = async (url: string) => {
  try { return (await nativeFetch(url)).status === 200; } catch { return false; }
};
async function run() {
  await until(() => !!getComposerController("c-offline"));
  getComposerController("c-offline")!.addFiles([new File(["synthetic image"], "tiny.png", { type: "image/png" })]);
  await until(() => getComposerController("c-offline")!.snapshot.pending.length === 1);
  const pendingUrl = getComposerController("c-offline")!.snapshot.pending[0].url;
  assert(await readable(pendingUrl), "pending preview initially invalid");
  await getComposerController("c-offline")!.sendMedia();
  await until(() => !getComposerController("c-offline")!.snapshot.sending);
  assert(useStore.getState().messages.length === 0, "failed row remains");
  assert(getComposerController("c-offline")!.snapshot.pending.length === 1, "failure removed pending file");
  assert(await readable(pendingUrl), "failure revoked the pending preview");
  const retrying = getComposerController("c-offline")!.sendMedia();
  await until(() => sends === 2);
  const retry = useStore.getState().messages[0];
  assert(retry?.status === "sending", "retry row missing");
  assert(retry.imageSrc !== pendingUrl, "pending and optimistic URLs share ownership");
  assert(await readable(retry.imageSrc!), "retry preview was revoked");
  finishRetry({ ok: true, count: 1 });
  await retrying;
  await until(() => getComposerController("c-offline")!.snapshot.pending.length === 0);
  assert(!(await readable(pendingUrl)), "pending preview leaked after success");
  assert(await readable(retry.imageSrc!), "successful send revoked its optimistic preview");
  releaseOptimisticMediaObjectUrl(retry.id);
  assert(!(await readable(retry.imageSrc!)), "optimistic preview leaked after release");
  root.unmount();
  return "PASS: batch failure, retry, success and independent Blob ownership";
}
const button = document.createElement("button");
button.textContent = "添付URLを検証";
const output = document.createElement("pre");
document.body.prepend(button, output);
button.onclick = () => { button.disabled = true; void run().then(value => { output.textContent = value; })
  .catch(error => { output.textContent = `FAIL: ${error.message}`; }); };
