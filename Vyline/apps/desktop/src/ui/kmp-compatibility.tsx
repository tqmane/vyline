import { useEffect } from "react";
import { useStore } from "@/lib/store";
import { ActionDialog } from "@/components/action-dialog";
import { StickerEmojiPanel } from "@/components/sticker-emoji-panel";
import { MessageBubble } from "@/components/message-bubble";
import { ProfileDrawer } from "@/components/profile-drawer";
import { SettingsSections } from "@/components/settings-sections";
import { CreateGroupDialog } from "@/components/create-group-dialog";
import { getComposerController } from "./composer-controller";
import { PlusMenu } from "@/components/plus-menu";

export type CompatibilityRequest = {
  kind: "settings" | "stickers" | "message" | "profile" | "create-group" | "chat-tools";
  accountId: string | null;
  chatId?: string;
  messageId?: string;
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
  const profileOpen = useStore((state) => state.profileDrawerOpen);
  useEffect(() => {
    if (accountId !== request.accountId || (request.kind === "profile" && !profileOpen)) onClose();
  }, [accountId, request.accountId, request.kind, profileOpen, onClose]);
  const composer = () => {
    const controller = getComposerController(request.chatId);
    return useStore.getState().accountId === request.accountId &&
      controller?.snapshot.accountId === request.accountId
      ? controller
      : null;
  };
  if (accountId !== request.accountId) return null;
  if (request.kind === "settings")
    return (
      <div className="vy-kmp-compat-settings" role="dialog" aria-modal="true" aria-label="詳細設定">
        <SettingsSections onBack={onClose} />
      </div>
    );
  if (request.kind === "create-group") return <CreateGroupDialog onClose={onClose} />;
  return (
    <ActionDialog
      title={
        request.kind === "stickers"
          ? "スタンプ・絵文字"
          : request.kind === "profile"
            ? "会話の詳細"
            : request.kind === "chat-tools"
              ? "ノート・アルバム・イベント"
              : "メッセージの詳細"
      }
      onClose={onClose}
    >
      <div className="vy-kmp-compat" data-renderer-compatibility={request.kind}>
        {request.kind === "stickers" && (
          <StickerEmojiPanel
            embedded
            accountId={accountId}
            onPickSticker={(pack, id, premium) => {
              void composer()?.sendSticker(pack, id, premium);
              onClose();
            }}
            onPickEmoji={(pack, id) => {
              composer()?.insertEmoji(pack, id);
              onClose();
            }}
            onSendCombinationSticker={async (items) => {
              await composer()?.sendCombinationSticker(items);
              onClose();
            }}
          />
        )}
        {request.kind === "message" && chat && message && (
          <MessageBubble message={message} chat={chat} showAvatar showName showActions />
        )}
        {request.kind === "profile" && chat && <ProfileDrawer chat={chat} />}
        {request.kind === "chat-tools" && chat && (
          <>
            {!accountId && (
              <p className="mb-3 text-[var(--vy-text-dim)]">ログイン後に利用できます。</p>
            )}
            <PlusMenu chatId={chat.id} embedded />
          </>
        )}
      </div>
    </ActionDialog>
  );
}
