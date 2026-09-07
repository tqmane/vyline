import { cn } from "@/lib/utils";
import { OfficialBadge as NezuOfficialBadge } from "@/ui/nezu";
import { useDesignSystemStore } from "@/ui/design-system-store";

/** 公式アカウントバッジ（緑の丸 + 白チェックマーク） */
export function OfficialBadge({ className }: { className?: string }) {
  const mode = useDesignSystemStore((state) => state.mode);
  if (mode === "nezu") return <NezuOfficialBadge className={className} />;
  return (
    <span
      className={cn(
        "ml-1 inline-flex shrink-0 items-center justify-center rounded-full",
        className,
      )}
      style={{
        width: 14,
        height: 14,
        background: "var(--vy-official, #06c755)",
      }}
      aria-label="公式アカウント"
      title="公式アカウント"
    >
      <svg
        viewBox="0 0 24 24"
        width="10"
        height="10"
        fill="none"
        stroke="#fff"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="m5 12.5 4.5 4.5L19 7" />
      </svg>
    </span>
  );
}
