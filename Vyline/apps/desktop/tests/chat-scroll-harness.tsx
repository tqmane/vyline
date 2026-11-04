import { createRoot } from "react-dom/client";
import { useState } from "react";
import { ChatArea } from "../src/components/chat-area";
import { useStore, type Message } from "../src/lib/store";
import { useDesignSystemStore } from "../src/ui/design-system-store";

const ids = ["c-scroll-1", "c-scroll-2", "c-scroll-3", "c-scroll-4", "c-scroll-5"];
const make = (chatId: string, index: number): Message => ({
  id: `${chatId}-${index}`,
  chatId,
  authorId: "oa",
  createdAt: 1_700_000_000_000 + index * 3600_000,
  kind: index % 7 === 0 ? "flex" : index % 5 === 0 ? "image" : "text",
  text: `OA ${index} ${"受信した合成メッセージ。".repeat(1 + (Math.abs(index) % 8))}`,
  imageSrc: `/fixture-image/${chatId}-${index}-small.svg`,
  flexJson: {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      contents: [
        { type: "text", text: `Flex ${index}`, wrap: true },
        {
          type: "image",
          url: `http://127.0.0.1/fixture-image/flex-${index}.svg`,
          aspectRatio: "3:1",
        },
      ],
    },
  },
  status: "sent",
  read: false,
  messageState: "normal",
});
globalThis.fetch = Object.assign(
  async () => {
    throw new Error("Unexpected API request");
  },
  { preconnect: fetch.preconnect },
);
useStore.setState({
  accountId: null,
  demoMode: true,
  screen: "chat",
  activeChatId: ids[0],
  messages: ids.flatMap((id) => Array.from({ length: 180 }, (_, i) => make(id, i))),
  chats: ids.map((id) => ({
    id,
    type: "friend",
    isOfficial: true,
    name: id,
    avatar: "O",
    color: "#2468ab",
    status: "",
    unread: 0,
  })),
  settings: { ...useStore.getState().settings, requestUrlPreviews: false, streamerMode: false },
});
useDesignSystemStore.setState({ mode: "legacy", appearance: "light" });
let changePanes!: (count: number) => void;
let switchFirst!: () => void;
function Root() {
  const [panes, setPanes] = useState(1);
  const [first, setFirst] = useState(ids[0]);
  changePanes = setPanes;
  switchFirst = () => setFirst((id) => (id === ids[0] ? ids[4] : ids[0]));
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${panes},minmax(0,1fr))`,
        height: "100vh",
      }}
    >
      {Array.from({ length: panes }, (_, i) => (
        <section key={i} data-pane={i} style={{ minWidth: 0, minHeight: 0 }}>
          <ChatArea chatId={i === 0 ? first : ids[i]} paneCount={panes} />
        </section>
      ))}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Root />);
const viewport = (pane = 0) =>
  document.querySelector<HTMLElement>(`[data-pane="${pane}"] .vy-chat-messages`)!;
Object.assign(window, {
  scrollFixture: {
    panes(count: number) {
      changePanes(count);
    },
    switchFirst() {
      switchFirst();
    },
    expand(pane = 0) {
      const rendered = new Set(
        [...viewport(pane).querySelectorAll<HTMLElement>('[id^="msg-"]')].map((row) =>
          row.id.slice(4),
        ),
      );
      useStore.setState((state) => ({
        messages: state.messages.map((message) =>
          !rendered.has(message.id)
            ? message
            : {
                ...message,
                imageSrc: message.imageSrc?.replace("small", "large"),
                flexJson:
                  message.kind !== "flex"
                    ? message.flexJson
                    : {
                        type: "bubble",
                        body: {
                          type: "box",
                          layout: "vertical",
                          contents: [
                            {
                              type: "text",
                              text: "高さが遅れて確定する Flex カードです。".repeat(15),
                              wrap: true,
                            },
                            {
                              type: "image",
                              url: "http://127.0.0.1/fixture-image/flex-large.svg",
                              aspectRatio: "1:2",
                            },
                          ],
                        },
                      },
              },
        ),
      }));
    },
    append(pane = 0) {
      const chat = viewport(pane).closest("section")!.querySelector("header")!.textContent;
      const id = ids.find((id) => chat?.includes(id))!;
      useStore.setState((state) => ({
        messages: [
          ...state.messages,
          make(
            id,
            Math.max(
              ...state.messages
                .filter((item) => item.chatId === id)
                .map((item) => Number(item.id.split("-").at(-1))),
            ) + 1,
          ),
        ],
      }));
    },
    prepend() {
      useStore.setState((state) => ({
        messages: [
          ...Array.from({ length: 40 }, (_, i) => make(ids[0]!, i - 40)),
          ...state.messages,
        ],
      }));
    },
    read(pane = 0) {
      const el = viewport(pane);
      const box = el.getBoundingClientRect();
      const rows = [...el.querySelectorAll<HTMLElement>('[id^="msg-"]')].map((row) => ({
        id: row.id,
        top: row.getBoundingClientRect().top - box.top,
        bottom: row.getBoundingClientRect().bottom - box.top,
      }));
      return {
        anchor:
          rows.find((row) => row.top >= 0 && row.top < el.clientHeight) ??
          rows.find((row) => row.bottom > 0),
        top: el.scrollTop,
        gap: el.scrollHeight - el.clientHeight - el.scrollTop,
        rows,
      };
    },
  },
});
