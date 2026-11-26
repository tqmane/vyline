import { useState } from "react";
import { createRoot } from "react-dom/client";
import { useVirtualList, type VirtualRow } from "./useVirtualList";

type Item = {
  id: string;
  estimate: number;
  actual: number;
};

function VirtualListHarness() {
  const [chatKey, setChatKey] = useState("chat-a");
  const [items, setItems] = useState<Item[]>(() =>
    Array.from({ length: 80 }, (_, index) => ({
      id: `item-${index}`,
      estimate: index % 4 === 0 ? 220 : 60,
      actual: index % 4 === 0 ? (index % 8 === 0 ? 360 : 100) : 52,
    })),
  );

  const rows: VirtualRow<Item>[] = items.map((item) => ({
    key: item.id,
    item,
  }));

  const { containerRef, onScroll, visibleRows, hasMeasured, topSpacer, bottomSpacer, rowRef, scrollToBottom } =
    useVirtualList<Item>({
      rows,
      estimateHeight: (item) => item.estimate,
      resetKey: chatKey,
      initialScrollToBottom: true,
    });

  (window as unknown as { __vh?: unknown }).__vh = {
    scrollTo: (top: number) => {
      if (!containerRef.current) return;
      containerRef.current.scrollTop = top;
      containerRef.current.dispatchEvent(new Event("scroll", { bubbles: true }));
    },
    scrollToBottom: () => scrollToBottom("auto"),
    switchChat: (nextKey: string) => setChatKey(nextKey),
    mutateImageHeights: () => {
      setItems((prev) =>
        prev.map((item, idx) =>
          idx % 4 === 0 ? { ...item, actual: item.actual === 360 ? 110 : 350 } : item,
        ),
      );
    },
    metrics: () => ({
      scrollTop: containerRef.current?.scrollTop ?? -1,
      scrollHeight: containerRef.current?.scrollHeight ?? -1,
      clientHeight: containerRef.current?.clientHeight ?? -1,
      visibleCount: visibleRows.length,
      hasMeasured,
    }),
  };

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      style={{ height: 420, width: 360, overflowY: "auto", overflowAnchor: "none" }}
    >
      <div>
        {topSpacer > 0 && <div style={{ height: topSpacer }} />}
        {visibleRows.map(({ key, item }) => (
          <div
            key={key}
            ref={rowRef(key)}
            style={{
              height: item.actual,
              marginBottom: 4,
              background: "#223",
              boxSizing: "border-box",
            }}
          >
            {item.id}
          </div>
        ))}
        {bottomSpacer > 0 && <div style={{ height: bottomSpacer }} />}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<VirtualListHarness />);
