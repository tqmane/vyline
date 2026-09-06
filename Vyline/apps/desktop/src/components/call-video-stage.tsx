import { useRef, useState, type CSSProperties, type ReactNode } from "react";

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
  const stageRef = useRef<HTMLDivElement>(null);
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
  const columns = layout === "split" ? 2 : Math.max(1, Math.ceil(Math.sqrt(visible.length)));
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
            onClick={() => setLayout(value)}
            className="min-h-10 rounded-lg border border-[var(--vy-border)] px-3 text-xs aria-pressed:bg-[var(--vy-accent)] aria-pressed:text-[var(--vy-accent-contrast)]"
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
        className={`relative min-h-40 w-full flex-1 gap-2 ${layout === "focus" && visible.length <= 2 ? "" : "grid"}`}
        style={
          layout === "focus" && visible.length > 2
            ? {
                gridTemplateColumns: "minmax(0, 3fr) minmax(5rem, 1fr)",
                gridTemplateRows: `repeat(${visible.length - 1}, minmax(5rem, 1fr))`,
                overflowY: "auto",
              }
            : layout !== "focus"
              ? {
                  gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, max(${layout === "split" ? "20rem" : "14rem"}, calc((100% - ${(columns - 1) * 8}px) / ${columns}))), 1fr))`,
                  gridAutoRows: "minmax(8rem, 1fr)",
                  overflowY: "auto",
                }
              : undefined
        }
      >
        {tiles.map((tile) => {
          const main = tile.id === mainId;
          const mini = floating && !main;
          const isHidden = !tile.visible;
          const singleFocus = layout === "focus" && visible.length <= 2;
          return (
            <div
              key={tile.id}
              data-call-tile={tile.id}
              className={`overflow-hidden rounded-xl border border-white/30 bg-black ${isHidden ? "hidden" : ""} ${singleFocus ? "absolute" : "relative"} ${mini ? "z-10 shadow-lg" : singleFocus ? "inset-0" : "min-h-0 min-w-0"}`}
              style={
                mini
                  ? miniStyle
                  : {
                      order: ordered.indexOf(tile.id),
                      ...(layout === "focus" && visible.length > 2
                        ? main
                          ? {
                              gridColumn: 1,
                              gridRow: `1 / span ${visible.length - 1}`,
                            }
                          : { gridColumn: 2 }
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
                    setFocused(tile.id);
                    setLayout("focus");
                  }}
                  className="absolute right-1 top-1 min-h-9 rounded-lg bg-black/65 px-2 text-xs text-white"
                >
                  {main && layout === "focus" ? "固定中" : "固定"}
                </button>
              )}
              {layout !== "focus" && visible.length > 2 && (
                <div className="absolute left-1 top-1 flex gap-1">
                  <button
                    type="button"
                    aria-label={`${tile.name}を前へ移動`}
                    disabled={ordered[0] === tile.id}
                    onClick={() => move(tile.id, -1)}
                    className="min-h-9 rounded-lg bg-black/65 px-2 text-xs text-white disabled:opacity-40"
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    aria-label={`${tile.name}を後ろへ移動`}
                    disabled={ordered.at(-1) === tile.id}
                    onClick={() => move(tile.id, 1)}
                    className="min-h-9 rounded-lg bg-black/65 px-2 text-xs text-white disabled:opacity-40"
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
    </div>
  );
}
