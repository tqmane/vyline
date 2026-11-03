import { createRoot } from "react-dom/client";
import { MessageBubble } from "../components/message-bubble";
import { useStore, type Chat, type Message } from "../lib/store";
import { NativeControllerSurface } from "../ui/native-controller-surface";
import { getNativeMenuSnapshot, invokeNativeMenu, setNativeMenuAvailable } from "../ui/native-menu";
import {
  invokeNativePanel,
  useNativePanelSnapshot,
  type NativePanelSnapshot,
} from "../ui/native-panel";
import { useDesignSystemStore } from "../ui/design-system-store";

const chat: Chat = {
  id: "chat-fixture",
  type: "friend",
  name: "Fixture",
  avatar: "F",
  color: "blue",
  status: "",
  unread: 0,
};
const base: Message = {
  id: "message-fixture",
  chatId: chat.id,
  authorId: "me",
  kind: "text",
  text: "https://site.org/article",
  createdAt: 1,
  status: "sent",
  read: false,
  messageState: "normal",
};
const root = createRoot(document.getElementById("root")!);
let message = base;
let native = false;
let deletes = 0;
let behavior: "success" | "failure" = "success";
let panel: NativePanelSnapshot | null = null;
let modal: NativePanelSnapshot | null = null;
function PanelObserver() {
  modal = useNativePanelSnapshot();
  return null;
}
const harness = {
  render(patch: Partial<Message> = {}, settings: Record<string, unknown> = {}, controller = false) {
    native = controller;
    message = { ...base, ...patch };
    deletes = 0;
    useStore.setState({
      accountId: "fixture-account",
      demoMode: true,
      chats: [chat],
      messages: [message],
      settings: {
        ...useStore.getState().settings,
        requestUrlPreviews: false,
        linkPreviewMaxUrls: 1,
        streamerMode: false,
        streamerMaskUrls: true,
        ...settings,
      },
      fetchMessageHistory: async () => message.history ?? [],
      deleteLocalMessage: async () => {
        deletes++;
        if (behavior === "failure") throw new Error("fixture failure");
        useStore.setState({ messages: [] });
      },
    });
    useDesignSystemStore.setState({ mode: native ? "apple" : "legacy" });
    setNativeMenuAvailable(native);
    function Fixture() {
      const messages = useStore((state) => state.messages);
      return messages.map((item) => (
        <MessageBubble
          key={item.id}
          message={item}
          chat={chat}
          showAvatar={false}
          showName={false}
          {...(native ? { actionsOnly: true, menuRequest: { x: 1, y: 1 } } : {})}
        />
      ));
    }
    root.render(
      <>
        <PanelObserver />
        {native ? (
          <NativeControllerSurface
            title="Fixture"
            onClose={() => {}}
            onSnapshot={(snapshot) => {
              panel = snapshot;
            }}
          >
            <Fixture />
          </NativeControllerSurface>
        ) : (
          <Fixture />
        )}
      </>,
    );
  },
  settings(patch: Record<string, unknown>) {
    useStore.setState({ settings: { ...useStore.getState().settings, ...patch } });
  },
  account(id: string) {
    useStore.setState({ accountId: id });
  },
  behavior(value: typeof behavior) {
    behavior = value;
  },
  get deletes() {
    return deletes;
  },
  get notice() {
    return useStore.getState().notice;
  },
  get panel() {
    return modal ?? panel;
  },
  get menu() {
    return getNativeMenuSnapshot();
  },
  invokeNativeMenu,
  invokeNativePanel,
};
Object.assign(window, { harness });
harness.render();
