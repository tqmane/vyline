import { cn } from "@/lib/utils";
import type { CallMessageMeta } from "@/lib/store-types";
import { IconPhone, IconVideo } from "@/components/icons";

function formatDuration(sec?: number): string | null {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return null;
  const s = Math.round(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m <= 0) return `${r}秒`;
  return `${m}分${r.toString().padStart(2, "0")}秒`;
}

function labelFor(meta: CallMessageMeta): { title: string; detail?: string } {
  const kind = meta.group
    ? meta.video
      ? "グループビデオ通話"
      : "グループ音声通話"
    : meta.video
      ? "ビデオ通話"
      : "音声通話";
  const dur = formatDuration(meta.durationSec);
  if (meta.group && meta.outcome === "ended") return { title: "グループ通話が終了しました" };
  switch (meta.outcome) {
    case "started":
      return { title: `${kind}が開始されました` };
    case "unknown":
      return { title: `${kind}の通知` };
    case "missed":
      return { title: `不在着信 · ${kind}` };
    case "declined":
      return { title: `拒否 · ${kind}` };
    case "busy":
      return { title: `話中 · ${kind}` };
    case "cancelled":
      return { title: `発信キャンセル · ${kind}` };
    case "no-answer":
      return { title: `応答なし · ${kind}` };
    default:
      return {
        title: kind,
        detail: dur ? `通話時間 ${dur}` : "通話が終了しました",
      };
  }
}

type JoinProps = { onJoin?: () => void; joining?: boolean };

function JoinButton({ onJoin, joining }: JoinProps) {
  return (
    <button
      type="button"
      onClick={onJoin}
      disabled={joining}
      className="vy-touch-target shrink-0 rounded-lg bg-[var(--vy-accent)] px-4 py-2 text-xs font-semibold text-[var(--vy-accent-contrast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)] focus-visible:ring-offset-2 disabled:opacity-50"
    >
      参加
    </button>
  );
}

export function GroupCallBanner({
  memberCount,
  video,
  onJoin,
  joining,
}: JoinProps & { memberCount: number; video: boolean }) {
  return (
    <div
      className="flex items-center gap-3 border-b border-[var(--vy-border)] bg-[var(--vy-surface)] px-4 py-2"
      aria-label="進行中のグループ通話"
    >
      <span className="text-[var(--vy-accent)]" aria-hidden>
        {video ? <IconVideo size={20} /> : <IconPhone size={20} />}
      </span>
      <span className="min-w-0 flex-1 text-sm text-[var(--vy-text)]">
        {memberCount > 0 ? `${memberCount}人で` : "グループ"}
        {video ? "ビデオ通話中" : "音声通話中"}
      </span>
      <JoinButton onJoin={onJoin} joining={joining} />
    </div>
  );
}

export function CallEventMessage({
  meta,
  isMe,
  onJoin,
  joining,
}: { meta?: CallMessageMeta; isMe?: boolean } & JoinProps) {
  const resolved: CallMessageMeta = meta ?? {
    video: false,
    group: false,
    outcome: "ended",
  };
  const { title, detail } = labelFor(resolved);
  const missed = ["missed", "declined", "cancelled", "no-answer"].includes(resolved.outcome);

  return (
    <div className="my-2 flex w-full justify-center px-2">
      <div
        className={cn(
          "inline-flex max-w-[min(100%,300px)] flex-wrap items-center gap-2 border border-[var(--vy-border)] bg-[color-mix(in_oklab,var(--vy-surface)_92%,transparent)] px-3 py-1.5",
          resolved.group && resolved.outcome === "started" ? "rounded-2xl" : "rounded-full",
          missed && "text-[var(--vy-danger)]",
        )}
        role="status"
        aria-label={title}
      >
        <span
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
            missed
              ? "bg-[color-mix(in_oklab,var(--vy-danger)_14%,transparent)] text-[var(--vy-danger)]"
              : "bg-[color-mix(in_oklab,var(--vy-accent)_14%,transparent)] text-[var(--vy-accent)]",
          )}
        >
          {resolved.video ? <IconVideo size={15} /> : <IconPhone size={15} />}
        </span>
        <div className="min-w-0 flex-1 text-left">
          <div className={cn("text-xs font-semibold", !missed && "text-[var(--vy-text)]")}>
            {title}
          </div>
          {detail && (
            <div className="text-[0.68rem] text-[var(--vy-text-dim)]">
              {isMe ? `あなた · ${detail}` : detail}
            </div>
          )}
        </div>
        {resolved.group && resolved.outcome === "started" && onJoin && (
          <div className="w-full border-t border-[var(--vy-border)] pt-2 text-right">
            <JoinButton onJoin={onJoin} joining={joining} />
          </div>
        )}
      </div>
    </div>
  );
}
