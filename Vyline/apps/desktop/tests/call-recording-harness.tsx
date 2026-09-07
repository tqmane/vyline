import { createRoot } from "react-dom/client";
import { useRef, useState } from "react";
import { useCallRecording } from "../src/hooks/useCallRecording";
import { useCall } from "../src/hooks/useCall";
import { CallRecordingControls } from "../src/components/call-recording-controls";
import { CallRecordingLibrary } from "../src/components/call-recording-library";
import { useStore } from "../src/lib/store";
import { api } from "../src/api/client";
import { recordingClient, recordingFileUrl } from "../src/api/recordings";
import { recordAndUpload, recordingMime, recordingStream } from "../src/utils/callRecording";
import type { ActiveCall } from "../src/utils/callAllowlist";

// No real camera, microphone, LINE transport or audible destination is used.
const owner = "fixture-owner";
const self = `u${"1".repeat(32)}`;
const other = `u${"2".repeat(32)}`;
localStorage.setItem("vyline:subdevice-session", "recording-fixture");
useStore.setState({ accountId: owner });
const nativeFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = new URL(
    typeof input === "string" ? input : input instanceof URL ? input : input.url,
    location.href,
  );
  if (url.origin !== location.origin)
    return Promise.reject(new Error("External requests prohibited in recording fixture"));
  return nativeFetch(input, init);
};
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const assert = (value: unknown, message: string) => {
  if (!value) throw new Error(message);
};
async function until(test: () => boolean, label: string) {
  for (let i = 0; i < 250; i++) {
    if (test()) return;
    await delay(20);
  }
  throw new Error(label);
}
const baseCall: ActiveCall = {
  sessionId: "generated-session",
  to: `c${"1".repeat(32)}`,
  state: "in-call",
  kind: "voice",
  participants: [],
};
function generatedAudio() {
  const context = new AudioContext();
  const destination = context.createMediaStreamDestination();
  const tone = context.createOscillator();
  tone.frequency.value = 440;
  const gain = context.createGain();
  gain.gain.value = 0.15;
  tone.connect(gain);
  gain.connect(destination);
  tone.start();
  return {
    stream: destination.stream,
    release() {
      tone.stop();
      destination.stream.getTracks().forEach((track) => track.stop());
      void context.close();
    },
  };
}
const canvas = document.createElement("canvas");
canvas.width = 320;
canvas.height = 180;
const context = canvas.getContext("2d")!;
context.fillStyle = "#20b080";
context.fillRect(0, 0, 320, 180);
context.fillStyle = "#fff";
context.font = "24px sans-serif";
context.fillText("GENERATED VIDEO", 24, 90);
const tiles = () => [{ name: "生成したテスト映像", image: canvas }];
let controls: ReturnType<typeof useCallRecording>;
let setCall!: (call: ActiveCall | null) => void;
let setAccount!: (owner: string) => void;
function Probe() {
  const [account, changeAccount] = useState(owner);
  setAccount = (next) => {
    useStore.setState({ accountId: next });
    changeAccount(next);
  };
  return <RecordingProbe key={account} account={account} />;
}
function RecordingProbe({ account }: { account: string }) {
  const [call, changeCall] = useState<ActiveCall | null>(baseCall);
  setCall = changeCall;
  const before = useRef<(() => void) | null>(null);
  controls = useCallRecording({
    accountId: account,
    call,
    selfMid: self,
    title: "生成テスト通話",
    getAudio: generatedAudio,
    getTiles: tiles,
    beforeMediaCleanupRef: before,
  });
  return <CallRecordingControls recording={controls} connected={call?.state === "in-call"} />;
}
const host = document.createElement("main");
host.className = "mx-auto max-w-3xl space-y-6 p-4";
document.body.append(host);
const root = createRoot(host);
const client = recordingClient(owner);
function TestPage() {
  const [result, setResult] = useState("テスト待機中。生成音声・映像のみ使用します。");
  const [key, setKey] = useState(0);
  const [busy, setBusy] = useState(false);
  async function test() {
    setBusy(true);
    setResult("生成メディアで検証中…");
    try {
      await run();
      await runAudioTap();
      setKey((value) => value + 1);
      setResult(
        "PASS: 音声・映像の実記録、サーバー保存、Range、DL、デコード、削除、自動の入退室・手動停止・アカウント切替、既存音声の両方向ミックス・ミュート・終話フラッシュ",
      );
    } catch (error) {
      setResult(`FAIL: ${error instanceof Error ? error.message : error}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h1 className="text-xl font-bold">通話記録 · 生成素材テスト</h1>
      <button
        type="button"
        className="min-h-11 rounded-lg border px-4"
        disabled={busy}
        onClick={() => void test()}
      >
        記録の一連の流れを検証
      </button>
      <p role="status">{result}</p>
      <Probe />
      <CallRecordingLibrary key={key} />
    </>
  );
}

async function runAudioTap() {
  const originalContext = window.AudioContext;
  const originalSocket = window.WebSocket;
  const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
  const originalStart = api.line.callStart;
  const originalEnd = api.line.callEnd;
  let micCalls = 0;
  let generatedMic: ReturnType<typeof generatedAudio> | undefined;
  // Preserve the real recording graph; only the test's speaker connection is silenced.
  class SilentContext extends originalContext {
    createScriptProcessor(size: number, inputs?: number, outputs?: number) {
      const node = super.createScriptProcessor(size, inputs, outputs);
      const connect = node.connect.bind(node);
      const silent = this.createGain();
      silent.gain.value = 0;
      silent.connect(this.destination);
      node.connect = ((target: AudioNode, output?: number, input?: number) =>
        connect(
          target === this.destination ? silent : target,
          output,
          input,
        )) as typeof node.connect;
      return node;
    }
  }
  let socket: Socket;
  class Socket {
    static OPEN = 1;
    readyState = 1;
    onmessage?: (event: { data: string | ArrayBuffer }) => void;
    onclose?: () => void;
    onopen?: () => void;
    timer?: ReturnType<typeof setInterval>;
    constructor() {
      socket = this;
      let sample = 0;
      this.timer = setInterval(() => {
        const pcm = new Int16Array(960);
        for (let i = 0; i < pcm.length; i++)
          pcm[i] = Math.sin((2 * Math.PI * 660 * sample++) / 48000) * 0.15 * 32767;
        this.onmessage?.({ data: pcm.buffer });
      }, 20);
    }
    send() {}
    close() {
      this.readyState = 3;
      clearInterval(this.timer);
      this.onclose?.();
    }
  }
  Object.assign(window, { AudioContext: SilentContext, WebSocket: Socket });
  navigator.mediaDevices.getUserMedia = async () => {
    micCalls++;
    generatedMic = generatedAudio();
    return generatedMic.stream;
  };
  api.line.callStart = async (_owner, to) => ({
    ok: true,
    session: {
      accountId: owner,
      sessionId: "generated-tap",
      to,
      kind: "AUDIO",
      state: "connecting",
      transport: "planet",
      startedAt: Date.now(),
    },
  });
  api.line.callEnd = async () => ({ ok: true });
  let call!: ReturnType<typeof useCall>;
  function AudioProbe() {
    call = useCall(owner);
    return <p>{call.call?.state ?? "idle"}</p>;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const probe = createRoot(container);
  probe.render(<AudioProbe />);
  try {
    await until(() => !!call, "audio hook mount");
    await call.startCall(other, "voice");
    socket!.onmessage?.({ data: JSON.stringify({ type: "state", state: "in-call" }) });
    await until(() => call.call?.state === "in-call" && micCalls === 1, "generated mic pipeline");
    await delay(300);
    const capture = call.getRecordingAudioTap();
    const mimeType = recordingMime("audio");
    const row = await client.start({
      sessionId: "generated-tap",
      title: "生成 音声ミックス",
      kind: "audio",
      mimeType,
      consentAccepted: true,
    });
    const upload = recordAndUpload(
      new MediaRecorder(capture.stream, { mimeType }),
      row,
      client,
      () => {},
      capture.release,
    );
    call.beforeMediaCleanupRef.current = upload.stop;
    await delay(1600);
    call.setMuted(true);
    await delay(1600);
    await call.endCall();
    const result = await upload.finished;
    assert(!result.error && result.recording?.state === "ready", "audio tap end-call flush");
    assert(micCalls === 1, "recording must not acquire another microphone");
    const file = await fetch(recordingFileUrl(owner, row.id), {
      headers: { Authorization: "Bearer recording-fixture", "X-Vyline-Installation-Id": "fixture" },
    });
    const decoder = new originalContext();
    try {
      const decoded = await decoder.decodeAudioData(await file.arrayBuffer());
      const samples = decoded.getChannelData(0);
      const amplitude = (frequency: number, start: number) => {
        const first = Math.floor(decoded.sampleRate * start);
        const count = Math.floor(decoded.sampleRate * 0.5);
        let real = 0;
        let imaginary = 0;
        for (let i = 0; i < count; i++) {
          const value = samples[first + i] ?? 0;
          const angle = (2 * Math.PI * frequency * i) / decoded.sampleRate;
          real += value * Math.cos(angle);
          imaginary += value * Math.sin(angle);
        }
        return (2 * Math.hypot(real, imaginary)) / count;
      };
      const beforeMic = amplitude(440, 0.7);
      const afterMic = amplitude(440, 2.2);
      const beforePeer = amplitude(660, 0.7);
      const afterPeer = amplitude(660, 2.2);
      assert(
        beforeMic > 0.02 && beforePeer > 0.02,
        `both audio sources must be recorded: ${beforeMic}/${beforePeer}`,
      );
      assert(
        afterMic < beforeMic * 0.15 && afterPeer > 0.02,
        `mute must only remove self: ${afterMic}/${afterPeer}`,
      );
    } finally {
      await decoder.close();
    }
  } finally {
    probe.unmount();
    container.remove();
    socket?.close();
    generatedMic?.release();
    Object.assign(window, { AudioContext: originalContext, WebSocket: originalSocket });
    navigator.mediaDevices.getUserMedia = originalGetUserMedia;
    api.line.callStart = originalStart;
    api.line.callEnd = originalEnd;
  }
}
root.render(<TestPage />);
async function run() {
  const existing = await client.list();
  for (const item of existing.items) {
    assert(item.title.startsWith("生成"), "unexpected non-fixture data");
    if (item.state === "recording") await client.finish(item.id, 0, true);
    await client.remove(item.id);
  }
  for (const kind of ["audio", "video"] as const) {
    const capture = recordingStream(generatedAudio(), kind, tiles);
    const mimeType = recordingMime(kind);
    const recorder = new MediaRecorder(capture.stream, { mimeType });
    const row = await client.start({
      sessionId: "generated-session",
      title: `生成 ${kind}`,
      kind,
      mimeType,
      consentAccepted: true,
    });
    const upload = recordAndUpload(recorder, row, client, () => {}, capture.release);
    await delay(1600);
    upload.stop();
    const saved = await upload.finished;
    assert(
      !saved.error && saved.recording?.state === "ready" && saved.recording.bytes > 1000,
      `save ${kind}: ${saved.error}`,
    );
    const file = await fetch(recordingFileUrl(owner, row.id), {
      headers: { Authorization: "Bearer recording-fixture", "X-Vyline-Installation-Id": "fixture" },
    });
    assert(file.ok, `file HTTP ${file.status}`);
    // Only this tiny generated fixture is materialized for decode assertions, never production recordings.
    const bytes = await file.arrayBuffer();
    const ranged = await fetch(recordingFileUrl(owner, row.id), {
      headers: {
        Authorization: "Bearer recording-fixture",
        "X-Vyline-Installation-Id": "fixture",
        Range: "bytes=0-15",
      },
    });
    assert(
      ranged.status === 206 && (await ranged.arrayBuffer()).byteLength === 16,
      "Range must be bounded",
    );
    const download = await fetch(recordingFileUrl(owner, row.id, true), {
      method: "HEAD",
      headers: { Authorization: "Bearer recording-fixture", "X-Vyline-Installation-Id": "fixture" },
    });
    assert(
      download.headers.get("content-disposition")?.startsWith("attachment"),
      "download filename",
    );
    if (kind === "audio") {
      const decoder = new AudioContext();
      const decoded = await decoder.decodeAudioData(bytes);
      const samples = decoded.getChannelData(0);
      const rms = Math.sqrt(samples.reduce((sum, value) => sum + value ** 2, 0) / samples.length);
      assert(decoded.duration > 1 && rms > 0.03, "generated audio must decode and not be silent");
      await decoder.close();
      await client.remove(row.id);
      const missing = await fetch(recordingFileUrl(owner, row.id), {
        headers: {
          Authorization: "Bearer recording-fixture",
          "X-Vyline-Installation-Id": "fixture",
        },
      });
      assert(missing.status === 404, "deleted file must disappear");
    } else {
      const video = document.createElement("video");
      video.muted = true;
      const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
      video.src = url;
      try {
        await video.play();
        await until(
          () => video.videoWidth === 1280 && video.currentTime > 0.1,
          "recorded video must decode",
        );
      } finally {
        video.pause();
        video.removeAttribute("src");
        video.load();
        URL.revokeObjectURL(url);
      }
    }
  }
  await until(() => controls.ready, "recording preferences not loaded");
  const originalConfirm = window.confirm;
  window.confirm = () => true;
  try {
    controls.setAutomatic(true);
    await delay(200);
    assert(controls.waiting && controls.state !== "recording", "auto must wait for others");
    setCall({
      ...baseCall,
      participants: [{ mid: other, hasAudioStream: true, hasVideoStream: false }],
    });
    await until(() => controls.state === "recording", "auto did not start");
    await delay(1100);
    setCall(baseCall);
    await until(() => controls.state === "saved", "last other left: recording must finish");
    assert(controls.automatic && controls.waiting, "auto remains armed without hanging up");
    setCall({
      ...baseCall,
      participants: [{ mid: other, hasAudioStream: true, hasVideoStream: false }],
    });
    await until(() => controls.state === "recording", "rejoin must start another recording");
    await delay(1100);
    controls.stop();
    await until(() => controls.state === "saved", "manual stop must finish");
    await delay(200);
    assert(
      !controls.automatic && controls.state === "saved",
      "manual stop must suppress auto restart",
    );
    controls.start();
    await until(() => controls.state === "recording", "manual restart");
    await delay(1100);
    const previousNotice = useStore.getState().showNotice;
    let wrongAccountNotice = false;
    useStore.setState({
      showNotice: () => {
        if (useStore.getState().accountId !== owner) wrongAccountNotice = true;
      },
    });
    localStorage.setItem("vyline:subdevice-session", "recording-other");
    setAccount("fixture-other");
    try {
      let finished = false;
      for (let attempt = 0; attempt < 50; attempt++) {
        await delay(100);
        if (!(await client.list()).items.some((item) => item.state === "recording")) {
          finished = true;
          break;
        }
      }
      assert(finished, "old account recording must finalize with original credentials");
      await delay(100);
      assert(
        !wrongAccountNotice,
        "old recording must not notify the new account after a keyed unmount",
      );
    } finally {
      useStore.setState({ showNotice: previousNotice });
    }
  } finally {
    window.confirm = originalConfirm;
    localStorage.setItem("vyline:subdevice-session", "recording-fixture");
    setAccount(owner);
    setCall(baseCall);
  }
}
