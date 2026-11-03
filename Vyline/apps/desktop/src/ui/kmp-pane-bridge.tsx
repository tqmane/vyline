import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { displayName, memberDisplayName, useStore } from "@/lib/store";
import {
  emitAppEvent,
  matchesChatScrollLatestScope,
  onAppEvent,
  type ChatPresentation,
} from "@/lib/appEvents";
import { announcementMessageId, canToggleContactBlock } from "@/lib/chatActions";
import { canStartCall } from "@/utils/callAllowlist";
import { lineAvatarUrl } from "@/utils/lineMedia";
import { segmentTextWithMentions, type MentionDraft } from "@/utils/mention";
import type { SticonResource } from "@/utils/lineSticon";
import {
  composerReplyPreview,
  composerSelectionForDraft,
  useComposerController,
} from "./composer-controller";
import { createKmpMessageProjector } from "./kmp-model";
import { privacyPresentation, maskPrivacyText } from "@/lib/settingsPreferences";
import { useSearchPaneMessages, useSearchPaneState } from "@/lib/searchPane";
import type { KmpPaneSnapshot } from "./compose-contract";

const EMPTY_MENTIONS: MentionDraft[] = [];
const EMPTY_STICONS: SticonResource[] = [];

/** One presentation projection per mounted chat; product controllers stay in ChatShell. */
export function KmpPaneBridge({
  chatId,
  onChange,
}: { chatId: string; onChange: (id: string, value: KmpPaneSnapshot | null) => void }) {
  const accountId = useStore((state) => state.accountId);
  const chat = useStore((state) => state.chats.find((chat) => chat.id === chatId));
  const messages = useStore((state) => state.messages);
  const searchMessages = useSearchPaneMessages(accountId, chatId, messages);
  const searchState = useSearchPaneState(accountId, chatId);
  const unreadStart = useStore((state) => state.unreadBoundaries[chatId]?.messageId);
  const settings = useStore((state) => state.settings);
  const privacy = privacyPresentation(settings);
  const selfMid = useStore((state) => state.self.mid);
  const focused = useStore((state) => state.activeChatId === chatId);
  const locked = useStore((state) => state.lockedChatMids.includes(chatId));
  const blocked = useStore((state) => state.blockedMids.includes(chatId));
  const draft = useStore((state) => state.drafts[chatId] ?? "");
  const draftSticons = useStore((state) => state.draftSticons[chatId] ?? EMPTY_STICONS);
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
  const [{ count: scrollLatest, issuedAt: scrollLatestAt }, setScrollLatest] = useState({ count: 0, issuedAt: 0 });
  const [history, setHistory] = useState({ loading: false, hasMore: !!accountId });
  useEffect(() => {
    setPresentation(null);
    setHistory({ loading: false, hasMore: !!accountId });
    const offPresentation = onAppEvent("chat:presentation", (value) => {
      if (value.chatId === chatId && value.accountId === accountId) setPresentation(value);
    });
    const offScroll = onAppEvent("chat:scroll-latest", (value) => {
      if (matchesChatScrollLatestScope(value, chatId, accountId)) {
        const issuedAt = value.issuedAt ?? Date.now();
        setScrollLatest((value) => ({ count: value.count + 1, issuedAt }));
      }
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
            title: maskPrivacyText(displayName(chat, privacy.names), settings),
            status: maskPrivacyText(chat.status, settings),
            avatar: privacy.avatars ? "•" : chat.avatar,
            color: chat.color,
            avatarUrl:
              !privacy.avatars && chat.avatarUrl ? lineAvatarUrl(chat.avatarUrl) : undefined,
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
                name: maskPrivacyText(memberDisplayName(member.name, privacy.names), settings),
                avatar: privacy.avatars ? "•" : member.avatar,
                color: member.color,
                avatarUrl:
                  !privacy.avatars && member.avatarUrl
                    ? lineAvatarUrl(member.avatarUrl)
                    : undefined,
              })) ?? [],
          }
        : null,
    [chat, privacy.names, privacy.avatars, privacy.urls, locked, blocked, accountId],
  );
  const project = useMemo(createKmpMessageProjector, []);
  const messageModel = useMemo(
    () => project(searchMessages, chat, settings.streamerMode, selfMid, unreadStart, settings),
    [project, searchMessages, chat, settings, selfMid, unreadStart],
  );
  const composer = useMemo(() => {
    const current = controller?.snapshot.accountId === accountId ? controller.snapshot : null;
    const selection = composerSelectionForDraft(draft, current);
    const replyFallback = maskPrivacyText(reply?.text || reply?.altText || "", settings);
    return {
      text: draft,
      replyToId: reply?.id,
      replyText: maskPrivacyText(composerReplyPreview(current, reply?.id, replyFallback) ?? "", settings),
      pending: current?.pending ?? [],
      recording: current?.recording ?? false,
      recordingSeconds: current?.recordingSeconds ?? 0,
      recordingLevels: current?.recordingLevels ?? [],
      sending: current?.sending ?? false,
      enterToSend: current?.enterToSend ?? settings.enterToSend,
      voiceEnabled: current?.voiceEnabled ?? settings.voiceMessagesEnabled,
      mute: current?.mute ?? settings.alwaysMuteMessages,
      available: !!current,
      canSendMedia: !!accountId,
      selectionStart: selection.start,
      selectionEnd: selection.end,
      mentionOptions: current?.mentionOptions ?? [],
      mentionIndex: current?.mentionIndex ?? 0,
      segments:
        draftSticons.length || draftMentions.length
          ? segmentTextWithMentions(draft, draftSticons, draftMentions)
          : undefined,
    };
  }, [
    controller,
    accountId,
    draft,
    draftSticons,
    draftMentions,
    reply,
    settings.enterToSend,
    settings.voiceMessagesEnabled,
    settings.alwaysMuteMessages,
    settings.streamerMode,
    settings.streamerMaskNames,
    settings.streamerMaskUrls,
  ]);
  const announcements = useMemo(
    () =>
      (sourceAnnouncements ?? []).map((item) => ({
        id: item.announcementSeq,
        text: maskPrivacyText(item.text, settings),
        messageId: announcementMessageId(item.link),
      })),
    [sourceAnnouncements, settings.streamerMode, settings.streamerMaskNames, settings.streamerMaskUrls],
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
      highlightMessageId: messageModel.some((message) => message.id === (searchState?.scrollId ?? highlightMessageId))
        ? searchState?.scrollId ?? highlightMessageId
        : null,
      scrollLatest,
      scrollLatestAt,
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
      searchState?.scrollId,
      scrollLatest,
      scrollLatestAt,
      focused,
      profileOpen,
    ],
  );
  useLayoutEffect(() => onChange(chatId, value), [onChange, chatId, value]);
  useEffect(() => () => onChange(chatId, null), [onChange, chatId]);
  return null;
}
