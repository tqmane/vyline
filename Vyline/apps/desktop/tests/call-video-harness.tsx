// Browser-only regression harness. No real microphone, camera, or network calls.
// Build: bun build Vyline/apps/desktop/tests/call-video-harness.tsx --target browser --outfile <output.js>
import { createRoot } from "react-dom/client";
import { useCallVideo } from "../src/hooks/useCallVideo";
import { encodeCallVideoFrame } from "@vyline/types";
import type { ActiveCall } from "../src/utils/callAllowlist";
import { CallOverlay } from "../src/components/call-overlay";
import { CallVideoStage } from "../src/components/call-video-stage";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 10));
const assert = (condition: unknown, label: string) => {
  if (!condition) throw new Error(label);
};
let controls: ReturnType<typeof useCallVideo>;
let mediaRequests = 0;
let showOverlay = false;
let overlayKind: "voice" | "video" = "video";
let groupCall = false;
const groupMembers = [1, 2, 3].map((i) => ({
  mid: `u${String(i).repeat(32)}`,
  hasAudioStream: true,
  hasVideoStream: true,
}));
const tracks: MediaStreamTrack[] = [];
let supportResolve: ((value: { supported: boolean }) => void) | undefined;
class FakeSocket {
  static OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 1;
  bufferedAmount = 0;
  binaryType = "arraybuffer";
  onmessage?: (event: { data: unknown }) => void;
  onclose?: () => void;
  constructor(_url: string) {
    FakeSocket.instances.push(this);
  }
  send() {}
  close() {
    if (this.readyState !== 3) {
      this.readyState = 3;
      this.onclose?.();
    }
  }
  state(
    localEnabled = false,
    remoteEnabled = false,
    participants = groupCall ? groupMembers : undefined,
  ) {
    this.onmessage?.({
      data: JSON.stringify({
        type: "state",
        video: { available: true, localEnabled, remoteEnabled },
        participants,
      }),
    });
  }
}
class FakeEncoder {
  static instances: FakeEncoder[] = [];
  static isConfigSupported() {
    return new Promise<{ supported: boolean }>((resolve) => {
      supportResolve = resolve;
    });
  }
  state = "unconfigured";
  encodeQueueSize = 0;
  constructor(_callbacks: unknown) {
    FakeEncoder.instances.push(this);
  }
  configure() {
    this.state = "configured";
  }
  encode() {}
  close() {
    this.state = "closed";
  }
}
class FakeDecoder {
  static instances: FakeDecoder[] = [];
  state = "unconfigured";
  decodeQueueSize = 0;
  constructor(public callbacks: { output: (frame: VideoFrame) => void }) {
    FakeDecoder.instances.push(this);
  }
  configure() {
    this.state = "configured";
  }
  decode() {}
  close() {
    this.state = "closed";
  }
  reset() {
    this.state = "unconfigured";
  }
}
Object.assign(globalThis, {
  WebSocket: FakeSocket,
  VideoEncoder: FakeEncoder,
  ...(location.search.includes("preview-video") ? {} : { VideoDecoder: FakeDecoder }),
});
Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
  value: async () => {
    mediaRequests++;
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 360;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#2563eb";
    context.fillRect(0, 0, 640, 360);
    context.fillStyle = "white";
    context.font = "48px sans-serif";
    context.fillText("LOCAL", 220, 200);
    const stream = canvas.captureStream(15);
    tracks.push(...stream.getTracks());
    return stream;
  },
});
HTMLMediaElement.prototype.play = async () => {};
const rootElement = document.createElement("div");
document.body.append(rootElement);
const root = createRoot(rootElement);
function Probe({ call }: { call: ActiveCall | null }) {
  controls = useCallVideo("test", call);
  if (showOverlay || location.search.includes("preview"))
    return (
      <CallOverlay
        kind={overlayKind}
        name="テスト通話"
        glyph="T"
        color="#24a8df"
        state="in-call"
        onClose={() => controls.stopVideo()}
        video={controls}
        participants={
          groupCall
            ? groupMembers.map((member, i) => ({
                id: member.mid,
                name: `参加者 ${i + 1}`,
                glyph: String(i + 1),
                color: "#24a8df",
                hasVideoStream: true,
              }))
            : undefined
        }
      />
    );
  return (
    <>
      <video ref={controls.localRef} muted />
      <canvas ref={controls.remoteRef} />
      <pre>{JSON.stringify({ busy: controls.busy, image: controls.hasImage })}</pre>
    </>
  );
}
const mount = async (id: string | null) => {
  root.render(
    <Probe
      call={
        id
          ? {
              sessionId: id,
              to: groupCall ? `c${"1".repeat(32)}` : "u-test",
              kind: "voice",
              state: "in-call",
            }
          : null
      }
    />,
  );
  await tick();
  await tick();
  const ws = FakeSocket.instances.at(-1)!;
  if (id) {
    ws.state();
    await tick();
  }
  return ws;
};
async function run() {
  const ws = await mount("first");
  controls.toggleCamera();
  await tick();
  ws.state(false, true);
  await tick();
  supportResolve!({ supported: true });
  await tick();
  await tick();
  ws.state(true, true);
  await tick();
  assert(mediaRequests === 1 && !controls.busy, "remote state interrupted camera acquisition");
  controls.stopVideo();
  assert(
    tracks.every((track) => track.readyState === "ended") &&
      FakeEncoder.instances.every((e) => e.state === "closed"),
    "end did not stop camera synchronously",
  );

  await mount("second");
  controls.toggleCamera();
  await tick();
  const resolveAfterEnd = supportResolve!;
  await mount(null);
  resolveAfterEnd({ supported: true });
  await tick();
  await tick();
  assert(mediaRequests === 1, "camera was requested after call cleanup");

  const third = await mount("third");
  third.state(false, true);
  await tick();
  third.onmessage?.({
    data: encodeCallVideoFrame({
      key: true,
      timestamp: 90,
      data: new Uint8Array([0x30, 0, 0, 0x9d, 1, 0x2a, 0x80, 2, 0x68, 1, 0, 0]),
    }).buffer,
  });
  const decoder = FakeDecoder.instances.at(-1)!;
  assert(decoder?.state === "configured", "decoder not created");
  third.state(false, false);
  await tick();
  const picture = new OffscreenCanvas(16, 16);
  picture.getContext("2d")!.fillRect(0, 0, 16, 16);
  decoder.callbacks.output(new VideoFrame(picture, { timestamp: 1000 }));
  await tick();
  assert(!controls.hasImage, "late output restored a paused camera image");
  third.close();
  await tick();
  assert(decoder.state === "closed", "video disconnect leaked decoder");
  showOverlay = true;
  overlayKind = "voice";
  const layout = await mount("layout");
  assert(
    document.activeElement?.getAttribute("aria-label") === "ミュート",
    "voice call focused hidden video controls",
  );
  controls.toggleCamera();
  await tick();
  supportResolve!({ supported: true });
  await tick();
  await tick();
  layout.state(true, true);
  await tick();
  const preview = document.querySelector<HTMLButtonElement>(
    'button[aria-label="自分の映像を大きく表示"]',
  );
  assert(preview, "draggable preview control missing");
  const localNode = controls.localRef.current!;
  const remoteNode = controls.remoteRef.current!;
  const stream = localNode.srcObject;
  preview!.click();
  await tick();
  assert(
    preview!.getAttribute("aria-label") === "相手の映像を大きく表示",
    "tap did not swap views",
  );
  assert(
    controls.localRef.current === localNode &&
      controls.remoteRef.current === remoteNode &&
      localNode.srcObject === stream,
    "swap replaced media nodes or camera stream",
  );
  preview!.click();
  await tick();
  // Real pointer capture is verified by browser drag; synthetic events only exercise geometry.
  preview!.setPointerCapture = () => {};
  preview!.releasePointerCapture = () => {};
  const before = preview!.getBoundingClientRect();
  const point = (type: string, x: number, y: number) =>
    preview!.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        pointerId: 9,
        isPrimary: true,
        button: 0,
        clientX: x,
        clientY: y,
      }),
    );
  point("pointerdown", before.x + 10, before.y + 10);
  point("pointermove", -1000, -1000);
  point("pointerup", -1000, -1000);
  preview!.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
  await tick();
  assert(preview!.getAttribute("aria-label") === "自分の映像を大きく表示", "drag triggered swap");
  const stage = localNode.closest<HTMLElement>("[data-call-stage]")!;
  const moved = preview!.getBoundingClientRect();
  const bounds = stage.getBoundingClientRect();
  assert(
    moved.left >= bounds.left && moved.top >= bounds.top && moved.left < before.left,
    "drag escaped the video area or did not move",
  );
  preview!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
  await tick();
  assert(preview!.getBoundingClientRect().left > moved.left, "keyboard could not move preview");
  preview!.click();
  await tick();
  const split = Array.from(document.querySelectorAll("button")).find(
    (button) => button.textContent === "分割",
  )!;
  split.click();
  await tick();
  assert(
    stage.dataset.callStage === "split" &&
      controls.localRef.current === localNode &&
      controls.remoteRef.current === remoteNode &&
      localNode.srcObject === stream,
    "split view replaced media or failed to change layout",
  );
  const swapOrder = Array.from(document.querySelectorAll("button")).find(
    (button) => button.textContent === "表示順を入れ替え",
  )!;
  const localTile = localNode.closest<HTMLElement>("[data-call-tile]")!;
  const oldOrder = localTile.style.order;
  swapOrder.click();
  await tick();
  assert(
    localTile.style.order !== oldOrder && localNode.srcObject === stream,
    "split order did not change or replaced stream",
  );
  layout.state(false, true);
  await tick();
  assert(
    localNode.classList.contains("hidden") && !remoteNode.classList.contains("hidden"),
    "camera stop did not restore peer view",
  );
  await mount(null);
  groupCall = true;
  overlayKind = "video";
  const group = await mount("group-video");
  group.state(false, true);
  await tick();
  const frame = {
    key: true,
    timestamp: 90,
    data: new Uint8Array([0x30, 0, 0, 0x9d, 1, 0x2a, 0x80, 2, 0x68, 1, 0, 0]),
  };
  const beforeDecoders = FakeDecoder.instances.length;
  for (const member of groupMembers)
    group.onmessage?.({
      data: encodeCallVideoFrame({ ...frame, sourceMid: member.mid }).buffer,
    });
  assert(FakeDecoder.instances.length === beforeDecoders + 3, "group sources share a decoder");
  const decoders = FakeDecoder.instances.slice(-3);
  for (const decoder of decoders)
    decoder.callbacks.output(new VideoFrame(picture, { timestamp: 1000 }));
  await tick();
  assert(controls.remoteImages.size === 3, "group images were not routed to their canvases");
  const canvases = groupMembers.map((m) => controls.remoteCanvasesRef.current.get(m.mid));
  const endButton = document
    .querySelector<HTMLButtonElement>('button[aria-label="通話を終了"]')!
    .getBoundingClientRect();
  assert(
    endButton.top >= 0 && endButton.bottom <= innerHeight,
    "group video hid the end-call control",
  );
  assert(
    canvases.every((canvas) => canvas?.width === 16),
    "group canvas was missing or not drawn",
  );
  group.state(false, true, groupMembers.slice(1));
  await tick();
  assert(
    decoders[0].state === "closed" && decoders[1].state === "configured",
    "departure did not isolate decoder cleanup",
  );
  decoders[0].callbacks.output(new VideoFrame(picture, { timestamp: 2000 }));
  group.onmessage?.({
    data: encodeCallVideoFrame({ ...frame, sourceMid: groupMembers[0].mid }).buffer,
  });
  await tick();
  assert(
    !controls.remoteImages.has(groupMembers[0].mid) && controls.remoteImages.size === 2,
    "late media resurrected a departed participant",
  );
  assert(FakeDecoder.instances.length === beforeDecoders + 3, "unknown source allocated a decoder");
  await mount(null);
  assert(
    decoders.every((d) => d.state === "closed"),
    "group cleanup leaked decoders",
  );
  groupCall = false;
  const tiles = ["A", "B", "C", "self"].map((id) => ({
    id,
    name: id,
    visible: true,
    content: <canvas aria-label={`fixture-${id}`} className="h-full w-full" />,
  }));
  root.render(
    <div style={{ height: 480, display: "flex" }}>
      <CallVideoStage tiles={tiles} />
    </div>,
  );
  await tick();
  const originalTiles = Array.from(document.querySelectorAll("[data-call-tile]"));
  Array.from(document.querySelectorAll("button"))
    .find((b) => b.textContent === "一覧")!
    .click();
  await tick();
  document.querySelector<HTMLButtonElement>('button[aria-label="Bを前へ移動"]')!.click();
  await tick();
  assert((originalTiles[1] as HTMLElement).style.order === "0", "gallery reorder failed");
  document.querySelector<HTMLButtonElement>('button[aria-label="Cの映像を固定"]')!.click();
  await tick();
  assert((originalTiles[2] as HTMLElement).style.gridColumn === "1", "group focus failed");
  assert(
    originalTiles.every((node, i) => node === document.querySelectorAll("[data-call-tile]")[i]),
    "group layout replaced media parent nodes",
  );
  root.unmount();
  return "PASS: video lifecycle, drag/swap/split, 3 independent group decoders/canvases, departure/late-frame cleanup, 4-tile gallery/focus";
}
const button = document.createElement("button");
button.textContent = "映像ライフサイクルを検証";
const output = document.createElement("pre");
document.body.prepend(button, output);
button.onclick = () => {
  button.disabled = true;
  void run()
    .then((result) => {
      output.textContent = result;
    })
    .catch((error) => {
      output.textContent = `FAIL: ${error.message}`;
    });
};
if (location.search.includes("preview")) {
  button.remove();
  output.remove();
  if (location.search.includes("preview-group-call")) {
    groupCall = true;
    void mount("group-preview").then((ws) => ws.state(false, true));
  } else if (location.search.includes("preview-group")) {
    root.render(
      <div style={{ height: "100dvh", padding: 16, display: "flex" }}>
        <CallVideoStage
          tiles={["A", "B", "C", "自分"].map((name, index) => ({
            id: name,
            name,
            visible: true,
            content: (
              <div
                className="flex h-full items-center justify-center text-2xl text-white"
                style={{ background: ["#134e4a", "#1e3a8a", "#713f12", "#4c1d95"][index] }}
              >
                {name}
              </div>
            ),
          }))}
        />
      </div>,
    );
  } else
    void mount("preview").then(async (ws) => {
      if (location.search.includes("preview-controls")) {
        controls.toggleCamera();
        await tick();
        supportResolve!({ supported: true });
        await tick();
        await tick();
        ws.state(true, false);
        return;
      }
      if (!location.search.includes("preview-video")) return;
      // Only the loopback harness supplies this known synthetic, camera-free fixture.
      const fixtures = (await (await fetch("/vp8.json")).json()) as {
        data: string;
        key: boolean;
        timestamp: number;
      }[];
      ws.state(false, true);
      for (const frame of fixtures) {
        const data = Uint8Array.from(atob(frame.data), (c) => c.charCodeAt(0));
        ws.onmessage?.({ data: encodeCallVideoFrame({ ...frame, data }).buffer });
        await new Promise((resolve) => setTimeout(resolve, 67));
      }
    });
}
