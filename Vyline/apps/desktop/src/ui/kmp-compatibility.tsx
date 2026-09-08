import { useEffect, useLayoutEffect, useRef } from "react";
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
  const profileOpen = useStore((state) => state.profileDrawerOpen);
  const settingsDialogRef = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = settingsDialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, [request.kind, accountId, request.accountId]);
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
      <dialog
        ref={settingsDialogRef}
        className="vy-kmp-compat-settings m-0 h-full w-full max-h-none max-w-none border-0 p-0 text-[var(--vy-text)]"
        aria-modal="true"
        aria-label="詳細設定"
        onCancel={(event) => {
          event.stopPropagation();
          if (event.target !== event.currentTarget) return;
          event.preventDefault();
          onClose();
        }}
      >
        <SettingsSections onBack={onClose} initialSection={request.initialSection} />
      </dialog>
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
        {request.kind === "chat-tools" && chat && <PlusMenu chatId={chat.id} embedded />}
      </div>
    </ActionDialog>
  );
}
