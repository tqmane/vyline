import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/vy-ui";
import { IconPhone, IconVideo, IconMic, IconMicOff, IconRefresh } from "@/components/icons";
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
}) {
  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const connected = state === "in-call";
  const showVideo = kind === "video" || video.localEnabled || video.remoteEnabled;
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const previous = document.activeElement;
    Array.from(
      dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [],
    )
      .find((button) => button.getClientRects().length > 0)
      ?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

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
      role="dialog"
      ref={dialogRef}
      aria-label={`${name}との通話`}
      aria-modal="true"
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
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
      className="vy-fade-in absolute inset-0 z-[60] flex min-h-0 flex-col items-center justify-start gap-4 overflow-y-auto bg-[var(--vy-bg)]/95 px-4 py-5 backdrop-blur-xl"
    >
      <div
        className={`flex shrink-0 flex-col items-center justify-center gap-3 text-center ${showVideo ? "" : "mt-auto"}`}
      >
        <div className={`relative ${video.hasImage || video.localEnabled ? "hidden" : ""}`}>
          {!connected && state !== "failed" && (
            <span
              className="absolute -inset-3 animate-ping rounded-full"
              style={{
                background: `color-mix(in oklab, ${color} 30%, transparent)`,
              }}
              aria-hidden
            />
          )}
          <Avatar glyph={glyph} color={color} size={128} imageUrl={imageUrl} />
        </div>
        <div>
          <h2 className="text-2xl font-bold">{name}</h2>
          <p className="mt-2 text-sm text-[var(--vy-text-dim)]">
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

      <div className={`flex min-h-52 w-full flex-1 justify-center ${showVideo ? "" : "hidden"}`}>
        <CallVideoStage
          tiles={[
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
                      {video.remoteEnabled ? "相手の映像を待っています…" : "相手のカメラはオフです"}
                    </p>
                  )}
                </>
              ),
            },
            {
              id: "self",
              name: "自分",
              visible: video.localEnabled,
              content: (
                <video
                  ref={video.localRef}
                  autoPlay
                  muted
                  playsInline
                  aria-label="自分のカメラプレビュー"
                  className={`h-full w-full object-contain ${video.localEnabled ? "" : "hidden"}`}
                />
              ),
            },
          ]}
        />
      </div>

      {video.error && (
        <p role="status" className="max-w-xl shrink-0 text-center text-sm text-[var(--vy-danger)]">
          {video.error}
        </p>
      )}

      <div
        className={`flex shrink-0 flex-wrap items-center justify-center gap-3 ${showVideo ? "" : "mb-auto"}`}
      >
        <button
          type="button"
          onClick={() => setMuted((m) => !m)}
          aria-label={muted ? "ミュート解除" : "ミュート"}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--vy-surface-2)] text-[var(--vy-text)] transition-transform hover:scale-105 active:scale-95"
        >
          {muted ? <IconMicOff size={22} /> : <IconMic size={22} />}
        </button>
        {connected && (
          <button
            type="button"
            onClick={video.toggleCamera}
            disabled={!video.available || video.busy}
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
            className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--vy-surface-2)] text-[var(--vy-text)] transition-transform hover:scale-105 active:scale-95 disabled:opacity-40"
          >
            <IconVideo size={22} />
          </button>
        )}
        {connected && video.localEnabled && (
          <button
            type="button"
            onClick={video.switchCamera}
            disabled={video.busy}
            aria-label="前後のカメラを切り替え"
            title="前後のカメラを切り替え"
            className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--vy-surface-2)] text-[var(--vy-text)] disabled:opacity-40"
          >
            <IconRefresh size={22} />
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="通話を終了"
          className="flex h-16 w-16 rotate-[135deg] items-center justify-center rounded-full text-white transition-transform hover:scale-105 active:scale-95"
          style={{ background: "var(--vy-danger)" }}
        >
          <IconPhone size={26} />
        </button>
      </div>
      {connected && !video.localEnabled && video.available && (
        <p className="shrink-0 text-center text-xs text-[var(--vy-text-dim)]">
          カメラボタンで映像を開始できます。音声通話はそのまま続きます。
        </p>
      )}
    </div>
  );
}
