// Loopback-only lifecycle/roster tests. Never access real media or LINE.
import { createRoot } from "react-dom/client";
import { createRef } from "react";
import { api } from "../src/api/client";
import { useCall } from "../src/hooks/useCall";
import type { CallParticipant, CallSessionInfo } from "@vyline/types";
import { CallOverlay } from "../src/components/call-overlay";

const video = {
  available: false,
  localEnabled: false,
  remoteEnabled: false,
  hasImage: false,
  busy: false,
  localRef: createRef<HTMLVideoElement>(),
  remoteRef: createRef<HTMLCanvasElement>(),
  toggleCamera() {},
  switchCamera() {},
  stopVideo() {},
};
function Preview({ count = 12, long = false }: { count?: number; long?: boolean }) {
  return (
    <div style={{ position: "relative", height: "100dvh", width: "100%" }}>
      <CallOverlay
        kind="voice"
        name={long ? "とても長いテストグループ名の表示確認".repeat(4) : "てすたや（表示テスト）"}
        glyph="T"
        color="var(--vy-accent)"
        state="in-call"
        onClose={() => {}}
        video={video}
        participants={Array.from({ length: count }, (_, i) => ({
          id: String(i),
          self: i === 0,
          name: i === 0 ? "自分" : i === 1 ? "長い名前の表示確認".repeat(8) : `参加者 ${i + 1}`,
          glyph: String(i + 1),
          color: "var(--vy-accent)",
        }))}
      />
    </div>
  );
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 20));
const assert = (value: unknown, label: string) => {
  if (!value) throw new Error(label);
};
const group = `c${"1".repeat(32)}`;
const member: CallParticipant = {
  mid: `u${"1".repeat(32)}`,
  hasAudioStream: true,
  hasVideoStream: false,
};
const ended: Array<[string, string]> = [];
let defer = false;
let nextId = 0;
let complete!: () => void;
api.line.callStart = (accountId, to) => {
  const session: CallSessionInfo = {
    accountId,
    to,
    sessionId: `test-${++nextId}`,
    kind: "AUDIO",
    state: "connecting",
    transport: "planet",
    startedAt: 0,
  };
  return defer
    ? new Promise((resolve) => {
        complete = () => resolve({ ok: true, session });
      })
    : Promise.resolve({ ok: true, session });
};
api.line.callEnd = async (accountId, id) => {
  ended.push([accountId, id]);
  return { ok: true };
};
class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 1;
  onmessage?: (event: { data: string }) => void;
  onclose?: () => void;
  constructor(_url: string) {
    Socket.instances.push(this);
  }
  send() {}
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  state(participants: CallParticipant[]) {
    this.onmessage?.({
      data: JSON.stringify({ type: "state", state: "connecting", participants }),
    });
  }
}
class Context {
  state = "running";
  sampleRate = 48000;
  async resume() {}
  async close() {
    this.state = "closed";
  }
}
Object.assign(globalThis, {
  WebSocket: Socket,
  AudioContext: Context,
  fetch: async () => {
    throw new Error("Unexpected network request in call harness");
  },
});
Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
  value: async () => {
    throw new Error("Unexpected media request");
  },
});
const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
let controls: ReturnType<typeof useCall>;
function Probe({ account }: { account: string }) {
  controls = useCall(account);
  return <pre>{JSON.stringify(controls.call)}</pre>;
}
const mount = async (account: string) => {
  root.render(<Probe key={account} account={account} />);
  await tick();
};
async function run() {
  await mount("first");
  await controls.startCall(group, "voice");
  await tick();
  const first = Socket.instances.at(-1)!;
  first.state([member]);
  await tick();
  assert(controls.call?.participants?.length === 1, "WS roster not applied");
  first.state([]);
  await tick();
  assert(controls.call?.participants?.length === 0, "departure roster not applied");
  await controls.endCall();
  await tick();
  defer = true;
  const pending = controls.startCall(group, "voice");
  await tick();
  await mount("second");
  complete();
  await pending;
  await tick();
  assert(
    ended.some(([account, id]) => account === "first" && id === "test-2"),
    "late call start leaked after account cleanup",
  );
  assert(controls.call === null, "previous account call leaked into next account");
  defer = false;
  await controls.startCall(group, "voice");
  await tick();
  const second = Socket.instances.at(-1)!;
  await controls.endCall();
  await tick();
  await controls.startCall(group, "voice");
  await tick();
  const current = Socket.instances.at(-1)!;
  current.state([member]);
  await tick();
  second.state([]);
  second.onclose?.();
  await tick();
  assert(
    controls.call?.state === "connecting" && controls.call.participants?.length === 1,
    "old socket overwrote new call",
  );
  root.render(<Preview />);
  await tick();
  assert(
    document.querySelectorAll('[aria-label="通話参加者"] li').length === 12,
    "group voice cards missing",
  );
  document.querySelector<HTMLButtonElement>('button[aria-label="ミュート"]')!.click();
  await tick();
  assert(
    document.querySelector('[aria-label="通話参加者"]')?.textContent?.includes("ミュート中"),
    "local mute missing from participant card",
  );
  root.unmount();
  return "PASS: roster updates, empty departures, account cleanup, late start cancellation, stale socket isolation";
}
const button = document.createElement("button");
button.textContent = "グループ通話状態を検証";
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
  const query = new URLSearchParams(location.search);
  const count = Number(query.get("count") ?? 12);
  root.render(
    <Preview
      count={Number.isInteger(count) ? Math.max(0, Math.min(30, count)) : 12}
      long={query.has("long")}
    />,
  );
}
