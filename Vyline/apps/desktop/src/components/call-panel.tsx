import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { CallIcon } from "@/ui/call-icon";
import { useStore } from "@/lib/store";
import { CALL_PANEL_MIN_WIDTH, callPanelLayout } from "@/lib/callPanelLayout";
import { isComposeMode, useDesignSystemStore } from "@/ui/design-system-store";

/** Keep one mounted media tree while switching between a docked pane and a mobile call. */
export function CallPanel({
  name,
  recordingSummary,
  onClose,
  children,
}: { name: string; recordingSummary?: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const mode = useDesignSystemStore((state) => state.mode);
  const sidebarCollapsed = useStore((state) => state.sidebarCollapsed);
  const [space, setSpace] = useState({ total: 0, sidebar: 0, height: 0 });
  const [width, setWidth] = useState(400);
  const [minimized, setMinimized] = useState(false);
  const drag = useRef<{ id: number; x: number; width: number } | null>(null);
  const {
    docked,
    maximum,
    width: actualWidth,
  } = callPanelLayout(space.total, width, space.sidebar);
  const wide = docked && space.height >= 480;
  const resize = (next: number) =>
    setWidth(Math.max(CALL_PANEL_MIN_WIDTH, Math.min(maximum, next)));
  useLayoutEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const sidebar = parent.querySelector<HTMLElement>(".vy-chat-sidebar-pane");
    let observedDivider: HTMLElement | null = null;
    const media = window.matchMedia("(min-width: 768px)");
    const update = () => {
      const next = sidebar?.nextElementSibling;
      const divider =
        next instanceof HTMLElement && next.getAttribute("role") === "separator" ? next : null;
      // The divider is inserted/removed when the viewport crosses 768px.
      if (divider !== observedDivider) {
        if (observedDivider) observer.unobserve(observedDivider);
        if (divider) observer.observe(divider);
        observedDivider = divider;
      }
      // The host now includes the sidebar. Measure its real width and rem-sized
      // divider; Compose does its own container-responsive navigation instead.
      const reserved =
        !isComposeMode(mode) && media.matches && !sidebarCollapsed
          ? (sidebar?.getBoundingClientRect().width ?? 0) +
            (divider?.getBoundingClientRect().width ?? 0)
          : 0;
      const total = parent.clientWidth;
      const height = parent.clientHeight;
      setSpace((previous) =>
        previous.total === total && previous.sidebar === reserved && previous.height === height
          ? previous
          : { total, sidebar: reserved, height },
      );
    };
    const observer = new ResizeObserver(update);
    observer.observe(parent);
    if (sidebar) observer.observe(sidebar);
    const sidebarChildren = new MutationObserver(update);
    if (sidebar?.parentElement) sidebarChildren.observe(sidebar.parentElement, { childList: true });
    media.addEventListener("change", update);
    update();
    return () => {
      observer.disconnect();
      sidebarChildren.disconnect();
      media.removeEventListener("change", update);
    };
  }, [mode, sidebarCollapsed]);
  useEffect(() => {
    if (minimized)
      ref.current?.querySelector<HTMLButtonElement>('[aria-label="通話へ戻る"]')?.focus();
    else if (!wide)
      ref.current
        ?.querySelector<HTMLButtonElement>('[aria-label="通話を小さくしてトークを見る"]')
        ?.focus();
  }, [minimized, wide]);
  return (
    <section
      ref={ref}
      data-call-panel={minimized ? "minimized" : wide ? "docked" : "expanded"}
      role={!wide && !minimized ? "dialog" : "region"}
      aria-modal={!wide && !minimized ? true : undefined}
      aria-label={`${name}との通話`}
      className={
        minimized
          ? "fixed right-3 top-16 z-[65] w-72 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface)] shadow-lg"
          : wide
            ? "relative flex h-full min-h-0 shrink-0 flex-col border-l border-[var(--vy-border)] bg-[var(--vy-bg)]"
            : "fixed inset-0 z-[60] flex min-h-0 flex-col bg-[var(--vy-bg)]"
      }
      style={!minimized && wide ? { width: actualWidth } : undefined}
      onKeyDown={(event) => {
        if (wide || minimized || event.key !== "Tab") return;
        const focusable = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
          ) ?? [],
        ).filter((item) => item.getClientRects().length > 0);
        const first = focusable[0];
        const last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      {!minimized && wide && (
        <div
          role="separator"
          tabIndex={0}
          aria-label="通話ペインの幅を調整"
          aria-orientation="vertical"
          aria-valuemin={CALL_PANEL_MIN_WIDTH}
          aria-valuemax={Math.round(maximum)}
          aria-valuenow={Math.round(actualWidth)}
          className="absolute -left-1 top-0 z-[61] h-full w-2 touch-none cursor-col-resize bg-[var(--vy-border)] outline-offset-2 hover:bg-[var(--vy-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--vy-accent)]"
          title="ドラッグ・矢印キーで幅を調整。ダブルクリックでリセット"
          onPointerDown={(event) => {
            if (!event.isPrimary || event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.focus({ preventScroll: true });
            drag.current = { id: event.pointerId, x: event.clientX, width: actualWidth };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const start = drag.current;
            if (start?.id === event.pointerId) resize(start.width + start.x - event.clientX);
          }}
          onPointerUp={(event) => {
            drag.current = null;
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
          onLostPointerCapture={() => {
            drag.current = null;
          }}
          onDoubleClick={() => resize(400)}
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End", "Enter"].includes(event.key)) return;
            event.preventDefault();
            resize(
              event.key === "Home"
                ? CALL_PANEL_MIN_WIDTH
                : event.key === "End"
                  ? maximum
                  : event.key === "Enter"
                    ? 400
                    : actualWidth + (event.key === "ArrowLeft" ? 24 : -24),
            );
          }}
        />
      )}
      <header className="flex shrink-0 items-center gap-2 border-b border-[var(--vy-border)] px-3 py-1">
        {minimized ? (
          <button
            type="button"
            aria-label="通話へ戻る"
            onClick={() => setMinimized(false)}
            className="min-h-11 min-w-0 flex-1 py-1 text-left"
          >
            <span className="block truncate text-sm font-semibold">通話へ戻る · {name}</span>
            {recordingSummary && (
              <span className="block text-xs text-[var(--vy-danger)]">{recordingSummary}</span>
            )}
          </button>
        ) : (
          <>
            <p className="min-w-0 flex-1 truncate text-sm font-medium">通話</p>
            <button
              type="button"
              aria-label="通話を小さくしてトークを見る"
              onClick={() => setMinimized(true)}
              className="min-h-11 rounded-lg px-3 text-xs hover:bg-[var(--vy-surface-2)]"
            >
              トークを見る
            </button>
          </>
        )}
        {minimized && (
          <button
            type="button"
            aria-label="通話を終了"
            onClick={onClose}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-[var(--vy-danger)]"
          >
            <CallIcon name="hangup" size={22} />
          </button>
        )}
      </header>
      <div className={`relative min-h-0 flex-1 ${minimized ? "hidden" : ""}`}>{children}</div>
    </section>
  );
}
