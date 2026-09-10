import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { displayName, memberDisplayName, useStore } from "@/lib/store";
import { emitAppEvent, onAppEvent, type ChatPresentation } from "@/lib/appEvents";
import { announcementMessageId, canToggleContactBlock } from "@/lib/chatActions";
import { canStartCall } from "@/utils/callAllowlist";
import { lineAvatarUrl } from "@/utils/lineMedia";
import { segmentTextWithMentions, type MentionDraft } from "@/utils/mention";
import { useComposerController } from "./composer-controller";
import { createKmpMessageProjector } from "./kmp-model";
import type { KmpPaneSnapshot } from "./compose-contract";

const EMPTY_MENTIONS: MentionDraft[] = [];

/** One presentation projection per mounted chat; product controllers stay in ChatShell. */
export function KmpPaneBridge({
  chatId,
  onChange,
}: { chatId: string; onChange: (id: string, value: KmpPaneSnapshot | null) => void }) {
  const accountId = useStore((state) => state.accountId);
  const chat = useStore((state) => state.chats.find((chat) => chat.id === chatId));
  const messages = useStore((state) => state.messages);
  const settings = useStore((state) => state.settings);
  const selfMid = useStore((state) => state.self.mid);
  const focused = useStore((state) => state.activeChatId === chatId);
  const locked = useStore((state) => state.lockedChatMids.includes(chatId));
  const blocked = useStore((state) => state.blockedMids.includes(chatId));
  const draft = useStore((state) => state.drafts[chatId] ?? "");
  const draftMentions = useStore((state) => state.draftMentions[chatId] ?? EMPTY_MENTIONS);
  const reply = useStore((state) =>
    state.messages.find((message) => message.id === state.replyToId && message.chatId === chatId),
  );
  const readersPanel = useStore((state) =>
    state.readersPanel?.chatId === chatId ? state.readersPanel : null,
  );
  const sourceAnnouncements = useStore((state) => state.announcements[chatId]);
  const highlightMessageId = useStore((state) => state.highlightMessageId);
  const profileOpen = useStore((state) => state.profileDrawerOpen);
  const controller = useComposerController(chatId);
  const [presentation, setPresentation] = useState<ChatPresentation | null>(null);
  const [scrollLatest, setScrollLatest] = useState(0);
  const [history, setHistory] = useState({ loading: false, hasMore: !!accountId });
  useEffect(() => {
    setPresentation(null);
    setHistory({ loading: false, hasMore: !!accountId });
    const offPresentation = onAppEvent("chat:presentation", (value) => {
      if (value.chatId === chatId && value.accountId === accountId) setPresentation(value);
    });
    const offScroll = onAppEvent("chat:scroll-latest", (value) => {
      if (value.chatId === chatId) setScrollLatest((value) => value + 1);
    });
    const offHistory = onAppEvent("history:state", (value) => {
      if (value.chatMid === chatId) setHistory({ loading: value.loading, hasMore: value.hasMore });
    });
    emitAppEvent("chat:presentation-request", { chatId });
    return () => {
      offPresentation();
      offScroll();
      offHistory();
    };
  }, [chatId, accountId]);
  const chatModel = useMemo(
    () =>
      chat
        ? {
            id: chat.id,
            title: displayName(chat, settings.streamerMode),
            status: chat.status,
            avatar: settings.streamerMode ? "•" : chat.avatar,
            color: chat.color,
            avatarUrl:
              !settings.streamerMode && chat.avatarUrl ? lineAvatarUrl(chat.avatarUrl) : undefined,
            isGroup: chat.type === "group",
            locked,
            blocked,
            muted: !!chat.muted,
            pinned: !!chat.pinned,
            canCall: !!accountId && canStartCall(chat.id, "voice"),
            canVideoCall: !!accountId && canStartCall(chat.id, "video"),
            canBlock: canToggleContactBlock(chat.id),
            members:
              chat.members?.map((member) => ({
                id: member.id,
                name: memberDisplayName(member.name, settings.streamerMode),
                avatar: settings.streamerMode ? "•" : member.avatar,
                color: member.color,
                avatarUrl:
                  !settings.streamerMode && member.avatarUrl
                    ? lineAvatarUrl(member.avatarUrl)
                    : undefined,
              })) ?? [],
          }
        : null,
    [chat, settings.streamerMode, locked, blocked, accountId],
  );
  const project = useMemo(createKmpMessageProjector, []);
  const messageModel = useMemo(
    () => project(messages, chat, settings.streamerMode, selfMid),
    [project, messages, chat, settings.streamerMode, selfMid],
  );
  const composer = useMemo(() => {
    const current = controller?.snapshot.accountId === accountId ? controller.snapshot : null;
    return {
      text: draft,
      replyToId: reply?.id,
      replyText: current?.replyText || reply?.text || reply?.altText,
      pending: current?.pending ?? [],
      recording: current?.recording ?? false,
      recordingSeconds: current?.recordingSeconds ?? 0,
      sending: current?.sending ?? false,
      enterToSend: current?.enterToSend ?? settings.enterToSend,
      voiceEnabled: current?.voiceEnabled ?? settings.voiceMessagesEnabled,
      mute: current?.mute ?? settings.alwaysMuteMessages,
      available: !!current,
      canSendMedia: !!accountId,
      selectionStart: current?.selectionStart,
      selectionEnd: current?.selectionEnd,
      mentionOptions: current?.mentionOptions ?? [],
      mentionIndex: current?.mentionIndex ?? 0,
      segments:
        current?.sticons.length || draftMentions.length
          ? segmentTextWithMentions(draft, current?.sticons ?? [], draftMentions)
          : undefined,
    };
  }, [
    controller,
    accountId,
    draft,
    draftMentions,
    reply,
    settings.enterToSend,
    settings.voiceMessagesEnabled,
    settings.alwaysMuteMessages,
  ]);
  const announcements = useMemo(
    () =>
      (sourceAnnouncements ?? []).map((item) => ({
        id: item.announcementSeq,
        text: item.text,
        messageId: announcementMessageId(item.link),
      })),
    [sourceAnnouncements],
  );
  const chatUi = useMemo(
    () =>
      presentation
        ? {
            search: presentation.search,
            groupCall: presentation.groupCall,
            joiningCall: presentation.joiningCall,
            refreshing: presentation.refreshing,
            announcementExpanded: presentation.announcementExpanded,
          }
        : null,
    [presentation],
  );
  const value = useMemo<KmpPaneSnapshot>(
    () => ({
      id: chatId,
      chat: chatModel,
      messages: messageModel,
      composer,
      announcements,
      chatUi,
      history,
      readersPanel,
      highlightMessageId: messageModel.some((message) => message.id === highlightMessageId)
        ? highlightMessageId
        : null,
      scrollLatest,
      profileOpen: focused && profileOpen,
    }),
    [
      chatId,
      chatModel,
      messageModel,
      composer,
      announcements,
      chatUi,
      history,
      readersPanel,
      highlightMessageId,
      scrollLatest,
      focused,
      profileOpen,
    ],
  );
  useLayoutEffect(() => onChange(chatId, value), [onChange, chatId, value]);
  useEffect(() => () => onChange(chatId, null), [onChange, chatId]);
  return null;
}
