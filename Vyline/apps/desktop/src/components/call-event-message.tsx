import { cn } from "@/lib/utils";
import type { CallMessageMeta } from "@/lib/store-types";
import { IconPhone, IconVideo } from "@/components/icons";

import { callEventLabel } from "@/lib/callEventLabel";

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
  const { title, detail } = callEventLabel(resolved);
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
