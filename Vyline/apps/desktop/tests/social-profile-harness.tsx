// Isolated fake account. No backend or live LINE session is used.
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { BrowserRouter } from "react-router-dom";
import { useStore, type Chat } from "../src/lib/store";
import { MidSearchProfile } from "../src/components/mid-search-profile";
import { ProfileDrawer } from "../src/components/profile-drawer";
import { MemberProfilePopover } from "../src/components/member-profile";
import { CreateGroupDialog } from "../src/components/create-group-dialog";
import { PlusMenu } from "../src/components/plus-menu";
import { Sidebar } from "../src/components/sidebar";
import { useAuthStore } from "../src/stores/authStore";
import { KmpProfileController } from "../src/ui/kmp-profile-controller";
import { NativeControllerSurface } from "../src/ui/native-controller-surface";
import { useNativePanelSnapshot, invokeNativePanel } from "../src/ui/native-panel";
import { useControllerDialogSnapshot, closeControllerDialog } from "../src/ui/controller-dialog";
import { useDesignSystemStore } from "../src/ui/design-system-store";
import "../src/index.css";

const params = new URLSearchParams(location.search);
const screen = params.get("screen") || "mid";
const native = params.get("native") === "1";
const mid = `u${"a".repeat(32)}`;
const selfMid = `u${"b".repeat(32)}`;
const groupId = `c${"c".repeat(32)}`;
const image = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Crect width='40' height='40' fill='red'/%3E%3C/svg%3E";
const urlText = params.has("urlText") ? " www.secret.example/private" : "";
const avatar = params.has("noImage") ? "" : image;
const profile = { mid, displayName: `Alice${urlText}`, thumbnailUrl: avatar, backgroundUrl: image, statusMessage: "status https://secret.example/private www.secret.example/other" };
const contact: Chat = { id: mid, type: "friend", isFriend: true, name: profile.displayName, avatar: "A", avatarUrl: avatar, backgroundUrl: image, color: "red", status: "Preview https://secret.example/private www.secret.example/other", statusMessage: profile.statusMessage, unread: 0 };
const group: Chat = { id: groupId, type: "group", name: "Group", avatar: "G", color: "red", status: "", unread: 0, members: [{ id: mid, name: profile.displayName, avatar: "A", avatarUrl: avatar, color: "red" }] };
let friend = false;
const requests: Array<{ path: string; method: string; body?: unknown }> = [];
const scope = window as unknown as { requests: typeof requests; invoke: typeof invokeNativePanel; switchAccount: () => void; accept: () => void; setMasks: (value: string) => void; copied: string };
scope.requests = requests; scope.invoke = invokeNativePanel;
scope.switchAccount = () => useStore.setState({ accountId: "other-fixture" });
scope.setMasks = value => useStore.setState(state => ({ settings: { ...state.settings, streamerMode: value !== "off", streamerMaskNames: value.includes("names"), streamerMaskAvatars: value.includes("avatars"), streamerMaskUrls: value.includes("urls") } }));
scope.copied = "";
Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value: string) => { scope.copied = value; } } });
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const path = String(input);
  const method = init?.method || "GET";
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
  requests.push({ path, method, body });
  if (path.includes("/social/profile/")) return Response.json({ ok: true, profile, isFriend: friend, isBlocked: false, blockedStale: false });
  if (path.includes("/social/friends/")) { friend = method === "POST"; return Response.json({ ok: true }); }
  if (path.includes("/social/chats")) return Response.json({ ok: true, chat: { chatMid: groupId, name: "Created" } });
  if (path.includes("/contact/")) return Response.json({ ok: true, profile });
  if (path.includes("/common-groups")) return Response.json({ ok: true, groups: [] });
  if (path.includes("/blocked")) return Response.json({ ok: true, mids: [], stale: true, syncedAt: 1 });
  if (path.includes("/feature-locks")) return Response.json({ ok: true, locks: {} });
  if (path.includes("/notes/post1")) return Response.json({ result: { post: { postInfo: { postId: "post1", writerMid: selfMid, likeCount: 3 }, contents: { text: "first\nsecond", stickers: [{ id: "1", packageId: "1" }], media: [{ objectId: "fixture", type: "PHOTO" }] } }, comments: [{ id: "comment1", text: "A comment", writer: { displayName: "Bob" } }] } });
  if (path.includes("/notes")) return Response.json({ result: { posts: [{ postInfo: { postId: "post1" }, contents: { text: "first\nsecond" } }] } });
  return Response.json({ ok: true, groups: [], members: [], locks: {} });
}) as typeof fetch;
localStorage.setItem("vyline:beta-feature-consent-v1", JSON.stringify({ "mid-user-search": { consentedAt: "2026-11-03T00:00:00Z", version: "1" } }));
useDesignSystemStore.setState({ mode: native ? "apple" : "legacy" });
const settings = { ...useStore.getState().settings, betaMidSearch: true, showBackground: true, showStatusMessage: true, streamerMode: params.get("privacy") === "1", streamerMaskNames: false, streamerMaskAvatars: true, streamerMaskUrls: true };
useStore.setState({ accountId: "social-fixture", demoMode: false, chats: [contact, group], blockedMids: [], settings, self: { ...useStore.getState().self, mid: selfMid, name: "SelfName", avatar: "S", avatarUrl: avatar }, memberProfile: { chatId: groupId, memberId: mid }, refreshChats: async () => {}, refreshChatsSilently: async () => true, openChat: () => {}, openDirectChatWith: () => {} });
if (params.has("masks")) scope.setMasks(params.get("masks")!);
useAuthStore.setState({ accounts: ["social-fixture"], sessions: [{ accountId: "social-fixture", displayName: "SelfName", hasToken: true, picturePath: avatar }] });

function Probe() {
  const panel = useNativePanelSnapshot();
  const dialog = useControllerDialogSnapshot();
  scope.accept = () => { if (dialog) closeControllerDialog(dialog.id, ""); };
  return <><pre id="panel" data-testid="panel">{JSON.stringify(panel)}</pre><pre id="confirmation">{JSON.stringify(dialog)}</pre></>;
}
function App() {
  const [closed, close] = useState(false);
  const onClose = () => close(true);
  let content = screen === "sidebar" ? <Sidebar /> : screen === "group" ? <CreateGroupDialog onClose={onClose} /> : screen === "profile" ? native ? <KmpProfileController chat={contact} onClose={onClose} /> : <ProfileDrawer chat={contact} /> : screen === "member" ? <MemberProfilePopover chat={group} /> : screen === "note" ? <PlusMenu chatId={groupId} embedded /> : <MidSearchProfile mid={mid} onClose={onClose} />;
  if (closed) content = <p>Closed</p>;
  return <>{native && screen !== "profile" ? <NativeControllerSurface title="Fixture" onClose={onClose}>{content}</NativeControllerSurface> : content}<Probe /></>;
}
createRoot(document.getElementById("root")!).render(<BrowserRouter><App /></BrowserRouter>);
