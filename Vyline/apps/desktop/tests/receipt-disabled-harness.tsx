import { useState } from "react";
import { createRoot } from "react-dom/client";
import { api } from "../src/api/client";
import { useStore } from "../src/lib/store";

const accountId = "receipt-disabled-fixture";
const chatId = "u-receipt-disabled-peer";
const mode = new URLSearchParams(location.search).get("mode") === "chat" ? "chat" : "global";
const countKey = "receipt-disabled-fixture:server-count";
let clock = 1_800_000_000_000;
Date.now = () => clock;
const blockedFetch: string[] = [];
const marks: Array<{ account: string; chat: string; messageId?: string }> = [];
const calls = { history: 0, delta: 0, poll: 0, list: 0 };
globalThis.fetch = Object.assign(
  async (input: RequestInfo | URL) => {
    blockedFetch.push(String(input));
    throw new Error("This fixture allows mocked API methods only");
  },
  { preconnect: globalThis.fetch.preconnect },
);

const serverCount = () => Number(sessionStorage.getItem(countKey) ?? 13);
const wire = (id: number) => ({
  id: String(id),
  from: chatId,
  to: "u-fixture-self",
  text: `合成メッセージ ${id}`,
  contentType: "NONE",
  createdTime: id * 1000,
  isMyMessage: false,
  seen: false,
  contentMetadata: null,
});
const history = () => Array.from({ length: serverCount() }, (_, index) => wire(101 + index));
const box = () => ({
  mid: chatId,
  name: "Synthetic peer",
  kind: "direct" as const,
  hasMessages: true,
  unreadCount: serverCount(),
  lastMessageId: String(100 + serverCount()),
  lastMessageTime: (100 + serverCount()) * 1000,
  lastMessagePreview: "合成メッセージ",
});

api.line.contactProfile = async () => ({ ok: false, error: "No profile needed in this fixture" });
api.line.announce.list = async () => ({ ok: true, data: [] });
api.line.readReceipts = async () => ({ ok: true });
api.line.messages = async () => {
  calls.history++;
  return { ok: true, messages: history().reverse() };
};
api.line.messagesDelta = async (_account, _chat, after) => {
  calls.delta++;
  return { ok: true, messages: history().filter((message) => BigInt(message.id) > BigInt(after)) };
};
api.line.chats = async () => {
  calls.list++;
  return { ok: true, chats: [box()] };
};
api.line.pollEvents = async () => {
  calls.poll++;
  return {
    ok: true,
    cursor: calls.poll,
    seq: calls.poll,
    events: [{ kind: "message" as const, chatMid: chatId, message: wire(100 + serverCount()) }],
  };
};
api.line.markAsRead = async (account, chat, messageId) => {
  marks.push({ account, chat, messageId });
  return { ok: true };
};

const initial = useStore.getState();
useStore.setState({
  accountId,
  demoMode: false,
  activeChatId: null,
  self: { ...initial.self, mid: "u-fixture-self" },
});
if (!sessionStorage.getItem("receipt-disabled-fixture:configured")) {
  useStore.setState({
    settings: {
      ...initial.settings,
      readReceipts: mode === "chat",
      webNotificationsEnabled: false,
    },
    readDisabledMids: mode === "chat" ? { [chatId]: true } : {},
  });
  sessionStorage.setItem("receipt-disabled-fixture:configured", "1");
}
function bootstrap() {
  useStore.getState().hydrateLineData({
    profile: null,
    chats: [box()],
    messages: history(),
    hiddenMids: new Set(),
    contactCache: new Map(),
  });
}
bootstrap();

const actions = {
  open: () => useStore.getState().openChat(chatId),
  close: () => useStore.getState().closeChat(),
  automatic: () => useStore.getState().markChatRead(chatId),
  history: () => useStore.getState().refreshMessages(chatId, { force: true }),
  list: () => useStore.getState().refreshChatsSilently(),
  bootstrap,
  poll: () => useStore.getState().pollIncoming(),
  "delta-14": () => {
    sessionStorage.setItem(countKey, "14");
    return useStore.getState().pollMessagesDelta(chatId);
  },
  "manual-full": () => useStore.getState().markChatRead(chatId, undefined, { forceReceipt: true }),
  "manual-partial": () => useStore.getState().markChatRead(chatId, "107", { forceReceipt: true }),
};

function Harness() {
  const state = useStore();
  const [completed, setCompleted] = useState("initial");
  const [error, setError] = useState("");
  const chat = state.chats.find((chat) => chat.id === chatId);
  return (
    <>
      <h1>Receipt-disabled synthetic regression</h1>
      <output id="snapshot">
        {JSON.stringify({
          mode,
          active: state.activeChatId,
          unread: chat?.unread,
          serverCount: serverCount(),
          serverUnreadCount: chat?.serverUnreadCount,
          globalEnabled: state.settings.readReceipts,
          individuallyDisabled: !!state.readDisabledMids[chatId],
          marks,
          calls,
          blockedFetch,
          localReadMarks: state.localReadMarks,
          messageIds: state.messages.map((message) => message.id),
        })}
      </output>
      <output id="completed">{completed}</output>
      <output id="error">{error}</output>
      {Object.entries(actions).map(([name, action]) => (
        <button
          key={name}
          type="button"
          onClick={async () => {
            setCompleted("");
            setError("");
            clock += 60_000;
            try {
              await action();
              await new Promise((resolve) => setTimeout(resolve, 0));
            } catch (error) {
              setError(String(error));
            }
            setCompleted(name);
          }}
        >
          {name}
        </button>
      ))}
    </>
  );
}
createRoot(document.body.appendChild(document.createElement("div"))).render(<Harness />);
