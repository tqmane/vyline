// Browser-only regression harness. No real microphone, camera, or network calls.
// Build: bun build Vyline/apps/desktop/tests/call-video-harness.tsx --target browser --outfile <output.js>
import { createRoot } from "react-dom/client";
import { useCallVideo } from "../src/hooks/useCallVideo";
import { encodeCallVideoFrame } from "@vyline/types";
import type { ActiveCall } from "../src/utils/callAllowlist";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 10));
const assert = (condition: unknown, label: string) => {
  if (!condition) throw new Error(label);
};
let controls: ReturnType<typeof useCallVideo>;
let mediaRequests = 0;
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
  state(localEnabled = false, remoteEnabled = false) {
    this.onmessage?.({
      data: JSON.stringify({
        type: "state",
        video: { available: true, localEnabled, remoteEnabled },
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
  VideoDecoder: FakeDecoder,
});
Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
  value: async () => {
    mediaRequests++;
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 360;
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
    <Probe call={id ? { sessionId: id, to: "u-test", kind: "voice", state: "in-call" } : null} />,
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
      data: new Uint8Array([0, 0, 0, 4, 0x67, 0x42, 0xe0, 0x1e, 0, 0, 0, 2, 0x65, 0x88]),
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
  await mount(null);
  root.unmount();
  return "PASS: delayed acquisition, cleanup before permission, immediate end, late decoder output, video disconnect";
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
