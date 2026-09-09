import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Avatar } from "@/components/vy-ui";
import { CallIcon } from "@/ui/call-icon";
import type { CallUiState } from "@/utils/callAllowlist";
import type { useCallVideo } from "@/hooks/useCallVideo";
import { CallVideoStage } from "@/components/call-video-stage";

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function statusLabel(state: CallUiState, kind: "voice" | "video"): string {
  switch (state) {
    case "starting":
      return "発信準備中…";
    case "acquiring":
      return "ルート取得中…";
    case "connecting":
      return "接続中…";
    case "ringing":
      return "呼び出し中…（相手の応答を待っています）";
    case "in-call":
      return kind === "video" ? "ビデオ通話中" : "通話中";
    case "ending":
      return "終了中…";
    case "failed":
      return "接続失敗";
    case "ended":
      return "通話終了";
    default:
      return "準備中…";
  }
}

export function CallOverlay({
  kind,
  name,
  glyph,
  color,
  imageUrl,
  state,
  error,
  transport,
  onClose,
  onMutedChange,
  video,
  participants,
  recordingControls,
  modal = true,
}: {
  kind: "voice" | "video";
  name: string;
  glyph: string;
  color: string;
  imageUrl?: string;
  state: CallUiState;
  error?: string;
  transport?: string;
  onClose: () => void;
  onMutedChange?: (muted: boolean) => void;
  video: ReturnType<typeof useCallVideo>;
  recordingControls?: ReactNode;
  modal?: boolean;
  participants?: Array<{
    id: string;
    name: string;
    glyph: string;
    color: string;
    imageUrl?: string;
    self?: boolean;
    hasVideoStream?: boolean;
  }>;
}) {
  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const connected = state === "in-call";
  const showVideo = kind === "video" || video.localEnabled || video.remoteEnabled;
  const showParticipants = participants !== undefined && !showVideo;
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const cameraUnavailableId = useId();

  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement;
    Array.from(
      dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [],
    )
      .find((button) => button.getClientRects().length > 0)
      ?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [modal]);

  useEffect(() => {
    if (!connected) {
      setSeconds(0);
      return;
    }
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [connected]);

  useEffect(() => {
    onMutedChange?.(muted);
  }, [muted, onMutedChange]);

  return (
    <div
      role={modal ? "dialog" : undefined}
      ref={dialogRef}
      aria-label={modal ? `${name}との通話` : undefined}
      aria-modal={modal ? true : undefined}
      onKeyDown={(event) => {
        if (!modal || event.key !== "Tab") return;
        const buttons = Array.from(
          dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [],
        ).filter((button) => button.getClientRects().length > 0);
        const first = buttons?.[0];
        const last = buttons?.[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      className="vy-call-overlay vy-fade-in absolute inset-0 z-[60] flex min-h-0 flex-col items-center gap-3 overflow-hidden bg-[var(--vy-bg)]/95 px-4 py-4 backdrop-blur-xl"
    >
      <div className="vy-call-content flex min-h-0 w-full flex-1 flex-col items-center gap-4 overflow-y-auto overscroll-contain">
        <div
          data-native-call-summary
          data-call-name={name}
          data-call-glyph={glyph}
          data-call-avatar={imageUrl}
          data-call-status={
            error ?? statusLabel(state, video.localEnabled || video.remoteEnabled ? "video" : kind)
          }
          data-call-duration={connected ? fmt(seconds) : ""}
          data-call-show-avatar={!showVideo}
          className={`flex max-w-full shrink-0 flex-col items-center justify-center gap-3 text-center ${showVideo || showParticipants ? "" : "mt-auto"}`}
        >
          <div
            className={`relative ${showVideo ? "hidden" : ""} ${showParticipants ? "[@media(max-height:500px)]:hidden" : ""}`}
          >
            {!connected && state !== "failed" && (
              <span
                className="absolute -inset-3 animate-ping rounded-full"
                style={{
                  background: `color-mix(in oklab, ${color} 30%, transparent)`,
                }}
                aria-hidden
              />
            )}
            <Avatar
              glyph={glyph}
              color={color}
              size={showParticipants ? 64 : 128}
              imageUrl={imageUrl}
            />
          </div>
          <div className={showVideo ? "flex max-w-full items-baseline justify-center gap-3" : ""}>
            <h2
              className={`min-w-0 break-words font-bold [overflow-wrap:anywhere] ${showVideo ? "line-clamp-1 text-base" : "line-clamp-2 text-2xl"} ${showParticipants ? "[@media(max-height:500px)]:line-clamp-1" : ""}`}
              title={name}
            >
              {name}
            </h2>
            <p
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className={
                showVideo && !error
                  ? "sr-only"
                  : "mt-2 min-w-0 break-words text-sm text-[var(--vy-text-dim)] [overflow-wrap:anywhere]"
              }
            >
              {error ??
                statusLabel(state, video.localEnabled || video.remoteEnabled ? "video" : kind)}
            </p>
            {transport && <span className="sr-only">接続方式: {transport}</span>}
            {connected && (
              <p
                className="mt-1 font-mono text-lg tabular-nums"
                style={{ color: "var(--vy-accent)" }}
              >
                {fmt(seconds)}
              </p>
            )}
          </div>
        </div>

        {showParticipants && (
          <section
            aria-label="通話参加者"
            className="min-h-0 w-full max-w-4xl flex-1 overflow-y-auto"
          >
            <p role="status" className="mb-3 text-center text-sm text-[var(--vy-text-dim)]">
              {participants.length
                ? `参加者 ${participants.length}人`
                : connected
                  ? "参加者情報を取得中…"
                  : "接続を待っています…"}
            </p>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {participants.map((participant) => (
                <li
                  key={participant.id}
                  data-native-call-participant
                  data-call-name={participant.name}
                  data-call-glyph={participant.glyph}
                  data-call-avatar={participant.imageUrl}
                  data-call-color={participant.color}
                  data-call-status={participant.self && muted ? "ミュート中" : "参加中"}
                  className="flex min-w-0 flex-col items-center gap-2 rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface)] p-4 text-center"
                >
                  <div className="[@media(max-height:500px)]:hidden">
                    <Avatar
                      glyph={participant.glyph}
                      color={participant.color}
                      size={56}
                      imageUrl={participant.imageUrl}
                    />
                  </div>
                  <p
                    className="line-clamp-2 w-full break-words text-sm font-medium [overflow-wrap:anywhere]"
                    title={participant.name}
                  >
                    {participant.name}
                  </p>
                  <p className="flex items-center gap-1 text-xs text-[var(--vy-text-dim)]">
                    {participant.self && muted ? (
                      <>
                        <CallIcon name="muted" size={12} />
                        ミュート中
                      </>
                    ) : (
                      "参加中"
                    )}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div
          className={`flex min-h-56 w-full flex-1 shrink-0 justify-center ${showVideo ? "" : "hidden"}`}
        >
          <CallVideoStage
            tiles={[
              ...(participants
                ? participants
                    .filter((p) => !p.self)
                    .map((participant) => ({
                      id: participant.id,
                      name: participant.name,
                      visible: true,
                      content: (
                        <>
                          <canvas
                            ref={(canvas) => {
                              if (canvas)
                                video.remoteCanvasesRef.current.set(participant.id, canvas);
                              else video.remoteCanvasesRef.current.delete(participant.id);
                            }}
                            aria-label={`${participant.name}の映像`}
                            className={`h-full w-full object-contain ${video.remoteImages.has(participant.id) ? "" : "invisible"}`}
                          />
                          {!video.remoteImages.has(participant.id) && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center text-sm text-white/70">
                              <Avatar
                                glyph={participant.glyph}
                                color={participant.color}
                                size={56}
                                imageUrl={participant.imageUrl}
                              />
                              <p>
                                {participant.hasVideoStream
                                  ? "映像を待っています…"
                                  : "カメラはオフです"}
                              </p>
                            </div>
                          )}
                        </>
                      ),
                    }))
                : [
                    {
                      id: "peer",
                      name,
                      visible: true,
                      content: (
                        <>
                          <canvas
                            ref={video.remoteRef}
                            aria-label="相手の映像"
                            className={`h-full w-full object-contain ${video.hasImage ? "" : "invisible"}`}
                          />
                          {!video.hasImage && (
                            <p className="absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-white/70">
                              {video.remoteEnabled
                                ? "相手の映像を待っています…"
                                : "相手のカメラはオフです"}
                            </p>
                          )}
                        </>
                      ),
                    },
                  ]),
              {
                id: "self",
                name: "自分",
                visible: participants !== undefined || video.localEnabled,
                content: (
                  <>
                    <video
                      ref={video.localRef}
                      autoPlay
                      muted
                      playsInline
                      aria-label="自分のカメラプレビュー"
                      className={`h-full w-full object-contain ${video.localEnabled ? "" : "hidden"}`}
                    />
                    {participants !== undefined && !video.localEnabled && (
                      <p className="absolute inset-0 flex items-center justify-center text-sm text-white/70">
                        カメラはオフです
                      </p>
                    )}
                  </>
                ),
              },
            ]}
          />
        </div>

        {connected && !video.available && (
          <p
            id={cameraUnavailableId}
            className="shrink-0 text-center text-xs text-[var(--vy-text-dim)]"
          >
            相手または接続方式がビデオに対応していないため、カメラは利用できません。
          </p>
        )}
        {video.error && (
          <p
            role="status"
            className="max-w-xl shrink-0 text-center text-sm text-[var(--vy-danger)]"
          >
            {video.error}
          </p>
        )}
      </div>

      {recordingControls}

      <div
        data-native-call-controls
        className="vy-call-controls flex w-full shrink-0 items-start justify-center gap-3"
        role="group"
        aria-label="通話操作"
      >
        <button
          type="button"
          onClick={() => setMuted((m) => !m)}
          aria-label={muted ? "ミュート解除" : "ミュート"}
          aria-pressed={muted}
          className="vy-call-control"
        >
          <span className="vy-call-control-face">
            <CallIcon name={muted ? "muted" : "mic"} />
          </span>
          <span>{muted ? "解除" : "ミュート"}</span>
        </button>
        {connected && (
          <button
            type="button"
            onClick={video.toggleCamera}
            disabled={!video.available || video.busy}
            aria-describedby={!video.available ? cameraUnavailableId : undefined}
            aria-busy={video.busy}
            aria-pressed={video.localEnabled}
            aria-label={
              video.localEnabled ? "カメラを停止" : "カメラを開始してビデオ通話に切り替え"
            }
            title={
              video.available
                ? video.localEnabled
                  ? "カメラを停止"
                  : "カメラを開始"
                : "相手または接続方式がビデオに対応していません"
            }
            className="vy-call-control disabled:opacity-40"
          >
            <span className="vy-call-control-face">
              <CallIcon name={video.localEnabled ? "video" : "videoOff"} />
            </span>
            <span>カメラ</span>
          </button>
        )}
        {connected && video.localEnabled && (
          <button
            type="button"
            onClick={video.switchCamera}
            disabled={video.busy}
            aria-label="前後のカメラを切り替え"
            title="前後のカメラを切り替え"
            className="vy-call-control disabled:opacity-40"
          >
            <span className="vy-call-control-face">
              <CallIcon name="cameraSwitch" />
            </span>
            <span>切り替え</span>
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label={state === "failed" || state === "ended" ? "通話画面を閉じる" : "通話を終了"}
          className="vy-call-control"
        >
          <span className="vy-call-control-face vy-call-end">
            <CallIcon name="hangup" />
          </span>
          <span>{state === "failed" || state === "ended" ? "閉じる" : "終了"}</span>
        </button>
      </div>
      {connected && !video.localEnabled && video.available && (
        <p className="shrink-0 text-center text-xs text-[var(--vy-text-dim)] [@media(max-height:500px)]:sr-only">
          カメラボタンで映像を開始できます。音声通話はそのまま続きます。
        </p>
      )}
    </div>
  );
}
