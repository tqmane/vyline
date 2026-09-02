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
      : "グループ通話"
    : meta.video
      ? "ビデオ通話"
      : "音声通話";
  const dur = formatDuration(meta.durationSec);
  switch (meta.outcome) {
    case "missed":
      return { title: `不在着信 · ${kind}` };
    case "declined":
      return { title: `拒否 · ${kind}` };
    case "busy":
      return { title: `話中 · ${kind}` };
    default:
      return {
        title: kind,
        detail: dur ? `通話時間 ${dur}` : "通話が終了しました",
      };
  }
}

export function CallEventMessage({ meta, isMe }: { meta?: CallMessageMeta; isMe?: boolean }) {
  const resolved: CallMessageMeta = meta ?? {
    video: false,
    group: false,
    outcome: "ended",
  };
  const { title, detail } = labelFor(resolved);
  const missed = resolved.outcome === "missed" || resolved.outcome === "declined";

  return (
    <div className="my-2 flex w-full justify-center px-2">
      <div
        className="inline-flex max-w-[min(100%,320px)] items-center gap-2 px-1 py-1 text-[var(--vy-text-dim)]"
        role="status"
        aria-label={title}
      >
        <span
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
            missed
              ? "bg-[color-mix(in_oklab,var(--vy-danger)_14%,transparent)] text-[var(--vy-danger)]"
              : "bg-[color-mix(in_oklab,var(--vy-accent)_12%,transparent)] text-[var(--vy-accent)]",
          )}
        >
          {resolved.video ? <IconVideo size={13} /> : <IconPhone size={13} />}
        </span>
        <div className="min-w-0 text-left leading-tight">
          <div
            className={cn(
              "text-xs font-medium",
              missed ? "text-[var(--vy-danger)]" : "text-[var(--vy-text)]",
            )}
          >
            {title}
          </div>
          {detail && (
            <div className="mt-0.5 text-[0.68rem] text-[var(--vy-text-dim)]">
              {isMe ? `あなた · ${detail}` : detail}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
