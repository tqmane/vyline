import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ChatArea } from "../src/components/chat-area";
import { useStore } from "../src/lib/store";
import { emitAppEvent } from "../src/lib/appEvents";
import { useSearchPaneMessages, useSearchPaneState } from "../src/lib/searchPane";
import { searchPresentation } from "../src/lib/searchController";
import { useDesignSystemStore } from "../src/ui/design-system-store";
import { KmpHostedMessages } from "../src/ui/kmp-hosted-messages";
import { KmpCompatibility } from "../src/ui/kmp-compatibility";

const ignoreNativeProjection = () => {};

// Isolated fixture: only the loopback search server is reachable; no LINE calls.
const realFetch = globalThis.fetch;
globalThis.fetch = Object.assign(
  async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("/message-search/")) return realFetch(input, init);
    return Response.json({ ok: true, messages: [], contacts: [], items: [], enabled: false });
  },
  { preconnect: realFetch.preconnect },
);
useDesignSystemStore.setState({ mode: "legacy" });
useStore.setState({
  accountId: "fixture-a",
  demoMode: false,
  activeChatId: "chat-a",
  chats: ["a", "b"].map((id) => ({
    id: `chat-${id}`,
    type: "friend",
    name: `Fixture ${id}`,
    avatar: id,
    color: "#3365d6",
    status: "fixture",
    unread: 0,
  })),
  messages: ["a", "b"].map((id) => ({
    id: `recent-${id}`,
    chatId: `chat-${id}`,
    authorId: "sender",
    kind: "text",
    text: `Recent ${id}`,
    createdAt: 5000,
    status: "sent",
    messageState: "normal",
  })),
  refreshMessages: async () => {},
  markChatRead: async () => {},
});

function NativeProjection({ chat }: { chat: string }) {
  const account = useStore((state) => state.accountId);
  const source = useStore((state) => state.messages);
  const projected = useSearchPaneMessages(account, chat, source);
  const state = useSearchPaneState(account, chat);
  const settings = useStore(state => state.settings);
  return (
    <output hidden data-native={chat}>
      {JSON.stringify({
        ids: projected.filter((message) => message.chatId === chat).map((message) => message.id),
        search: state ? searchPresentation(state, settings) : null,
      })}
    </output>
  );
}
function Harness() {
  const count = useStore((state) => state.messages.length);
  const [presentations, setPresentations] = useState(0);
  useEffect(() => {
    setPresentations((value) => value + 1);
  }, []);
  return (
    <>
      <button
        type="button"
        id="switch-account"
        onClick={() => useStore.setState({ accountId: "fixture-b" })}
      >
        switch
      </button>
      <button
        type="button"
        id="round-trip"
        onClick={() => {
          useStore.setState({ accountId: "fixture-b" });
          useStore.setState({ accountId: "fixture-a" });
        }}
      >
        round trip
      </button>
      <output id="store-count">{count}</output>
      <output id="mounted">{presentations}</output>
      <NativeHostedFixture />
      <div style={{ display: "flex", height: "85vh" }}>
        {["chat-a", "chat-b"].map((chat) => (
          <section
            key={chat}
            data-pane={chat}
            style={{ width: "50%", minWidth: 0, height: "100%" }}
          >
            <button
              type="button"
              data-command={chat}
              onClick={() => emitAppEvent("chat:ui-command", { chatId: chat, action: "search" })}
            >
              native search
            </button>
            <ChatArea chatId={chat} paneCount={2} />
            <NativeProjection chat={chat} />
          </section>
        ))}
      </div>
    </>
  );
}

function NativeHostedFixture() {
  const [frame, setFrame] = useState<HTMLIFrameElement | null>(null);
  const [compatibility, setCompatibility] = useState(false);
  const account = useStore((state) => state.accountId);
  return (
    <>
      <button
        type="button"
        id="mount-native-slot"
        onClick={() =>
          frame?.contentWindow?.postMessage({ type: "fixture-mount", id: "235" }, location.origin)
        }
      >
        mount native slot
      </button>
      <button type="button" id="open-native-compatibility" onClick={() => setCompatibility(true)}>
        open native message
      </button>
      <button
        type="button"
        id="delete-native-message"
        onClick={async () => {
          await realFetch("/fixture-delete", { method: "POST" });
          emitAppEvent("message:deleted", {
            accountId: account,
            chatId: "chat-a",
            messageId: "235",
          });
        }}
      >
        delete native message
      </button>
      <iframe
        title="native content slots fixture"
        id="native-host-frame"
        ref={setFrame}
        style={{ width: 360, height: 180 }}
        srcDoc={`<!doctype html><html><body><script>
      window.__vylineMessageSlots = new Map();
      addEventListener('message', event => {
        if (event.data.type !== 'fixture-mount') return;
        const id = event.data.id;
        const slot = document.body.appendChild(document.createElement('div'));
        slot.id = 'native-slot-' + id;
        window.__vylineMessageSlots.set(id, slot);
        parent.postMessage({channel:'vyline-ui',version:1,type:'content-slot',id,epoch:1,chatId:'chat-a'}, parent.location.origin);
      });
    </script></body></html>`}
      />
      <KmpHostedMessages
        frame={frame}
        epoch={1}
        chatId="chat-a"
        onHeight={ignoreNativeProjection}
        onModel={ignoreNativeProjection}
      />
      {compatibility && (
        <div id="native-compatibility">
          <KmpCompatibility
            request={{ kind: "message", accountId: account, chatId: "chat-a", messageId: "235" }}
            onClose={() => setCompatibility(false)}
          />
        </div>
      )}
    </>
  );
}
createRoot(document.body.appendChild(document.createElement("div"))).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
