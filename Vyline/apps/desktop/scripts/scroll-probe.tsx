import React, { useLayoutEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { useVirtualList } from "../src/hooks/useVirtualList";
import { ChatArea } from "../src/components/chat-area";
import { ThemeApplier } from "../src/components/theme-applier";
import { useStore, type Message } from "../src/lib/store";
import { demoChats, demoSelf, demoSettings } from "../src/demo/demoData";
import { useDesignSystemStore } from "../src/ui/design-system-store";
import "../src/index.css";

// Exercises the real hook with deterministic row sizes; no account or network data.
function Probe() {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [count, setCount] = useState(100);
  const rows = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        key: `msg-${i}`,
        item: i,
      })),
    [count],
  );
  const list = useVirtualList({
    rows,
    estimateHeight: (i) => (i === 0 ? 2000 : 60),
    resetKey: open ? "chat" : null,
  });
  useLayoutEffect(() => {
    if (open) list.scrollToBottom();
  }, [open]);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <button type="button" onClick={() => list.scrollToBottom()}>
        Latest
      </button>
      <button type="button" onClick={() => setExpanded((value) => !value)}>
        Resize rows
      </button>
      <button type="button" onClick={() => setCount((value) => value + 1)}>
        Append
      </button>
      <button
        type="button"
        onClick={() => list.scrollToMessagePosition("40", { behavior: "auto", center: true })}
      >
        Jump
      </button>
      {open && (
        <div
          ref={list.attachContainer}
          onScroll={list.onScroll}
          data-testid="viewport"
          style={{ height: 400, overflowY: "auto", overflowAnchor: "none" }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ height: list.topSpacer, flexShrink: 0 }} />
            {list.visibleRows.map(({ key, item }) => (
              <div
                key={key}
                id={key}
                ref={list.rowRef(key)}
                style={{
                  height: item === 0 ? 2000 : expanded ? 100 : 60,
                  marginTop: 12,
                  flexShrink: 0,
                }}
              >
                Row {item}
              </div>
            ))}
            <div style={{ height: list.bottomSpacer, flexShrink: 0 }} />
          </div>
        </div>
      )}
    </>
  );
}
function ChatProbe() {
  const [hidden, setHidden] = useState(false);
  return (
    <>
      <ThemeApplier />
      <div style={{ height: 40 }}>
        <button type="button" onClick={() => useStore.setState({ activeChatId: demoChats[0]!.id })}>
          Open
        </button>
        <button type="button" onClick={() => useStore.setState({ activeChatId: demoChats[1]!.id })}>
          Switch
        </button>
        <button type="button" onClick={() => setHidden((value) => !value)}>
          Hide
        </button>
        <button type="button" onClick={() => useDesignSystemStore.getState().setMode("nezu")}>
          Nezu
        </button>
        <button
          type="button"
          onClick={() =>
            useStore.setState((state) => ({
              messages: [
                ...state.messages,
                ...Array.from({ length: 30 }, (_, index) => ({
                  ...state.messages[0]!,
                  id: `older-${index}`,
                  chatId: state.activeChatId!,
                  createdAt: new Date(2023, 11, 31).getTime() + index * 60000,
                })),
              ],
            }))
          }
        >
          Prepend
        </button>
        <button
          type="button"
          onClick={() =>
            useStore.setState((state) => ({
              settings: { ...state.settings, compactDensity: !state.settings.compactDensity },
            }))
          }
        >
          Compact
        </button>
      </div>
      <div style={{ height: "calc(100dvh - 40px)", display: hidden ? "none" : "flex" }}>
        <ChatArea />
      </div>
    </>
  );
}
const chatMode = new URLSearchParams(location.search).has("chat");
if (chatMode) {
  const messages: Message[] = demoChats.slice(0, 2).flatMap((chat) =>
    Array.from({ length: 150 }, (_, i) => ({
      id: `${chat.id}-${i}`,
      chatId: chat.id,
      authorId: i % 3 ? "demo-alice" : "me",
      kind: "text" as const,
      text: `${i}: スクロール検証 ${"読み返すメッセージです。\n".repeat(i % 7 === 0 ? 15 : 1)}`,
      createdAt: new Date(2024, 0, 1).getTime() + i * 60000,
      read: true,
      status: "read" as const,
      messageState: "normal" as const,
    })),
  );
  useStore.setState({
    demoMode: true,
    accountId: null,
    activeChatId: null,
    chats: demoChats,
    messages,
    self: demoSelf,
    settings: demoSettings,
    showUpdateNote: false,
  });
}
createRoot(document.getElementById("root")!).render(chatMode ? <ChatProbe /> : <Probe />);
