import { createRef, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { CallPanel } from "../src/components/call-panel";
import { CallOverlay } from "../src/components/call-overlay";
import { CallRecordingControls } from "../src/components/call-recording-controls";
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 40));
const assert = (value: unknown, message: string) => {
  if (!value) throw new Error(message);
};
const canvas = document.createElement("canvas");
canvas.width = 320;
canvas.height = 180;
canvas.getContext("2d")!.fillRect(0, 0, 320, 180);
const stream = canvas.captureStream(1);
let mounts = 0;
function Media() {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    mounts++;
    ref.current!.srcObject = stream;
  }, []);
  return (
    <video
      ref={ref}
      autoPlay
      muted
      playsInline
      aria-label="生成映像"
      className="h-full w-full object-contain"
    />
  );
}
const host = document.createElement("div");
host.style.cssText = "display:flex;position:relative;width:1100px;height:620px;max-width:100vw";
document.body.append(host);
const root = createRoot(host);
root.render(
  <>
    <section aria-label="トーク" className="min-w-0 flex-1">
      <label>
        メッセージ
        <textarea aria-label="メッセージ" className="w-full border" />
      </label>
    </section>
    <CallPanel name="生成テスト通話" recordingSummary="録画中 · 0:12" onClose={() => {}}>
      <Media />
    </CallPanel>
  </>,
);
const button = document.createElement("button");
button.textContent = "通話ペインを検証";
button.style.cssText = "min-height:44px;padding:12px";
document.body.prepend(button);
const result = document.createElement("p");
result.setAttribute("role", "status");
document.body.prepend(result);
button.onclick = async () => {
  button.disabled = true;
  try {
    await tick();
    await tick();
    const pane = host.querySelector<HTMLElement>("[data-call-panel]")!;
    const media = host.querySelector("video")!;
    const message = host.querySelector("textarea")!;
    assert(pane.dataset.callPanel === "docked", "wide layout must create a docked call pane");
    assert(
      message.getBoundingClientRect().right <= pane.getBoundingClientRect().left + 1,
      "call pane must not cover chat",
    );
    const divider = pane.querySelector<HTMLElement>('[role="separator"]')!;
    assert(divider && divider.tabIndex >= 0, "call pane width needs keyboard-accessible divider");
    const before = pane.getBoundingClientRect().width;
    divider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    await tick();
    assert(pane.getBoundingClientRect().width > before, "pane divider keyboard resize");
    divider.setPointerCapture = () => {};
    divider.releasePointerCapture = () => {};
    const x = divider.getBoundingClientRect().x;
    for (const type of ["pointerdown", "pointermove", "pointerup"])
      divider.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerId: 9,
          isPrimary: true,
          button: 0,
          clientX: x - (type === "pointerdown" ? 0 : 70),
        }),
      );
    await tick();
    assert(pane.getBoundingClientRect().width > before + 30, "pane divider pointer resize");
    message.focus();
    message.value = "通話を続けてトークを操作";
    assert(document.activeElement === message, "docked call must not trap chat focus");
    host.style.width = "320px";
    await tick();
    await tick();
    assert(pane.dataset.callPanel === "expanded", "phone begins with expanded call");
    pane.querySelector<HTMLButtonElement>('[aria-label="通話を小さくしてトークを見る"]')!.click();
    await tick();
    assert(pane.dataset.callPanel === "minimized", "phone call can minimize");
    assert(pane.textContent?.includes("録画中"), "minimized call must keep recording indicator");
    message.focus();
    assert(document.activeElement === message, "minimized call must allow chat input");
    pane.querySelector<HTMLButtonElement>('[aria-label="通話へ戻る"]')!.click();
    await tick();
    assert(
      pane.dataset.callPanel === "expanded" && media === host.querySelector("video"),
      "restore must keep the same media element",
    );
    assert(
      media.srcObject === stream &&
        stream.getTracks().every((track) => track.readyState === "live") &&
        mounts === 1,
      "resize/minimize must not restart or stop media",
    );
    result.textContent =
      "PASS: independent chat/call pane, pointer/keyboard resize, mobile minimize/restore, recording indicator and media continuity";
  } catch (error) {
    result.textContent = `FAIL: ${error instanceof Error ? error.message : error}`;
  } finally {
    button.disabled = false;
  }
};
if (location.search.includes("preview")) {
  button.hidden = true;
  host.style.width = "100%";
  host.style.height = "100dvh";
  const video = {
    available: true,
    localEnabled: false,
    remoteEnabled: false,
    hasImage: false,
    busy: false,
    localRef: createRef<HTMLVideoElement>(),
    remoteRef: createRef<HTMLCanvasElement>(),
    remoteCanvasesRef: { current: new Map<string, HTMLCanvasElement>() },
    remoteImages: new Set<string>(),
    toggleCamera() {},
    switchCamera() {},
    stopVideo() {},
  };
  const recording = {
    state: "recording" as const,
    kind: "video" as const,
    automatic: true,
    seconds: 12,
    ready: true,
    busy: true,
    waiting: false,
    setKind() {},
    setAutomatic() {},
    start() {},
    stop() {},
    stopForCallEnd() {},
  };
  root.render(
    <>
      <section aria-label="トーク" className="flex min-w-0 flex-1 flex-col justify-between p-4">
        <h1>てすたや（生成プレビュー）</h1>
        <p>通話を続けながらトークを操作できます。</p>
        <textarea aria-label="メッセージ" className="min-h-11 w-full border" />
      </section>
      <CallPanel name="生成グループ通話" recordingSummary="録画中 · 0:12" onClose={() => {}}>
        <CallOverlay
          modal={false}
          kind="video"
          name="生成グループ通話"
          glyph="T"
          color="var(--vy-accent)"
          state="in-call"
          onClose={() => {}}
          video={video}
          participants={Array.from({ length: 4 }, (_, index) => ({
            id: String(index),
            name: index ? `参加者 ${index}` : "自分",
            self: index === 0,
            glyph: String(index),
            color: "var(--vy-accent)",
          }))}
          recordingControls={<CallRecordingControls recording={recording} connected />}
        />
      </CallPanel>
    </>,
  );
}
