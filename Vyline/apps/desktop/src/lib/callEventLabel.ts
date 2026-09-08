import type { CallMessageMeta } from "./store-types";

function formatDuration(sec?: number): string | null {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return null;
  const s = Math.round(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m <= 0) return `${r}秒`;
  return `${m}分${r.toString().padStart(2, "0")}秒`;
}

export function callEventLabel(meta: CallMessageMeta): { title: string; detail?: string } {
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

