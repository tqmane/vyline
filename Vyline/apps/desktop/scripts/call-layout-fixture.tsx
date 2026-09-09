import { useRef, useState, type ComponentProps } from "react";
import { CallOverlay } from "../src/components/call-overlay";
import { CallPanel } from "../src/components/call-panel";
import { CallRecordingControls } from "../src/components/call-recording-controls";
import { NativeControllerSurface } from "../src/ui/native-controller-surface";
import { publishControllerCall } from "../src/ui/controller-call";

type Scenario =
  | "voice"
  | "video"
  | "group"
  | "group-video"
  | "failed"
  | "starting"
  | "acquiring"
  | "connecting"
  | "ringing"
  | "ending"
  | "ended"
  | "recording-error"
  | "recording-starting"
  | "recording-saving"
  | "camera-unavailable";

// Browser-only fixture: real presentation components, no call/media/network hooks.
export function CallLayoutFixture({
  scenario,
  native = false,
}: { scenario: Scenario; native?: boolean }) {
  const [camera, setCamera] = useState(scenario === "video");
  const [automatic, setAutomatic] = useState(false);
  const [kind, setKind] = useState<"audio" | "video">("audio");
  const [recordingState, setRecordingState] = useState<
    "idle" | "starting" | "recording" | "saving" | "saved" | "error"
  >(
    scenario === "recording-starting"
      ? "starting"
      : scenario === "recording-saving"
        ? "saving"
        : "idle",
  );
  const [closed, setClosed] = useState(false);
  const [switches, setSwitches] = useState(0);
  const [muted, setMuted] = useState(false);
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLCanvasElement>(null);
  const remoteCanvasesRef = useRef(new Map<string, HTMLCanvasElement>());
  const name = "デザイン確認用の長い名前のグループ通話";
  const state = [
    "starting",
    "acquiring",
    "connecting",
    "ringing",
    "ending",
    "ended",
    "failed",
  ].includes(scenario)
    ? (scenario as
        | "starting"
        | "acquiring"
        | "connecting"
        | "ringing"
        | "ending"
        | "ended"
        | "failed")
    : "in-call";
  const video = {
    localEnabled: camera,
    remoteEnabled: scenario === "video" || scenario === "group-video",
    available: scenario !== "camera-unavailable",
    busy: false,
    localRef,
    remoteRef,
    remoteCanvasesRef,
    remoteImages: new Map(),
    hasImage: false,
    toggleCamera: () => setCamera((value) => !value),
    switchCamera: () => setSwitches((value) => value + 1),
  } as unknown as ComponentProps<typeof CallOverlay>["video"];
  const recording = {
    automatic,
    kind,
    state: recordingState,
    ready: true,
    busy:
      recordingState === "starting" ||
      recordingState === "recording" ||
      recordingState === "saving",
    seconds: 42,
    error: recordingState === "error" ? "録音デバイスを開けませんでした" : undefined,
    setAutomatic,
    setKind,
    start: () => setRecordingState(scenario === "recording-error" ? "error" : "recording"),
    stop: () => setRecordingState("saved"),
  } as unknown as ComponentProps<typeof CallRecordingControls>["recording"];
  return (
    <div
      data-call-fixture
      className={
        native ? "contents" : "fixed inset-0 z-[100] flex bg-[var(--vy-bg)] text-[var(--vy-text)]"
      }
    >
      <div className="min-w-0 flex-1" aria-label="トーク表示領域" />
      <output className="sr-only">
        {JSON.stringify({ muted, switches, closed, camera, automatic, kind, recordingState })}
      </output>
      {!closed && (
        <NativeControllerSurface
          native={native}
          persistent
          title={name}
          onClose={() => setClosed(true)}
          onSnapshot={(snapshot, retiredId) => publishControllerCall(null, snapshot, retiredId)}
        >
          <CallPanel
            name={name}
            onClose={() => setClosed(true)}
            recordingSummary={recordingState === "recording" ? "録音中 · 0:42" : undefined}
          >
            <CallOverlay
              modal={false}
              kind={scenario === "video" || scenario === "group-video" ? "video" : "voice"}
              name={name}
              glyph="確"
              color="#638CBA"
              state={state}
              error={
                scenario === "failed" ? "接続を確認してから、もう一度お試しください。" : undefined
              }
              onClose={() => setClosed(true)}
              onMutedChange={setMuted}
              video={video}
              participants={
                scenario === "group" || scenario === "group-video"
                  ? Array.from({ length: 12 }, (_, index) => ({
                      id: `fixture-${index}`,
                      name: `長い名前の通話参加者 ${index + 1}`,
                      glyph: String(index + 1),
                    color: "#7292A9",
                    imageUrl: index < 2 ? "/demo/sticker-sun.svg" : undefined,
                      self: index === 0,
                    }))
                  : undefined
              }
              recordingControls={
                <CallRecordingControls recording={recording} connected={state === "in-call"} />
              }
            />
          </CallPanel>
        </NativeControllerSurface>
      )}
    </div>
  );
}
