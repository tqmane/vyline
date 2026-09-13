import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

/**
 * 可変高さリストのウィンドウ仮想化
 *
 * 行の実測高さ（ref 経由）を蓄積し、スクロール位置から可視ウィンドウを算出。
 * 高さ未測定の行は estimateHeight で近似する（初回のみ若干のズレが生じる）。
 */

export type VirtualRow<T> = {
  key: string;
  item: T;
};

export function useVirtualList<T>({
  rows,
  estimateHeight,
  overscan = 10,
  resetKey,
}: {
  rows: VirtualRow<T>[];
  estimateHeight: (item: T) => number;
  overscan?: number;
  /** 値が変わるとスクロール位置を初期化する（チャット切替など）。 */
  resetKey?: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const attachContainer = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el;
    setContainer(el);
  }, []);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const heights = useRef(new Map<string, number>());
  const [measuredVersion, setMeasuredVersion] = useState(0);
  const tickScheduled = useRef(false);
  const refCache = useRef(new Map<string, (el: HTMLElement | null) => void>());
  const observers = useRef(new Map<string, ResizeObserver>());
  const elements = useRef(new Map<string, HTMLElement>());
  const readingAnchorRef = useRef<{ key: string; top: number } | null>(null);
  const correctedScrollTopRef = useRef<number | null>(null);
  const anchorRef = useRef<{ key: string; center: boolean } | null>(null);
  const keepBottomRef = useRef(false);
  const bottomCorrectionFrameRef = useRef<number | null>(null);
  const bottomCorrectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelBottomCorrection = useCallback(() => {
    if (bottomCorrectionFrameRef.current != null) {
      cancelAnimationFrame(bottomCorrectionFrameRef.current);
      bottomCorrectionFrameRef.current = null;
    }
    if (bottomCorrectionTimerRef.current != null) {
      clearTimeout(bottomCorrectionTimerRef.current);
      bottomCorrectionTimerRef.current = null;
    }
  }, []);

  const preserveInitialPosition = useCallback(() => {
    const el = containerRef.current;
    if (!el || el.clientHeight === 0) return;

    if (keepBottomRef.current) {
      if (bottomCorrectionTimerRef.current != null) return;
      const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
      if (Math.abs(el.scrollTop - maxScrollTop) > 0.5) {
        correctedScrollTopRef.current = maxScrollTop;
        el.scrollTo({ top: maxScrollTop, behavior: "auto" });
      }
      return;
    }

    const anchor = anchorRef.current ?? readingAnchorRef.current;
    if (!anchor) return;
    const row = elements.current.get(anchor.key);
    if (!row) return;

    const rowTop = row.getBoundingClientRect().top - el.getBoundingClientRect().top;
    const desiredTop = "center" in anchor ? (anchor.center ? el.clientHeight / 2 : 0) : anchor.top;
    const nextTop = Math.max(0, el.scrollTop + rowTop - desiredTop);
    if (Math.abs(nextTop - el.scrollTop) > 0.5) {
      correctedScrollTopRef.current = nextTop;
      el.scrollTo({ top: nextTop, behavior: "auto" });
    }
  }, []);

  const offsets = useMemo(() => {
    const arr: number[] = [];
    let acc = 0;
    for (const r of rows) {
      arr.push(acc);
      acc += heights.current.get(r.key) ?? estimateHeight(r.item);
    }
    return { offsets: arr, total: acc };
  }, [rows, estimateHeight, measuredVersion]);
  const layoutRef = useRef({ rows, offsets });
  useLayoutEffect(() => {
    layoutRef.current = { rows, offsets };
  }, [rows, offsets]);

  const rememberReadingPosition = useCallback(() => {
    const el = containerRef.current;
    if (!el || keepBottomRef.current || anchorRef.current) return;
    const top = el.getBoundingClientRect().top;
    let next: { key: string; top: number } | null = null;
    for (const [key, row] of elements.current) {
      const rect = row.getBoundingClientRect();
      if (
        rect.bottom > top &&
        rect.top < top + el.clientHeight &&
        (!next || rect.top - top < next.top)
      ) {
        next = { key, top: rect.top - top };
      }
    }
    readingAnchorRef.current = next;
  }, []);

  const onScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      if (e.currentTarget.clientHeight === 0) return;
      if (
        !anchorRef.current &&
        e.currentTarget.scrollHeight - e.currentTarget.clientHeight - e.currentTarget.scrollTop <= 1
      ) {
        keepBottomRef.current = true;
        readingAnchorRef.current = null;
      }
      setScrollTop(e.currentTarget.scrollTop);
      const correctedTop = correctedScrollTopRef.current;
      correctedScrollTopRef.current = null;
      if (correctedTop == null || Math.abs(correctedTop - e.currentTarget.scrollTop) > 1) {
        rememberReadingPosition();
      }
    },
    [rememberReadingPosition],
  );

  const releaseAutoPosition = useCallback(() => {
    cancelBottomCorrection();
    anchorRef.current = null;
    keepBottomRef.current = false;
    correctedScrollTopRef.current = null;
    rememberReadingPosition();
  }, [cancelBottomCorrection, rememberReadingPosition]);

  // 可視ウィンドウを二分探索で算出
  const visible = useMemo(() => {
    if (rows.length === 0) return { startIdx: 0, endIdx: 0 };
    const viewportH = viewportHeight || containerRef.current?.clientHeight || 600;
    const buffer = overscan * 60;
    // 行が入れ替わった直後は scrollTop が前のチャットの値のまま残ることがある。
    // クランプしないとウィンドウが末尾を越え、一件も描画されない。
    let windowTop = scrollTop;
    const anchor = anchorRef.current ?? readingAnchorRef.current;
    if (keepBottomRef.current) {
      windowTop = offsets.total - viewportH;
    } else if (anchor) {
      // Keep the anchor mounted when history is prepended or measured heights
      // change by more than the overscan window, before correcting the DOM scroll.
      const index = rows.findIndex((row) => row.key === anchor.key);
      if (index >= 0) {
        const desiredTop = "center" in anchor ? (anchor.center ? viewportH / 2 : 0) : anchor.top;
        windowTop = offsets.offsets[index]! - desiredTop;
      }
    }
    const clampedTop = Math.min(Math.max(0, windowTop), Math.max(0, offsets.total - viewportH));
    const start = clampedTop - buffer;
    const end = clampedTop + viewportH + buffer;

    let lo = 0;
    let hi = offsets.offsets.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (offsets.offsets[mid]! < start) lo = mid + 1;
      else hi = mid;
    }
    // Include the row spanning the start boundary (a tall Flex/text row can
    // start far above the overscan window and still fill the viewport).
    const startIdx = Math.max(0, lo - 1);

    let endIdx = startIdx;
    while (endIdx < offsets.offsets.length && offsets.offsets[endIdx]! < end) endIdx++;
    endIdx = Math.min(Math.max(endIdx + 1, startIdx + 1), offsets.offsets.length);

    return { startIdx, endIdx };
  }, [scrollTop, offsets, overscan, rows.length, viewportHeight]);

  const measure = useCallback((key: string, el: HTMLElement | null) => {
    if (!el) return;
    const height = el.getBoundingClientRect().height;
    // Settings retain the chat runtime in a hidden container. A hidden row's
    // zero height is not a new measurement and must not collapse the window.
    if (height === 0) return;
    const style = getComputedStyle(el);
    const h =
      height +
      (Number.parseFloat(style.marginTop) || 0) +
      (Number.parseFloat(style.marginBottom) || 0);
    const prev = heights.current.get(key);
    if (prev !== h) {
      heights.current.set(key, h);
      // 同一フレーム内の計測変更を 1 再描画に統合（画像遅延ロード時の再描画連鎖を抑制）
      if (tickScheduled.current) return;
      tickScheduled.current = true;
      requestAnimationFrame(() => {
        tickScheduled.current = false;
        setMeasuredVersion((version) => version + 1);
      });
    }
  }, []);

  // 行キーごとに安定した ref を返す（毎レンダーの ref 再アタッチ → 再計測の連鎖を防ぐ）
  const rowRef = useCallback(
    (key: string) => {
      let cb = refCache.current.get(key);
      if (!cb) {
        cb = (el: HTMLElement | null) => {
          observers.current.get(key)?.disconnect();
          observers.current.delete(key);
          elements.current.delete(key);
          if (!el) return;
          elements.current.set(key, el);
          measure(key, el);
          if (typeof ResizeObserver === "undefined") return;
          const observer = new ResizeObserver(() => measure(key, el));
          observer.observe(el, { box: "border-box" });
          observers.current.set(key, observer);
        };
        refCache.current.set(key, cb);
      }
      return cb;
    },
    [measure],
  );

  useEffect(() => {
    const keys = new Set(rows.map((row) => row.key));
    for (const key of heights.current.keys()) {
      if (!keys.has(key)) heights.current.delete(key);
    }
    for (const key of refCache.current.keys()) {
      if (keys.has(key)) continue;
      observers.current.get(key)?.disconnect();
      observers.current.delete(key);
      refCache.current.delete(key);
    }
  }, [rows]);

  useEffect(() => {
    const el = container;
    if (!el) return;
    const sync = () => {
      if (el.clientHeight > 0) {
        setViewportHeight(el.clientHeight);
        preserveInitialPosition();
      }
    };
    sync();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => observer.disconnect();
  }, [container, preserveInitialPosition]);

  // 行が丸ごと入れ替わるときは前のスクロール位置を持ち越さない。
  useLayoutEffect(() => {
    if (resetKey === undefined) return;
    cancelBottomCorrection();
    anchorRef.current = null;
    readingAnchorRef.current = null;
    keepBottomRef.current = false;
    setScrollTop(0);
    if (containerRef.current) containerRef.current.scrollTop = 0;
  }, [resetKey, cancelBottomCorrection]);

  useEffect(() => {
    const el = container;
    if (!el) return;
    el.addEventListener("wheel", releaseAutoPosition, { passive: true });
    el.addEventListener("touchstart", releaseAutoPosition, { passive: true });
    el.addEventListener("pointerdown", releaseAutoPosition, { passive: true });
    const releaseForScrollKey = (event: KeyboardEvent) => {
      if (
        event.key === "ArrowUp" ||
        event.key === "ArrowDown" ||
        event.key === "PageUp" ||
        event.key === "PageDown" ||
        event.key === "Home" ||
        event.key === "End" ||
        event.key === " "
      ) {
        releaseAutoPosition();
      }
    };
    el.addEventListener("keydown", releaseForScrollKey);
    return () => {
      el.removeEventListener("wheel", releaseAutoPosition);
      el.removeEventListener("touchstart", releaseAutoPosition);
      el.removeEventListener("pointerdown", releaseAutoPosition);
      el.removeEventListener("keydown", releaseForScrollKey);
    };
  }, [container, releaseAutoPosition]);

  useEffect(() => {
    return () => {
      cancelBottomCorrection();
      for (const observer of observers.current.values()) observer.disconnect();
    };
  }, [cancelBottomCorrection]);

  // 同期で行が追加されても、既存行の高さが変わらなければ measure は呼ばれない。
  // その場合も下部スペーサー更新後に最下部へ追従する。
  useLayoutEffect(() => {
    preserveInitialPosition();
  }, [offsets, preserveInitialPosition, rows]);

  // 行キー → スクロール位置（center: 可視中央に寄せる）
  const scrollToKey = useCallback(
    (key: string, opts: { behavior?: ScrollBehavior; center?: boolean } = {}) => {
      const { rows, offsets } = layoutRef.current;
      const idx = rows.findIndex((r) => r.key === key);
      if (idx < 0) return;
      let top = offsets.offsets[idx] ?? 0;
      const el = containerRef.current;
      if (!el) return;
      if (opts.center) top = Math.max(0, top - el.clientHeight / 2);
      el.scrollTo({ top, behavior: opts.behavior ?? "smooth" });
    },
    [],
  );

  const scrollToMessagePosition = useCallback(
    (
      messageId: string,
      opts: { behavior?: ScrollBehavior; center?: boolean } = {},
      rowKey = `msg-${messageId}`,
    ) => {
      cancelBottomCorrection();
      anchorRef.current = { key: rowKey, center: opts.center === true };
      readingAnchorRef.current = null;
      keepBottomRef.current = false;
      scrollToKey(rowKey, opts);

      const correctToRenderedRow = () => {
        const el = containerRef.current;
        if (anchorRef.current?.key !== rowKey) return;
        const row = elements.current.get(rowKey);
        if (!el || !row) return;
        const rowTop = row.getBoundingClientRect().top - el.getBoundingClientRect().top;
        const desiredTop = opts.center ? el.clientHeight / 2 : 0;
        el.scrollTo({
          top: Math.max(0, el.scrollTop + rowTop - desiredTop),
          behavior: opts.behavior ?? "smooth",
        });
        preserveInitialPosition();
      };

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(correctToRenderedRow);
        });
      });
    },
    [cancelBottomCorrection, preserveInitialPosition, scrollToKey],
  );

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      const el = containerRef.current;
      if (!el) return;
      cancelBottomCorrection();
      anchorRef.current = null;
      readingAnchorRef.current = null;
      keepBottomRef.current = true;

      const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
      el.scrollTo({ top: maxScrollTop, behavior });

      // 仮想行が入れ替わり、画像サイズが確定するまで数フレームにわたり最下端を再計算する。
      // その後の遅延リサイズも preserveInitialPosition が keepBottomRef を見て追従する。
      const settle = (remaining: number, previousMax: number, stableFrames: number) => {
        bottomCorrectionFrameRef.current = null;
        if (!keepBottomRef.current || !containerRef.current) return;
        const current = containerRef.current;
        const nextMax = Math.max(0, current.scrollHeight - current.clientHeight);
        if (Math.abs(current.scrollTop - nextMax) > 0.5) {
          current.scrollTo({ top: nextMax, behavior: "auto" });
        }
        const nextStable =
          Math.abs(previousMax - nextMax) <= 0.5 && Math.abs(current.scrollTop - nextMax) <= 0.5
            ? stableFrames + 1
            : 0;
        if (remaining <= 0 || nextStable >= 4) return;
        bottomCorrectionFrameRef.current = requestAnimationFrame(() =>
          settle(remaining - 1, nextMax, nextStable),
        );
      };

      const beginSettle = () => {
        bottomCorrectionTimerRef.current = null;
        bottomCorrectionFrameRef.current = requestAnimationFrame(() => settle(36, maxScrollTop, 0));
      };
      if (behavior === "smooth") {
        bottomCorrectionTimerRef.current = setTimeout(beginSettle, 320);
      } else {
        beginSettle();
      }
    },
    [cancelBottomCorrection],
  );

  const visibleRows = useMemo(() => rows.slice(visible.startIdx, visible.endIdx), [rows, visible]);
  const topSpacer = offsets.offsets[visible.startIdx] ?? 0;
  const bottomSpacer = Math.max(
    0,
    offsets.total - (offsets.offsets[visible.endIdx] ?? offsets.total),
  );

  return {
    containerRef,
    attachContainer,
    onScroll,
    visibleRows,
    hasMeasured: measuredVersion > 0,
    topSpacer,
    bottomSpacer,
    measure,
    rowRef,
    scrollToKey,
    scrollToMessagePosition,
    scrollToBottom,
    releaseAutoPosition,
  };
}
