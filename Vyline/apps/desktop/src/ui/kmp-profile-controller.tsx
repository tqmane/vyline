import { memo } from "react";
import type { Chat } from "@/lib/store";
import { useStore, displayName } from "@/lib/store";
import { useProfileController } from "@/hooks/useProfileController";
import { useGroupInvitation } from "@/components/profile-drawer";
import { canStartCall } from "@/utils/callAllowlist";
import { lineAvatarUrl } from "@/utils/lineMedia";
import { usePublishNativePanel, type NativePanelControl } from "./native-panel";
import { NativeControllerSurface } from "./native-controller-surface";
import { AgentIActionDialog } from "@/components/agent-i-action-dialog";
import { MediaLightbox } from "@/components/media-lightbox";
import { maskSocialUrls } from "@/lib/socialPresentation";

// The panel's confirmation is resolved before these existing controller actions execute.
const confirmed = () => true;
export const KmpProfileController = memo(function KmpProfileController({ chat, onClose }: { chat: Chat; onClose: () => void }) {
  const data = useProfileController(chat, confirmed);
  const invitation = useGroupInvitation(chat.id, data.accountId, data.setActionMsg);
  const items: NativePanelControl[] = [];
  const button = (id: string, label: string, onClick: NonNullable<NativePanelControl["onClick"]>, extra: Partial<NativePanelControl> = {}): NativePanelControl => ({ id, kind: "button", label, onClick, ...extra });
  if (data.showBackground && data.backgroundUrl) items.push({ id: "background", kind: "image", label: "背景", url: lineAvatarUrl(data.backgroundUrl) });
  items.push({ id: "identity", kind: "avatar", label: data.name, value: data.streamerMode || data.privacy.avatars ? "•" : chat.avatar,
    url: !data.privacy.avatars && chat.avatarUrl ? lineAvatarUrl(chat.avatarUrl) : undefined });
  if (!data.privacy.avatars && chat.avatarUrl && !chat.isSelf) items.push(button("zoom-avatar", "アイコンを拡大", () => data.setZoomImage(chat.avatarUrl!)));
  if (data.showBackground && data.backgroundUrl) items.push(button("zoom-background", "背景を拡大", () => data.setZoomImage(data.backgroundUrl!)));
  if (!data.streamerMode) {
    if (chat.isOfficial || data.rich.userType === 2) items.push({ id: "official", kind: "text", label: "公式アカウント" });
    if (chat.isSelf && data.selfPremium) items.push({ id: "premium", kind: "text", label: "LYPプレミアム" });
    if (data.settings.showStatusMessage && (chat.statusMessage ?? data.rich.statusMessage)) items.push({ id: "status", kind: "text", label: maskSocialUrls(chat.statusMessage ?? data.rich.statusMessage ?? "", data.privacy.urls) });
    items.push({ id: "mid", kind: "text", label: chat.id });
    if (!chat.isSelf) items.push(data.editing
      ? { id: "name-edit", kind: "section", label: "表示名", items: [
          { id: "name", kind: "input", label: chat.type === "friend" ? "友だち表示名" : "表示名（ローカル）", value: data.nameInput, onChange: data.setNameInput },
          button("save-name", "保存", data.saveName, { disabled: data.busy, primary: true }),
        ] }
      : button("edit-name", "表示名を変更", () => data.setEditing(true)));
  }
  if (chat.left) items.push({ id: "left", kind: "text", label: chat.type === "friend" ? "アカウント削除済み" : "退出済み", danger: true });
  if (data.isBlocked) items.push({ id: "blocked", kind: "text", label: "ブロック中", danger: true });
  if (data.friendship.contact) items.push(button("friend", data.friendship.busy ? "処理中…" : data.friendship.contact.isFriend ? "友だちから削除" : "友だちに追加", data.friendship.changeFriend,
    { disabled: data.friendship.busy || (!data.friendship.contact.isFriend && (data.isBlocked || data.friendship.contact.isBlocked || data.friendship.contact.blockedStale)) }));
  if (data.friendship.contact?.blockedStale) items.push({ id: "blocked-stale", kind: "text", label: "ブロック情報は古い可能性があります。" });
  if (data.friendship.error) items.push({ id: "friend-error", kind: "text", label: data.friendship.error }, button("friend-retry", "友だち状態を再取得", data.friendship.retry));
  items.push({ id: "actions", kind: "section", label: "トーク", items: [
    button("talk", "トークを開く", () => { data.handleTalk(); onClose(); }),
    ...(["voice", "video"] as const).map((kind) => button(`call-${kind}`, kind === "video" ? "ビデオ通話" : "音声通話", () => data.placeCall(kind), {
      disabled: !data.accountId || !canStartCall(chat.id, kind),
      confirm: `${data.name} の${kind === "video" ? "ビデオ" : "音声"}通話を開始・参加しますか？`,
    })),
    button("export", "トーク保存", data.exportConversation, { disabled: !data.accountId }),
  ] });
  if (!data.streamerMode && data.settings.betaBlockCheckManual && chat.type === "friend" && !chat.isOfficial) {
    items.push(button("verify-block", data.verifyBusy ? "ブロック状態を確認中…" : "ブロック状態を確認", data.verifyBlockStatus, { disabled: data.verifyBusy }));
    if (data.verifyMsg) items.push({ id: "verify-result", kind: "text", label: data.verifyMsg });
  }
  if (!data.streamerMode && chat.type === "friend" && !chat.isSelf && data.commonGroups.length) items.push({ id: "common", kind: "section", label: `共通のグループ (${data.commonGroups.length})`, items: data.commonGroups.map((group) => button(`common-${group.id}`, maskSocialUrls(displayName(group, false), data.privacy.urls), () => { onClose(); data.openChat(group.id); })) });
  if (chat.type === "group" && !chat.left) {
    items.push({ id: "members", kind: "section", label: `メンバー ${chat.members?.length ?? 0}人`, items: (chat.members ?? []).map((member) => button(`member-${member.id}`, data.streamerMode ? "メンバー" : maskSocialUrls(member.name, data.privacy.urls), () => {
      useStore.getState().openMemberProfile(chat.id, member.id);
    })) });
    if (!data.streamerMode && data.accountId) {
      items.push(button("invite-open", invitation.open ? "招待を閉じる" : "メンバーを招待", () => invitation.setOpen(!invitation.open)));
      if (invitation.open) items.push({ id: "invite", kind: "section", label: "メンバーを招待", items: [
        { id: "invite-mids", kind: "input", label: "招待する mid（改行またはカンマ区切り）", multiline: true, value: invitation.mids, onChange: invitation.setMids },
        button("invite-send", invitation.busy ? "招待中…" : "招待する", invitation.invite, { disabled: invitation.busy, primary: true }),
      ] });
    }
  }
  if (!data.streamerMode && !chat.isSelf) items.push(button("leave-block", chat.type === "group" ? chat.left ? "一覧から削除" : "グループを退出" : data.isBlocked ? "ブロックを解除" : "ブロック", data.leaveOrBlock,
    { danger: true, disabled: data.busy, confirm: chat.type === "group" ? `「${data.name}」${chat.left ? "を一覧から削除" : "から退出"}しますか？` : `「${data.name}」のブロック${data.isBlocked ? "を解除" : "を設定"}しますか？` }));
  if (!data.privacy.names && data.actionMsg) items.push({ id: "result", kind: "text", label: maskSocialUrls(data.actionMsg, data.privacy.urls) });
  if (!data.streamerMode && data.settings.betaAgentI && chat.type === "friend" && !chat.isSelf) items.push(button("agent-summary", "AIでこの人との会話を要約", () => data.setAgentPrompt(`次の「${data.name}」とのこれまでの会話を日本語で5行以内に要約してください。重要な決定、約束、TODOを含めてください。\n\n${data.conversationText}`), { disabled: !data.conversationText }));
  usePublishNativePanel({ accountId: data.accountId, title: "プロフィール", items, onClose }, !data.agentPrompt && !data.zoomImage);
  if (data.zoomImage && !data.privacy.avatars) return <NativeControllerSurface title="プロフィール画像" onClose={() => data.setZoomImage(null)}><MediaLightbox src={lineAvatarUrl(data.zoomImage) ?? ""} alt="プロフィール画像" onClose={() => data.setZoomImage(null)} /></NativeControllerSurface>;
  return data.agentPrompt ? <NativeControllerSurface title="会話の要約" onClose={() => data.setAgentPrompt(null)}>
    <AgentIActionDialog title={`${data.name}との会話の要約`} prompt={data.agentPrompt} onClose={() => data.setAgentPrompt(null)} />
  </NativeControllerSurface> : null;
});
