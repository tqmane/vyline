import { cn } from "@/lib/utils";
import { PremiumBadge as NezuPremiumBadge } from "@/ui/nezu";
import { useDesignSystemStore } from "@/ui/design-system-store";

export function PremiumBadge({
  className,
  size = 14,
  compact = false,
}: {
  className?: string;
  size?: number;
  compact?: boolean;
}) {
  const mode = useDesignSystemStore((state) => state.mode);
  if (mode === "nezu")
    return <NezuPremiumBadge className={className} size={size} compact={compact} />;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white shadow-sm",
        className,
      )}
      style={{
        width: size,
        height: size,
        background: "linear-gradient(145deg, #a855f7, #6d28d9)",
        fontSize: Math.max(8, size * 0.56),
      }}
      aria-label="LYP Premium"
      title="LYP Premium"
    >
      {compact ? "" : "P"}
    </span>
  );
}
