import { createRoot } from "react-dom/client";
import { MessageInput } from "../src/components/message-input";
import { useStore } from "../src/lib/store";
import { DESIGN_SYSTEMS, isComposeMode, useDesignSystemStore } from "../src/ui/design-system-store";
import { getComposerController } from "../src/ui/composer-controller";
import { KmpAppHost } from "../src/ui/kmp-app-host";

const requested = new URL(location.href).searchParams.get("mode");
const mode = DESIGN_SYSTEMS.find((item) => item.id === requested)?.id ?? "legacy";
const chatId = "c-composer-fixture";
globalThis.fetch = Object.assign(
  async () => {
    throw new Error("Unexpected API request");
  },
  { preconnect: fetch.preconnect },
);
useStore.setState({
  accountId: "composer-fixture",
  demoMode: true,
  activeChatId: chatId,
  screen: "chat",
  chatPaneIds: [chatId],
  chatPaneSizes: [100],
  focusedChatPane: 0,
  messages: [],
  drafts: {},
  chats: [
    {
      id: chatId,
      type: "friend",
      name: "Local fixture",
      avatar: "F",
      color: "#2468ab",
      status: "",
      unread: 0,
    },
  ],
});
useDesignSystemStore.setState({ mode, appearance: "light" });
document.documentElement.dataset.uiMode = mode;
const native = isComposeMode(mode);
const actions: unknown[] = [];
window.addEventListener("message", (event) => {
  try {
    const value = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
    if (value?.type === "action") actions.push(value);
  } catch {
    /* Ignore unrelated browser messages. */
  }
});
const root = createRoot(document.getElementById("root")!);
root.render(
  <>
    <div hidden={native} style={{ position: "fixed", inset: "auto 0 0", background: "white" }}>
      <MessageInput chatId={chatId} />
    </div>
    {native && (
      <KmpAppHost
        paneIds={[chatId]}
        paneRects={[]}
        paneLayout="columns"
        onPaneLayout={() => {}}
        onPaneRatio={() => {}}
      />
    )}
  </>,
);
Object.assign(window, {
  composerFixture: {
    actions,
    get snapshot() {
      return getComposerController(chatId)?.snapshot;
    },
    clear() {
      getComposerController(chatId)?.clearFiles();
    },
    get messages() {
      return useStore.getState().messages;
    },
  },
});
