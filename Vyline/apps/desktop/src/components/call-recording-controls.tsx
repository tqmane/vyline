import type { useCallRecording } from "@/hooks/useCallRecording";

export function CallRecordingControls({
  recording,
  connected,
}: { recording: ReturnType<typeof useCallRecording>; connected: boolean }) {
  const active = recording.state === "recording";
  const pending = recording.state === "starting" || recording.state === "saving";
  const button =
    "min-h-11 rounded-lg border border-[var(--vy-border)] px-3 text-xs aria-pressed:border-[var(--vy-accent)] aria-pressed:bg-[var(--vy-surface-2)] aria-pressed:text-[var(--vy-accent)] disabled:opacity-40";
  return (
    <details
      aria-label="録音・録画"
      className="vy-call-recording w-full max-w-xl shrink-0"
      open={active || pending || !!recording.error}
    >
      <summary className="min-h-11 cursor-pointer py-3 text-center text-xs text-[var(--vy-text-dim)]">
        {recording.error
          ? `記録エラー：${recording.error}`
          : active
            ? `${recording.kind === "audio" ? "録音" : "録画"}中 · ${Math.floor(recording.seconds / 60)}:${String(recording.seconds % 60).padStart(2, "0")}`
            : pending
              ? recording.state === "starting"
                ? "記録を準備中…"
                : "記録を保存中…"
              : "録音・録画"}
      </summary>
      <div className="space-y-2 pb-2">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <div role="group" aria-label="記録モード" className="flex gap-1">
            <button
              type="button"
              className={button}
              aria-pressed={!recording.automatic}
              disabled={!recording.ready || pending}
              onClick={() => recording.setAutomatic(false)}
            >
              手動
            </button>
            <button
              type="button"
              className={button}
              aria-pressed={recording.automatic}
              disabled={!recording.ready || pending}
              onClick={() => recording.setAutomatic(true)}
            >
              自動
            </button>
          </div>
          <div role="group" aria-label="記録形式" className="flex gap-1">
            <button
              type="button"
              className={button}
              aria-pressed={recording.kind === "audio"}
              disabled={!recording.ready || recording.busy}
              onClick={() => recording.setKind("audio")}
            >
              録音
            </button>
            <button
              type="button"
              className={button}
              aria-pressed={recording.kind === "video"}
              disabled={!recording.ready || recording.busy}
              onClick={() => recording.setKind("video")}
            >
              録画
            </button>
          </div>
          {active || pending ? (
            <button
              type="button"
              className={`${button} text-[var(--vy-danger)]`}
              disabled={recording.state === "saving"}
              onClick={recording.stop}
            >
              {recording.state === "saving" ? "保存中…" : "記録を停止"}
            </button>
          ) : (
            <button
              type="button"
              className={`${button} bg-[var(--vy-accent)] font-medium text-[var(--vy-accent-contrast)]`}
              disabled={!connected || !recording.ready || recording.busy}
              onClick={recording.start}
            >
              {recording.kind === "audio" ? "録音を開始" : "録画を開始"}
            </button>
          )}
        </div>
        <p
          role="status"
          className={`text-center text-xs ${recording.error ? "text-[var(--vy-danger)]" : "text-[var(--vy-text-dim)]"}`}
        >
          {recording.error ??
            (active
              ? `${recording.kind === "audio" ? "録音" : "録画"}中 · ${Math.floor(recording.seconds / 60)}:${String(recording.seconds % 60).padStart(2, "0")}`
              : pending
                ? "記録を処理中です。通話は終了できます。"
                : recording.waiting
                  ? "自動記録：ほかの参加者を待っています"
                  : recording.automatic
                    ? "自動記録が有効です"
                    : recording.state === "saved"
                      ? "保存済み · 設定 → 通話記録"
                      : "相手の同意を得て使用してください")}
        </p>
      </div>
    </details>
  );
}
