import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

export type CallVideoTile = {
  id: string;
  name: string;
  content: ReactNode;
  visible: boolean;
};
type Layout = "focus" | "split" | "grid";
const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** Layout only: media elements keep their keyed parent, refs and streams across every change. */
export function CallVideoStage({ tiles }: { tiles: CallVideoTile[] }) {
  const [layout, setLayout] = useState<Layout>("focus");
  const [focused, setFocused] = useState<string>();
  const [order, setOrder] = useState<string[]>([]);
  const [position, setPosition] = useState({ x: 1, y: 1 });
  const [page, setPage] = useState(0);
  const [size, setSize] = useState({ width: 320, height: 480 });
  const stageRef = useRef<HTMLDivElement>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ width, height });
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    start: typeof position;
    width: number;
    height: number;
  } | null>(null);
  const dragged = useRef(false);
  const visible = tiles.filter((tile) => tile.visible);
  const ordered = [
    ...order.filter((id) => visible.some((tile) => tile.id === id)),
    ...visible.filter((tile) => !order.includes(tile.id)).map((tile) => tile.id),
  ];
  const mainId = focused && ordered.includes(focused) ? focused : ordered[0];
  const miniId = ordered.find((id) => id !== mainId);
  const floating = layout === "focus" && visible.length === 2;
  const groupFocus = layout === "focus" && visible.length > 2;
  const narrow = size.width < 600;
  const capacity = groupFocus
    ? narrow
      ? 2
      : Math.max(1, Math.min(4, Math.floor(size.height / 100)))
    : size.width >= 960 && size.height >= 400
      ? 16
      : size.width >= 600 && size.height >= 300
        ? 9
        : 4;
  const pagedIds = groupFocus ? ordered.filter((id) => id !== mainId) : ordered;
  const pages = Math.max(1, Math.ceil(pagedIds.length / capacity));
  const currentPage = Math.min(page, pages - 1);
  const pageIds = pagedIds.slice(currentPage * capacity, (currentPage + 1) * capacity);
  const columns =
    layout === "split" ? (narrow ? 1 : 2) : Math.max(1, Math.ceil(Math.sqrt(pageIds.length)));
  useEffect(() => {
    setPage((value) => Math.min(value, pages - 1));
  }, [pages]);
  const changeLayout = (value: Layout) => {
    setLayout(value);
    setPage(0);
  };
  const miniStyle: CSSProperties = {
    left: `calc(${position.x * 100}% + ${12 - position.x * 24}px)`,
    top: `calc(${position.y * 100}% + ${12 - position.y * 24}px)`,
    transform: `translate(${-position.x * 100}%, ${-position.y * 100}%)`,
    width: "clamp(7rem, 25%, 10rem)",
    maxWidth: "calc(100% - 24px)",
    aspectRatio: "16 / 9",
  };
  const swap = () => {
    if (miniId) setFocused(miniId);
  };
  const move = (id: string, direction: number) => {
    const next = [...ordered];
    const index = next.indexOf(id);
    const other = index + direction;
    if (other < 0 || other >= next.length) return;
    [next[index], next[other]] = [next[other], next[index]];
    setOrder(next);
  };

  return (
    <div className="flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-2">
      <div
        role="group"
        aria-label="映像レイアウト"
        className="flex shrink-0 flex-wrap justify-center gap-1"
      >
        {(
          [
            ["focus", "フォーカス"],
            ["split", "分割"],
            ...(tiles.length > 2 || layout === "grid" ? [["grid", "一覧"]] : []),
          ] as [Layout, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={layout === value}
            onClick={() => changeLayout(value)}
            className="min-h-11 whitespace-nowrap rounded-lg border border-[var(--vy-border)] px-3 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--vy-accent)] aria-pressed:bg-[var(--vy-accent)] aria-pressed:text-[var(--vy-accent-contrast)]"
          >
            {label}
          </button>
        ))}
        {layout !== "focus" && visible.length === 2 && (
          <button
            type="button"
            onClick={() => setOrder([...ordered].reverse())}
            className="min-h-10 rounded-lg border border-[var(--vy-border)] px-3 text-xs"
          >
            表示順を入れ替え
          </button>
        )}
      </div>
      <div
        ref={stageRef}
        data-call-stage={layout}
        onTouchStart={(event) => {
          const touch = event.touches[0];
          swipe.current =
            event.touches.length === 1 ? { x: touch.clientX, y: touch.clientY } : null;
        }}
        onTouchEnd={(event) => {
          const start = swipe.current;
          swipe.current = null;
          if (!start || floating || pages === 1) return;
          const touch = event.changedTouches[0];
          const dx = touch.clientX - start.x;
          if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(touch.clientY - start.y) * 1.5) return;
          setPage(Math.max(0, Math.min(pages - 1, currentPage + (dx < 0 ? 1 : -1))));
        }}
        onTouchCancel={() => {
          swipe.current = null;
        }}
        className={`relative min-h-40 w-full flex-1 gap-2 ${layout === "focus" && visible.length <= 2 ? "" : "grid"}`}
        style={
          groupFocus
            ? {
                gridTemplateColumns: narrow
                  ? "repeat(2, minmax(0, 1fr))"
                  : "minmax(0, 3fr) minmax(0, 1fr)",
                gridTemplateRows: narrow
                  ? "minmax(0, 3fr) minmax(0, 1fr)"
                  : `repeat(${pageIds.length}, minmax(0, 1fr))`,
              }
            : layout !== "focus"
              ? {
                  gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                  gridTemplateRows: `repeat(${Math.max(1, Math.ceil(pageIds.length / columns))}, minmax(0, 1fr))`,
                }
              : undefined
        }
      >
        {tiles.map((tile) => {
          const main = tile.id === mainId;
          const mini = floating && !main;
          const isHidden = !tile.visible || (!pageIds.includes(tile.id) && !(groupFocus && main));
          const singleFocus = layout === "focus" && visible.length <= 2;
          return (
            <div
              key={tile.id}
              data-call-tile={tile.id}
              className={`overflow-hidden rounded-xl border border-white/30 bg-black ${isHidden ? "hidden" : ""} ${singleFocus ? "absolute" : "relative"} ${mini ? "z-10 shadow-lg" : singleFocus ? "inset-0" : "min-h-0 min-w-0"}`}
              style={
                mini
                  ? { ...miniStyle, display: isHidden ? "none" : undefined }
                  : {
                      display: isHidden ? "none" : undefined,
                      order: ordered.indexOf(tile.id),
                      ...(groupFocus
                        ? main
                          ? {
                              gridColumn: narrow ? "1 / -1" : 1,
                              gridRow: narrow ? 1 : `1 / span ${pageIds.length}`,
                            }
                          : {
                              gridColumn: narrow ? pageIds.indexOf(tile.id) + 1 : 2,
                              gridRow: narrow ? 2 : undefined,
                            }
                        : {}),
                    }
              }
            >
              {tile.content}
              <span className="pointer-events-none absolute bottom-2 left-2 max-w-[calc(100%-1rem)] truncate rounded bg-black/75 px-2 py-1 text-xs text-white">
                {tile.name}
              </span>
              {!mini && visible.length > 1 && (
                <button
                  type="button"
                  aria-label={`${tile.name}の映像を固定`}
                  aria-pressed={main && layout === "focus"}
                  onClick={() => {
                    if (main && layout === "focus") {
                      setFocused(undefined);
                      changeLayout("grid");
                    } else {
                      setFocused(tile.id);
                      changeLayout("focus");
                    }
                  }}
                  className="absolute right-1 top-1 min-h-11 min-w-11 rounded-lg bg-black/65 px-2 text-xs text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
                >
                  {main && layout === "focus" ? "固定解除" : "固定"}
                </button>
              )}
              {layout !== "focus" && visible.length > 2 && (
                <div className="absolute bottom-9 left-1 flex gap-1">
                  <button
                    type="button"
                    aria-label={`${tile.name}を前へ移動`}
                    disabled={ordered[0] === tile.id}
                    onClick={() => move(tile.id, -1)}
                    className="min-h-11 min-w-11 rounded-lg bg-black/65 px-2 text-xs text-white disabled:opacity-40"
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    aria-label={`${tile.name}を後ろへ移動`}
                    disabled={ordered.at(-1) === tile.id}
                    onClick={() => move(tile.id, 1)}
                    className="min-h-11 min-w-11 rounded-lg bg-black/65 px-2 text-xs text-white disabled:opacity-40"
                  >
                    →
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {floating && (
          <button
            type="button"
            aria-label={miniId === "self" ? "自分の映像を大きく表示" : "相手の映像を大きく表示"}
            title="タップで入れ替え・ドラッグまたは矢印キーで移動"
            className="absolute z-20 touch-none cursor-grab rounded-xl outline-offset-2 active:cursor-grabbing focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
            style={miniStyle}
            onPointerDown={(event) => {
              if (!event.isPrimary || event.button !== 0) return;
              const area = stageRef.current!.getBoundingClientRect();
              const rect = event.currentTarget.getBoundingClientRect();
              dragged.current = false;
              drag.current = {
                id: event.pointerId,
                x: event.clientX,
                y: event.clientY,
                start: position,
                width: Math.max(1, area.width - rect.width - 24),
                height: Math.max(1, area.height - rect.height - 24),
              };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const start = drag.current;
              if (!start || start.id !== event.pointerId) return;
              const dx = event.clientX - start.x;
              const dy = event.clientY - start.y;
              if (Math.hypot(dx, dy) > 6) dragged.current = true;
              if (dragged.current)
                setPosition({
                  x: clamp(start.start.x + dx / start.width),
                  y: clamp(start.start.y + dy / start.height),
                });
            }}
            onPointerUp={(event) => {
              if (drag.current?.id !== event.pointerId) return;
              drag.current = null;
              event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => {
              drag.current = null;
              dragged.current = true;
            }}
            onLostPointerCapture={() => {
              drag.current = null;
            }}
            onClick={(event) => {
              if (event.detail !== 0 && dragged.current) {
                dragged.current = false;
                return;
              }
              swap();
            }}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
              event.preventDefault();
              const area = stageRef.current!.getBoundingClientRect();
              const rect = event.currentTarget.getBoundingClientRect();
              setPosition((p) => ({
                x: clamp(
                  p.x +
                    (event.key === "ArrowLeft" ? -16 : event.key === "ArrowRight" ? 16 : 0) /
                      Math.max(1, area.width - rect.width - 24),
                ),
                y: clamp(
                  p.y +
                    (event.key === "ArrowUp" ? -16 : event.key === "ArrowDown" ? 16 : 0) /
                      Math.max(1, area.height - rect.height - 24),
                ),
              }));
            }}
          />
        )}
      </div>
      {visible.length > 2 && (
        <div
          className="flex shrink-0 items-center justify-center gap-3"
          aria-label="参加者のページ"
        >
          <button
            type="button"
            aria-label="前のページ"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
            className="min-h-11 min-w-11 rounded-lg border border-[var(--vy-border)] px-3 disabled:opacity-40"
          >
            ←
          </button>
          <span role="status" className="text-xs tabular-nums">
            {currentPage + 1} / {pages} · {visible.length}人
          </span>
          <button
            type="button"
            aria-label="次のページ"
            disabled={currentPage === pages - 1}
            onClick={() => setPage(currentPage + 1)}
            className="min-h-11 min-w-11 rounded-lg border border-[var(--vy-border)] px-3 disabled:opacity-40"
          >
            →
          </button>
        </div>
      )}
    </div>
  );
}
