// Genuine production components, isolated fake account, read-only requests only.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MessageBubble } from "../src/components/message-bubble";
import { PlusMenu } from "../src/components/plus-menu";
import { useStore, type Chat, type Message } from "../src/lib/store";
import { useDesignSystemStore } from "../src/ui/design-system-store";
import { NativeControllerSurface } from "../src/ui/native-controller-surface";
import { useNativePanelSnapshot, invokeNativePanel } from "../src/ui/native-panel";
import "../src/index.css";

const params = new URLSearchParams(location.search);
const chatId = `c${"a".repeat(32)}`;
const chat: Chat = { id: chatId, type: "group", name: "Fixture", avatar: "F", color: "blue", status: "", unread: 0 };
const original: Message = { id: "album-message", chatId, authorId: "peer", kind: "system", text: "Album", createdAt: 123, status: "sent", read: false, messageState: "normal", postNotification: { kind: params.has("note") ? "note" : "album", ...(params.has("missing") ? {} : { albumId: "123" }), title: "Travel Album", homeId: chatId, postId: "note-1" } };
const requests: Array<{ path: string; method: string; aborted?: boolean }> = [];
let fail = params.has("fail");
let catalogFail = params.has("catalogFail");
let slow = params.has("slow");
let release: (() => void) | undefined;
const scope = window as unknown as { requests: typeof requests; invoke: typeof invokeNativePanel; switchAccount: () => void; changeChat: () => void; release: () => void };
scope.requests = requests; scope.invoke = invokeNativePanel;
scope.switchAccount = () => useStore.setState({ accountId: "other-fixture" });
scope.changeChat = () => useStore.setState({ activeChatId: `c${"b".repeat(32)}` });
scope.release = () => release?.();
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const path = String(input);
  const method = init?.method || "GET";
  const request = { path, method, aborted: false };
  requests.push(request);
  if (method !== "GET") throw new Error("Mutation forbidden in album fixture");
  const url = new URL(path, location.origin);
  const json = (value: unknown, status = 200) => Response.json(value, { status });
  if (url.pathname.endsWith("/notes/note-1")) return json({ result: { post: { contents: { text: "Existing note preserved" } } } });
  if (url.pathname.endsWith("/albums")) {
    if (catalogFail) { catalogFail = false; return json({ ok: false, error: "Catalog denied" }, 403); }
    if (!url.searchParams.get("chatId")) return json({ ok: false, error: "chatId required" }, 400);
    return json({ code: 0, result: { albums: [{ albumId: url.searchParams.has("cursor") ? "456" : "123", title: url.searchParams.has("cursor") ? "Other Album" : "Travel Album", photoCount: 2 }], cursor: url.searchParams.has("cursor") ? null : "albums-next", hasMore: !url.searchParams.has("cursor") } });
  }
  if (url.pathname.endsWith("/photos")) {
    if (slow) { slow = false; await new Promise<void>((resolve, reject) => {
      release = resolve;
      init?.signal?.addEventListener("abort", () => { request.aborted = true; reject(new DOMException("Aborted", "AbortError")); }, { once: true });
    }); }
    if (fail) { fail = false; return json({ ok: false, error: "Fixture denied" }, 403); }
    const other = url.pathname.includes("/456/");
    return json({ code: 0, result: { album: { albumId: other ? "456" : "123", title: other ? "Other Album" : "Travel Album" }, photos: params.has("empty") ? [] : [{ photoId: url.searchParams.has("cursor") ? "photo-2" : "photo-1", obsResourceId: { svc: "album", sid: url.searchParams.has("cursor") ? "v" : "a", oid: other ? "other-oid" : url.searchParams.has("cursor") ? "video-oid" : "image-oid" }, resourceType: url.searchParams.has("cursor") ? "VIDEO" : "IMAGE" }], nextCursor: !params.has("empty") && !url.searchParams.has("cursor") ? "photos-next" : null, hasMore: !params.has("empty") && !url.searchParams.has("cursor") } });
  }
  return json({ ok: true, members: [], groups: [] });
}) as typeof fetch;
const native = params.has("native");
useDesignSystemStore.setState({ mode: native ? "apple" : "legacy" });
useStore.setState({ accountId: "album-fixture", activeChatId: chatId, demoMode: false, chats: [chat], messages: [original], settings: { ...useStore.getState().settings, streamerMode: false } });
function Probe() { const panel = useNativePanelSnapshot(); return <pre id="panel">{JSON.stringify(panel)}</pre>; }
function App() {
  const [message] = useState(original);
  const child = params.has("menu") ? <PlusMenu chatId={chatId} embedded /> : <MessageBubble message={message} chat={chat} showAvatar={false} showName={false} />;
  return <>{native ? <NativeControllerSurface title="Album fixture" onClose={() => {}}>{child}</NativeControllerSurface> : child}<Probe /></>;
}
createRoot(document.getElementById("root")!).render(<App />);
