import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { ControllerMediaPortal } from "../src/ui/controller-media-portal";

const tick = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
async function run() {
  const host = document.body.appendChild(document.createElement("div"));
  const frameHost = document.body.appendChild(document.createElement("div"));
  frameHost.className = "vy-kmp-host";
  const frame = frameHost.appendChild(document.createElement("iframe"));
  await new Promise<void>(resolve => { frame.onload = () => resolve(); frame.src = "about:blank"; });
  const root = createRoot(host);
  root.render(createElement(ControllerMediaPortal, { active: true }, createElement("canvas", { width: 2, height: 2 })));
  await tick();
  const id = host.querySelector<HTMLElement>("[data-native-media-portal]")!.dataset.nativeMediaPortal!;
  const windowWithSlots = frame.contentWindow as Window & { __vylineMediaSlots: Map<string, HTMLElement> };
  windowWithSlots.__vylineMediaSlots = new Map();
  const announce = (type: string) => window.dispatchEvent(new MessageEvent("message", {
    source: frame.contentWindow, origin: location.origin, data: { channel: "vyline-ui", version: 1, type, id },
  }));
  try {
    const previous = frame.contentDocument!.body.appendChild(frame.contentDocument!.createElement("div"));
    windowWithSlots.__vylineMediaSlots.set(id, previous); announce("media-slot"); await tick();
    const canvas = previous.shadowRoot!.querySelector("canvas")!;
    canvas.getContext("2d")!.fillRect(0, 0, 2, 2);
    // Removal was queued by the old native slot before the replacement was registered.
    // By delivery time the registry already points at the replacement.
    const current = frame.contentDocument!.body.appendChild(frame.contentDocument!.createElement("div"));
    windowWithSlots.__vylineMediaSlots.set(id, current);
    announce("media-slot-removed"); await tick();
    if (!current.shadowRoot?.contains(canvas) || !canvas.isConnected) throw Error("old slot removal detached the current video surface");
    if (canvas.getContext("2d")!.getImageData(0, 0, 1, 1).data[3] !== 255) throw Error("canvas pixels were lost during reattachment");
    announce("media-slot"); await tick();
    if (current.shadowRoot.querySelector("canvas") !== canvas) throw Error("video canvas was recreated");
    windowWithSlots.__vylineMediaSlots.delete(id); announce("media-slot-removed"); await tick();
    if (canvas.isConnected) throw Error("removed slot was not released");
    return "PASS: media slot replacement retains the canvas and pixels, final removal detaches it";
  } finally { root.unmount(); host.remove(); frameHost.remove(); }
}
const button = document.createElement("button"); button.textContent = "映像表示先の付け替えを検証";
const output = document.createElement("pre"); document.body.prepend(button, output);
button.onclick = () => { button.disabled = true; void run().then(value => { output.textContent = value; })
  .catch(error => { output.textContent = `FAIL: ${error.message}`; }); };
