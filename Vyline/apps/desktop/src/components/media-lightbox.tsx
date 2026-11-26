import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconClose, IconDownload } from "@/components/icons";
import { downloadUrl } from "@/utils/clipboard";
import { hideBrokenMedia } from "@/utils/lineMedia";
import { useControllerPortalTarget } from "@/ui/native-controller-surface";

function withDownloadQuery(url: string): string {
  if (!url.startsWith("/api/") && !/^https?:\/\//i.test(url)) return url;
  if (/[?&]download=1(?:&|$)/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}download=1`;
}

export function MediaLightbox({
  src,
  fullSrc,
  kind = "image",
  alt = "メディア",
  downloadName,
  onDownloadAll,
  downloadAllCount,
  onClose,
}: {
  src: string;
  /** フル解像度（無ければ src） */
  fullSrc?: string;
  kind?: "image" | "video";
  alt?: string;
  downloadName?: string;
  onDownloadAll?: () => void;
  downloadAllCount?: number;
  onClose: () => void;
}) {
  const url = fullSrc || src.replace(/([?&])preview=1(?=&|#|$)/, "$1preview=0");
  const downloadHref = withDownloadQuery(url);
  const resolvedDownloadName =
    downloadName || (kind === "video" ? "vyline_video.mp4" : "vyline_image.jpg");

  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{
    startDist: number;
    startScale: number;
    startX: number;
    startY: number;
    startCenterX: number;
    startCenterY: number;
  } | null>(null);
  const moved = useRef(false);
  const viewport = useRef<HTMLDivElement>(null);

  const clampView = useCallback((scale: number, x: number, y: number) => {
    const bounds = viewport.current?.getBoundingClientRect();
    const image = viewport.current?.querySelector("img");
    const baseW = image?.offsetWidth || image?.clientWidth || 0;
    const baseH = image?.offsetHeight || image?.clientHeight || 0;
    const maxX = Math.max(0, (baseW * scale - (bounds?.width ?? 0)) / 2);
    const maxY = Math.max(0, (baseH * scale - (bounds?.height ?? 0)) / 2);
    return { scale, x: Math.max(-maxX, Math.min(maxX, x)), y: Math.max(-maxY, Math.min(maxY, y)) };
  }, []);

  const toggleZoom = () => setView((current) => ({ scale: current.scale > 1 ? 1 : 2, x: 0, y: 0 }));
  const dialogRef = useRef<HTMLDialogElement>(null);
  const controllerTarget = useControllerPortalTarget();

  useLayoutEffect(() => {
    if (controllerTarget) return;
    const dialog = dialogRef.current!;
    dialog.showModal();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = prev;
    };
  }, [controllerTarget]);

  useEffect(() => {
    const el = viewport.current;
    if (!el || kind === "video") return;

    const touchPair = (touches: TouchList) => {
      const a = touches[0]!;
      const b = touches[1]!;
      return {
        dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        centerX: (a.clientX + b.clientX) / 2,
        centerY: (a.clientY + b.clientY) / 2,
      };
    };

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) return;
      event.preventDefault();
      moved.current = true;
      const { dist, centerX, centerY } = touchPair(event.touches);
      const current = viewRef.current;
      pinchRef.current = {
        startDist: Math.max(1, dist),
        startScale: current.scale,
        startX: current.x,
        startY: current.y,
        startCenterX: centerX,
        startCenterY: centerY,
      };
    };

    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 2) return;
      event.preventDefault();
      moved.current = true;
      const { dist, centerX, centerY } = touchPair(event.touches);
      if (!pinchRef.current) {
        const current = viewRef.current;
        pinchRef.current = {
          startDist: Math.max(1, dist),
          startScale: current.scale,
          startX: current.x,
          startY: current.y,
          startCenterX: centerX,
          startCenterY: centerY,
        };
        return;
      }
      const p = pinchRef.current;
      const nextScale = Math.max(1, Math.min(4, p.startScale * (dist / p.startDist)));
      const dx = centerX - p.startCenterX;
      const dy = centerY - p.startCenterY;
      setView(clampView(nextScale, p.startX + dx, p.startY + dy));
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length < 2) {
        pinchRef.current = null;
      }
    };

    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.01);
      setView((current) => clampView(Math.max(1, Math.min(4, current.scale * factor)), current.x, current.y));
    };

    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
      el.removeEventListener("wheel", onWheel);
    };
  }, [clampView, kind]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <dialog
      open={controllerTarget ? true : undefined}
      ref={dialogRef}
      style={{ touchAction: "none" }}
      className="vy-fade-in fixed inset-0 m-0 flex h-dvh max-h-none w-screen max-w-none items-center justify-center border-0 bg-black/85 p-4 backdrop-blur-sm backdrop:bg-transparent"
      aria-label={alt}
      onClick={onClose}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <div
        className="absolute right-4 top-4 z-10 flex items-center gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        {onDownloadAll && downloadAllCount != null && downloadAllCount > 1 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDownloadAll();
            }}
            aria-label={`すべて保存 (${downloadAllCount}枚)`}
            className="flex h-10 items-center gap-1.5 rounded-full bg-white/10 px-3.5 text-xs font-medium text-white transition-colors hover:bg-white/20"
          >
            <IconDownload size={16} />
            <span>すべて保存 ({downloadAllCount})</span>
          </button>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            downloadUrl(downloadHref, resolvedDownloadName);
          }}
          aria-label="ダウンロード"
          title="ダウンロード"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
        >
          <IconDownload size={20} />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="閉じる"
          title="閉じる"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
        >
          <IconClose size={20} />
        </button>
      </div>
      <div
        ref={viewport}
        style={{ touchAction: "none" }}
        className="flex h-[86dvh] w-[96vw] items-center justify-center overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {kind === "video" ? (
          <video
            src={url}
            playsInline
            controls
            autoPlay={!controllerTarget}
            data-native-autoplay={controllerTarget ? "true" : undefined}
            preload={controllerTarget ? "none" : undefined}
            className="max-h-[92dvh] max-w-full bg-black"
          />
        ) : (
          <button
            type="button"
            aria-label={`${alt}（クリック・ピンチでズーム、${Math.round(view.scale * 100)}%）`}
            data-zoom={view.scale}
            className="flex h-full w-full items-center justify-center border-0 bg-transparent p-0 select-none outline-none focus-visible:ring-2 focus-visible:ring-white"
            style={{
              touchAction: "none",
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
              cursor: view.scale > 1 ? "grab" : "zoom-in",
            }}
            onClick={(event) => {
              if (event.detail === 0 || !moved.current) toggleZoom();
            }}
            onKeyDown={(event) => {
              if (event.key.startsWith("Arrow") && view.scale > 1) {
                event.preventDefault();
                setView((current) =>
                  clampView(
                    current.scale,
                    current.x + (event.key === "ArrowLeft" ? 40 : event.key === "ArrowRight" ? -40 : 0),
                    current.y + (event.key === "ArrowUp" ? 40 : event.key === "ArrowDown" ? -40 : 0),
                  ),
                );
              }
            }}
            onPointerDown={(event) => {
              if (event.pointerType === "mouse" && event.button !== 0) return;
              if (pointers.current.size === 0) moved.current = false;
              pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
              try {
                event.currentTarget.setPointerCapture(event.pointerId);
              } catch {
                /* synthetic or unsupported pointer capture */
              }
            }}
            onPointerMove={(event) => {
              if (pinchRef.current) return;
              const before = [...pointers.current.values()];
              const last = pointers.current.get(event.pointerId);
              if (!last) return;
              const dx = event.clientX - last.x;
              const dy = event.clientY - last.y;
              pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
              if (Math.abs(dx) + Math.abs(dy) > 2) moved.current = true;
              if (before.length === 2) {
                moved.current = true;
                const after = [...pointers.current.values()];
                const oldDistance = Math.hypot(before[0]!.x - before[1]!.x, before[0]!.y - before[1]!.y);
                const distance = Math.hypot(after[0]!.x - after[1]!.x, after[0]!.y - after[1]!.y);
                setView((current) =>
                  clampView(
                    Math.max(1, Math.min(4, (current.scale * distance) / Math.max(1, oldDistance))),
                    current.x + dx / 2,
                    current.y + dy / 2,
                  ),
                );
              } else {
                setView((current) => clampView(current.scale, current.x + dx, current.y + dy));
              }
            }}
            onPointerUp={(event) => pointers.current.delete(event.pointerId)}
            onPointerCancel={(event) => {
              pointers.current.delete(event.pointerId);
              moved.current = true;
            }}
            onLostPointerCapture={(event) => pointers.current.delete(event.pointerId)}
          >
            <img
              src={url}
              alt={alt}
              onError={hideBrokenMedia}
              draggable={false}
              data-zoom={view.scale}
              className="max-h-full max-w-full object-contain pointer-events-none"
            />
          </button>
        )}
      </div>
    </dialog>,
    document.body,
  );
}
