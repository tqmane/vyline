// Adapted from NezuUI (MIT); source revision and license are in NOTICE.md.
import {
  useState,
  type ButtonHTMLAttributes,
  type ComponentPropsWithRef,
  type ReactNode,
} from "react";
import "./nezu.css";

export function FloatNotice({ children }: { children: ReactNode }) {
  return (
    <div className="nezu-float-notice" role="status">
      <div>{children}</div>
    </div>
  );
}

export type ToggleProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "onClick"> & {
  checked: boolean;
  label?: string;
  onCheckedChange: (checked: boolean) => void;
};

export function Toggle({ checked, label, onCheckedChange, className = "", ...props }: ToggleProps) {
  return (
    <button
      {...props}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label ?? props["aria-label"]}
      className={`nezu-toggle ${className}`}
      onClick={() => onCheckedChange(!checked)}
    >
      <span className="nezu-toggle-track" aria-hidden="true">
        <span />
      </span>
    </button>
  );
}

export type AvatarProps = {
  alt?: string;
  color: string;
  glyph?: string;
  imageUrl?: string;
  online?: boolean;
  ring?: boolean;
  size?: number;
  icon?: ReactNode;
};

export function Avatar({
  alt = "",
  color,
  glyph = "",
  imageUrl,
  online,
  ring,
  size = 44,
  icon,
}: AvatarProps) {
  const [failedImage, setFailedImage] = useState<string>();
  return (
    <span
      className="nezu-avatar"
      data-ring={ring || undefined}
      style={{ width: size, height: size }}
    >
      {imageUrl && imageUrl !== failedImage ? (
        <img src={imageUrl} alt={alt} onError={() => setFailedImage(imageUrl)} />
      ) : (
        <span
          role={alt ? "img" : undefined}
          aria-label={alt || undefined}
          aria-hidden={alt ? undefined : true}
          className="nezu-avatar-fallback"
          style={{
            background: `linear-gradient(145deg, ${color}, color-mix(in oklab, ${color} 55%, #000))`,
            fontSize: size * 0.5,
          }}
        >
          {icon ?? glyph}
        </span>
      )}
      {online && <span className="nezu-avatar-online" role="img" aria-label="オンライン" />}
    </span>
  );
}

export function OfficialBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`nezu-official-badge ${className}`}
      role="img"
      aria-label="公式アカウント"
      title="公式アカウント"
    >
      <svg viewBox="0 0 24 24" width="10" height="10" aria-hidden="true">
        <path d="m5 12.5 4.5 4.5L19 7" />
      </svg>
    </span>
  );
}

export function PremiumBadge({
  compact = false,
  size = 14,
  className = "",
}: { compact?: boolean; size?: number; className?: string }) {
  return (
    <span
      className={`nezu-premium-badge ${className}`}
      role="img"
      aria-label="LYP Premium"
      title="LYP Premium"
      style={{ width: size, height: size, fontSize: Math.max(8, size * 0.56) }}
    >
      {!compact && "P"}
    </span>
  );
}

/** The host supplies its real editor, attachments, and controls as children. */
export function ComposerSurface({
  children,
  dragging,
  focused,
  className = "",
  ...props
}: ComponentPropsWithRef<"div"> & { dragging?: boolean; focused?: boolean }) {
  return (
    <div
      {...props}
      className={`nezu-composer-surface ${className}`}
      data-dragging={dragging || undefined}
      data-focused={focused || undefined}
    >
      {children}
    </div>
  );
}
