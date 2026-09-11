import { NativeControllerSurface } from "./native-controller-surface";
import { useEffect, useMemo } from "react";
import { useStore } from "@/lib/store";
import { StickerEmojiPanel } from "@/components/sticker-emoji-panel";
import { MessageBubble } from "@/components/message-bubble";
import { SettingsSections } from "@/components/settings-sections";
import { CreateGroupDialog } from "@/components/create-group-dialog";
import { getComposerController } from "./composer-controller";
import { PlusMenu } from "@/components/plus-menu";
import { KmpProfileController } from "./kmp-profile-controller";

export type CompatibilityRequest = {
  kind: "settings" | "stickers" | "message-actions" | "message" | "profile" | "member-profile" | "create-group" | "chat-tools";
  accountId: string | null;
  chatId?: string;
  messageId?: string;
  requestId?: string;
  menuPoint?: { x: number; y: number; width?: number };
  memberId?: string;
  initialSection?: "profile";
};

/** Specialized host features remain one implementation while the chat is native Compose. */
export function KmpCompatibility({
  request,
  onClose,
}: { request: CompatibilityRequest; onClose: () => void }) {
  const accountId = useStore((state) => state.accountId);
  const chat = useStore((state) => state.chats.find((entry) => entry.id === request.chatId));
  const message = useStore((state) =>
    state.messages.find(
      (entry) => entry.id === request.messageId && entry.chatId === request.chatId,
    ),
  );
  const activeChatId = useStore((state) => state.activeChatId);
  const actionsExpired = request.kind === "message-actions" && (activeChatId !== request.chatId || !message || !chat);
  const profileOpen = useStore((state) => state.profileDrawerOpen);
  const memberChat = useMemo(() => {
    const member = chat?.members?.find((entry) => entry.id === request.memberId);
    return member ? { id: member.id, type: "friend" as const, name: member.name, avatar: member.avatar,
      avatarUrl: member.avatarUrl, color: member.color, unread: 0, status: "" } : null;
  }, [chat, request.memberId]);
  useEffect(() => {
    if (actionsExpired || accountId !== request.accountId || (request.kind === "profile" && !profileOpen)) onClose();
  }, [actionsExpired, accountId, request.accountId, request.kind, profileOpen, onClose]);
  const composer = () => {
    const controller = getComposerController(request.chatId);
    return useStore.getState().accountId === request.accountId &&
      controller?.snapshot.accountId === request.accountId
      ? controller
      : null;
  };
  if (actionsExpired || accountId !== request.accountId) return null;
  if (request.kind === "profile" && chat) return <KmpProfileController key={chat.id} chat={chat} onClose={onClose} />;
  if (request.kind === "member-profile" && memberChat) return <KmpProfileController key={memberChat.id} chat={memberChat} onClose={onClose} />;
  const title = request.kind === "settings" ? "設定" : request.kind === "stickers" ? "スタンプ・絵文字" : request.kind === "chat-tools" ? "ノート・アルバム・イベント" : request.kind === "create-group" ? "グループを作成" : "メッセージの詳細";
  return <NativeControllerSurface title={title} onClose={onClose} presentation={request.kind === "stickers" ? "stickers" : request.kind === "chat-tools" ? "sheet" : undefined} dialogsOnly={request.kind === "message-actions"}>
    {request.kind === "settings" && <SettingsSections onBack={onClose} initialSection={request.initialSection} />}
    {request.kind === "create-group" && <CreateGroupDialog onClose={onClose} />}
    {request.kind === "stickers" && <StickerEmojiPanel embedded accountId={accountId}
      onPickSticker={(pack, id, premium) => { void composer()?.sendSticker(pack, id, premium); onClose(); }}
      onPickEmoji={(pack, id) => { composer()?.insertEmoji(pack, id); }}
      onSendCombinationSticker={async (items) => { await composer()?.sendCombinationSticker(items); onClose(); }} />}
    {request.kind === "message-actions" && chat && message && <MessageBubble key={request.requestId} message={message} chat={chat} showAvatar={false} showName={false} actionsOnly menuRequest={request.menuPoint} onActionsClose={onClose} />}
    {request.kind === "message" && chat && message && <MessageBubble message={message} chat={chat} showAvatar showName showActions />}
    {request.kind === "chat-tools" && chat && <PlusMenu chatId={chat.id} embedded />}
  </NativeControllerSurface>;
}
