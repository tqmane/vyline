import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type UIEvent,
  type DragEvent,
} from "react";
import { useStore, displayName, type Message } from "@/lib/store";
import { cn } from "@/lib/utils";
import { useVirtualList, type VirtualRow } from "@/hooks/useVirtualList";
import { useGroupCallStatus } from "@/hooks/useGroupCallStatus";
import { GroupCallBanner } from "@/components/call-event-message";
import { MessageBubble } from "@/components/message-bubble";
import { MessageInput } from "@/components/message-input";
import { ProfileDrawer } from "@/components/profile-drawer";
import { MemberProfilePopover } from "@/components/member-profile";
import { MessageContextMenu, type MenuItem } from "@/components/message-context-menu";
import { Avatar } from "@/components/vy-ui";
import { OfficialBadge } from "@/components/official-badge";
import {
  IconArrowLeft,
  IconSearch,
  IconMore,
  IconClose,
  IconChevron,
  IconBell,
  IconBellOff,
  IconPalette,
  IconArrowDown,
  IconMemo,
  IconPin,
  IconRefresh,
  IconTag,
} from "@/components/icons";
import { AgentIActionDialog } from "@/components/agent-i-action-dialog";
import { isNearScrollBottom } from "@/lib/chatScroll";
import { shareImageMediaGroup } from "@/lib/mediaGroup";
import { emitAppEvent, onAppEvent, type ChatPresentation } from "@/lib/appEvents";
import { isDesktopInteraction } from "@/lib/interactionEnvironment";
import { useDesignTheme } from "@/ui/design-theme";
import { isComposeMode } from "@/ui/design-system-store";
import { compareMessagesOldestFirst } from "@/lib/messageOrder";
import { announcementMessageId, removeChatAnnouncement } from "@/lib/chatActions";
import { useMessageSearch } from "@/lib/searchMessages";
import { searchPaneMessages } from "@/lib/searchPane";
import { dispatchSearchCommand, searchPresentation } from "@/lib/searchController";
import { maskPrivacyText, privacyPresentation } from "@/lib/settingsPreferences";

function dayLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  if (isToday) return "今日";
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "昨日";
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

type MsgRow =
  | { key: string; kind: "day"; label: string }
  | { key: string; kind: "unread"; label: string }
  | {
      key: string;
      kind: "msg";
      message: Message;
      mediaGroup?: Message[];
      index: number;
      sameAuthorAsPrev: boolean;
      sameAuthorAsNext: boolean;
      isMatch: boolean;
      isActive: boolean;
      flash: boolean;
      searching: boolean;
      highlight?: string;
    };

type ChatAreaProps = {
  chatId?: string;
  paneCount?: number;
  onFocus?: () => void;
  onClosePane?: () => void;
  reserveSidebarToggle?: boolean;
  onPaneDragStart?: (event: DragEvent<HTMLDivElement>) => void;
};

function ChatAreaBase({
  chatId,
  paneCount = 1,
  onFocus,
  onClosePane,
  reserveSidebarToggle = true,
  onPaneDragStart,
}: ChatAreaProps) {
  const desktopInteraction = isDesktopInteraction();
  const storeActiveChatId = useStore((s) => s.activeChatId);
  const { theme, mode } = useDesignTheme();
  const activeChatId = chatId ?? storeActiveChatId;
  const isFocusedPane = !chatId || storeActiveChatId === activeChatId;
  const chats = useStore((s) => s.chats);
  const messages = useStore((s) => s.messages);
  const unreadStart = useStore((s) => activeChatId ? s.unreadBoundaries[activeChatId]?.messageId : null);
  const setScreen = useStore((s) => s.setScreen);
  const closeChat = useStore((s) => s.closeChat);
  const storedProfileOpen = useStore((s) => s.profileDrawerOpen);
  const profileOpen = storedProfileOpen && isFocusedPane;
  const setProfileDrawer = useStore((s) => s.setProfileDrawer);
  const streamerMode = useStore((s) => s.settings.streamerMode);
  const privacySettings = useStore(s => s.settings);
  const privacy = privacyPresentation(privacySettings);
  const agentEnabled = useStore((s) => s.settings.betaAgentI);
  const toggleMute = useStore((s) => s.toggleMute);
  const memberProfile = useStore((s) => s.memberProfile);
  const highlightMessageId = useStore((s) => s.highlightMessageId);
  const accountId = useStore((s) => s.accountId);
  const demoMode = useStore((s) => s.demoMode);
  const callRequest = useStore((s) => s.callRequest);
  const requestCall = useStore((s) => s.requestCall);
  const refreshMessages = useStore((s) => s.refreshMessages);
  const showNotice = useStore((s) => s.showNotice);
  const markChatRead = useStore((s) => s.markChatRead);
  const scrollToMessage = useStore((s) => s.scrollToMessage);
  const announcements = useStore((s) => s.announcements);
  const openReadersMessageId = useStore((s) =>
    s.readersPanel?.chatId === activeChatId ? s.readersPanel.messageId : null,
  );

  const { controller: searchController, state: search } = useMessageSearch(accountId, activeChatId, demoMode);
  const [panel, setPanel] = useState<{ x: number; y: number } | null>(null);
  const [refreshingChat, setRefreshingChat] = useState<string | null>(null);
  const refreshKey = `${accountId}:${activeChatId}`;
  const refreshCurrentChat = async () => {
    if (!activeChatId || !accountId || demoMode || refreshingChat === refreshKey) return;
    const key = refreshKey;
    setRefreshingChat(key);
    try {
      await refreshMessages(activeChatId, { force: true });
    } catch {
      if (useStore.getState().accountId === accountId) {
        showNotice("トークを再取得できませんでした。もう一度お試しください");
      }
    } finally {
      setRefreshingChat((current) => (current === key ? null : current));
    }
  };
  const [agentPrompt, setAgentPrompt] = useState<string | null>(null);
  const [olderState, setOlderState] = useState({ hasMore: true, loading: false });
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [announcementExpandedByChat, setAnnouncementExpandedByChat] = useState<
    Record<string, boolean>
  >({});

  const chat = chats.find((c) => c.id === activeChatId) ?? null;
  const announcementExpanded = activeChatId
    ? (announcementExpandedByChat[activeChatId] ?? false)
    : false;
  const updateProfileDrawer = useCallback(
    (open: boolean) => {
      onFocus?.();
      setProfileDrawer(open);
    },
    [onFocus, setProfileDrawer],
  );
  const closeCurrentChat = useCallback(() => {
    onFocus?.();
    if (onClosePane) onClosePane();
    else closeChat();
  }, [closeChat, onClosePane, onFocus]);

  const chatMessages = useMemo(
    () => messages.filter((m) => m.chatId === activeChatId).sort(compareMessagesOldestFirst),
    [messages, activeChatId],
  );
  const displayMessages = useMemo(
    () => searchPaneMessages(search, messages, accountId, activeChatId)
      .filter((m) => m.chatId === activeChatId).sort(compareMessagesOldestFirst),
    [messages, activeChatId, accountId, search.window],
  );

  const latestGroupCallEvent = chatMessages
    .filter((message) => message.kind === "call" && message.callMeta?.group)
    .at(-1);
  const groupCall = useGroupCallStatus(
    demoMode ? null : accountId,
    activeChatId ?? undefined,
    latestGroupCallEvent?.id,
  );
  const joinGroupCall = useCallback(() => {
    if (!chat || !groupCall || callRequest || useStore.getState().accountId !== accountId) return;
    const label = groupCall.kind === "video" ? "ビデオ通話" : "音声通話";
    if (!window.confirm(`${displayName(chat, streamerMode)} の${label}に参加しますか？`)) return;
    requestCall(chat.id, groupCall.kind, true);
  }, [accountId, callRequest, chat, groupCall, requestCall, streamerMode]);

  const matches = useMemo(() => search.hits.map((hit) => hit.id), [search.hits]);

  const activeMatchId = matches.length ? matches[search.index % matches.length] : null;
  const presentation = useMemo<ChatPresentation | null>(
    () =>
      activeChatId
        ? {
            chatId: activeChatId,
            accountId,
            search: searchPresentation(search, privacySettings),
            groupCall: groupCall
              ? { kind: groupCall.kind, memberCount: groupCall.memberCount }
              : null,
            joiningCall: !!callRequest,
            refreshing: refreshingChat === refreshKey,
            announcementExpanded,
          }
        : null,
    [
      activeChatId,
      accountId,
      search,
      privacySettings,
      matches.length,
      activeMatchId,
      groupCall,
      callRequest,
      refreshingChat,
      refreshKey,
      announcementExpanded,
    ],
  );
  useEffect(() => {
    if (!presentation) return;
    emitAppEvent("chat:presentation", presentation);
    return onAppEvent("chat:presentation-request", ({ chatId }) => {
      if (chatId === presentation.chatId) emitAppEvent("chat:presentation", presentation);
    });
  }, [presentation]);
  useEffect(
    () =>
      onAppEvent("chat:ui-command", (command) => {
        if (command.chatId !== activeChatId || useStore.getState().accountId !== accountId) return;
        if (dispatchSearchCommand(searchController, command.action, command.value)) return;
        switch (command.action) {
          case "announcement-toggle":
            if (activeChatId)
              setAnnouncementExpandedByChat((current) => ({
                ...current,
                [activeChatId]: !(current[activeChatId] ?? false),
              }));
            break;
          case "refresh":
            void refreshCurrentChat();
            break;
          case "join-call":
            joinGroupCall();
            break;
          case "menu":
            setPanel({ x: command.x ?? 16, y: command.y ?? 16 });
            break;
        }
      }),
    [activeChatId, accountId, searchController, refreshCurrentChat, joinGroupCall],
  );

  const rows = useMemo<VirtualRow<MsgRow>[]>(() => {
    const out: VirtualRow<MsgRow>[] = [];
    let lastDay = "";
    const searching = search.open && search.hits.length > 0;
    const q = search.query;
    for (let i = 0; i < displayMessages.length; i++) {
      const m = displayMessages[i]!;
      if (m.id === unreadStart) out.push({ key: `unread-${m.id}`, item: { key: `unread-${m.id}`, kind: "unread", label: "ここから未読メッセージ" } });
      const dl = dayLabel(m.createdAt);
      if (dl !== lastDay) {
        lastDay = dl;
        out.push({ key: `day-${m.id}`, item: { key: `day-${m.id}`, kind: "day", label: dl } });
      }
      const prev = displayMessages[i - 1];
      const mediaGroup = m.mediaGroup && !m.replyToId ? [m] : undefined;
      if (mediaGroup) {
        while (
          i + 1 < displayMessages.length &&
          displayMessages[i + 1]!.id !== unreadStart &&
          shareImageMediaGroup(mediaGroup[mediaGroup.length - 1]!, displayMessages[i + 1]!)
        ) {
          mediaGroup.push(displayMessages[i + 1]!);
          i++;
        }
        mediaGroup.sort(
          (left, right) =>
            (left.mediaGroup?.sequence ?? Number.MAX_SAFE_INTEGER) -
            (right.mediaGroup?.sequence ?? Number.MAX_SAFE_INTEGER),
        );
      }
      const primaryMessage = mediaGroup?.[0] ?? m;
      const lastInRow = mediaGroup?.[mediaGroup.length - 1] ?? primaryMessage;
      const next = displayMessages[i + 1];
      const sameAuthorAsNext =
        next && next.id !== unreadStart && next.authorId === lastInRow.authorId && dayLabel(next.createdAt) === dl;
      const sameAuthorAsPrev =
        prev && primaryMessage.id !== unreadStart && prev.authorId === primaryMessage.authorId && dayLabel(prev.createdAt) === lastDay;
      const groupIds = mediaGroup?.map((item) => item.id) ?? [primaryMessage.id];
      out.push({
        key: `msg-${primaryMessage.id}`,
        item: {
          key: `msg-${primaryMessage.id}`,
          kind: "msg",
          message: primaryMessage,
          mediaGroup: mediaGroup && mediaGroup.length > 1 ? mediaGroup : undefined,
          index: i,
          sameAuthorAsPrev: Boolean(sameAuthorAsPrev),
          sameAuthorAsNext: Boolean(sameAuthorAsNext),
          isMatch: groupIds.some((id) => matches.includes(id)),
          isActive: groupIds.includes(activeMatchId ?? ""),
          flash: groupIds.includes(highlightMessageId ?? ""),
          searching,
          highlight: searching ? (search.regex ? search.hits.find((hit) => groupIds.includes(hit.id))?.highlight : q) : undefined,
        },
      });
    }
    return out;
  }, [displayMessages, matches, search.open, search.query, search.regex, search.hits, activeMatchId, highlightMessageId, unreadStart]);

  const estimateMsgHeight = useCallback((row: MsgRow): number => {
    if (row.kind === "unread") return 56;
    if (row.kind === "day") return 40;
    if (row.mediaGroup && row.mediaGroup.length > 1) {
      return row.mediaGroup.length <= 2 ? 210 : 300;
    }
    const m = row.message!;
    if (m.kind === "sticker") return 160;
    if (m.kind === "image" || m.kind === "video") return 320;
    if (m.kind === "flex" || m.kind === "rich") return 300;
    if (m.kind === "emoji") return 90;
    if (m.kind === "call") return 60;
    return 60 + (m.text?.length ?? 0) * 0.35;
  }, []);
  const {
    containerRef,
    onScroll,
    visibleRows,
    hasMeasured,
    topSpacer,
    bottomSpacer,
    rowRef,
    scrollToMessagePosition,
    scrollToBottom,
    releaseAutoPosition,
  } = useVirtualList<MsgRow>({
    rows,
    estimateHeight: estimateMsgHeight,
    resetKey: activeChatId ?? null,
  });
  const messageListRef = useRef<HTMLDivElement>(null);
  const latestSyncRef = useRef<{ chatId: string; task: Promise<void> } | null>(null);
  const scrollToLatest = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      searchController.latest();
      scrollToBottom(behavior);
      if (!activeChatId || demoMode || latestSyncRef.current?.chatId === activeChatId) return;
      const syncingChatId = activeChatId;
      let task!: Promise<void>;
      task = refreshMessages(syncingChatId, { force: true })
        .catch(() => undefined)
        .finally(() => {
          if (latestSyncRef.current?.task === task) latestSyncRef.current = null;
        });
      latestSyncRef.current = { chatId: syncingChatId, task };
    },
    [activeChatId, demoMode, refreshMessages, scrollToBottom, searchController],
  );

  const syncedChatRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeChatId) {
      syncedChatRef.current = null;
      return;
    }
    const firstVisibleSync = syncedChatRef.current !== activeChatId;
    if (!firstVisibleSync && !isFocusedPane) return;
    syncedChatRef.current = activeChatId;
    if (demoMode) return;

    let cancelled = false;
    const syncingChatId = activeChatId;
    void (async () => {
      // 再入室時はまずSQLite/ローカルキャッシュを即表示する。
      // foreground の強制同期が一時的にタイムアウトしても空画面を確定させない。
      await refreshMessages(syncingChatId).catch(() => undefined);
      if (cancelled) return;

      await refreshMessages(syncingChatId, { force: true }).catch(() => undefined);
      if (cancelled) return;

      // 非フォーカスペインは表示だけ同期し、既読通知は現在操作中のペインだけ送る。
      if (useStore.getState().activeChatId !== syncingChatId) return;
      await markChatRead(syncingChatId).catch(() => undefined);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeChatId, demoMode, isFocusedPane, markChatRead, refreshMessages]);

  const syncBottomButton = useCallback(
    (element: HTMLDivElement | null = containerRef.current) => {
      if (!element) {
        setShowScrollToBottom(false);
        return;
      }
      setShowScrollToBottom(
        !isNearScrollBottom({
          scrollTop: element.scrollTop,
          scrollHeight: element.scrollHeight,
          clientHeight: element.clientHeight,
        }),
      );
    },
    [containerRef],
  );

  const toggleAnnouncementExpanded = useCallback(() => {
    if (!activeChatId) return;
    setAnnouncementExpandedByChat((current) => ({
      ...current,
      [activeChatId]: !(current[activeChatId] ?? false),
    }));
  }, [activeChatId]);

  const olderBoundaryArmedRef = useRef(true);
  const lastUserScrollIntentAtRef = useRef(0);
  const requestOlderMessages = useCallback(() => {
    if (search.window) {
      if (search.window.hasOlder) void searchController.pageContext("before");
      return;
    }
    if (!activeChatId || olderState.loading || !olderState.hasMore) return;
    releaseAutoPosition();
    emitAppEvent("history:load-older", { chatMid: activeChatId });
  }, [activeChatId, olderState, releaseAutoPosition, search.window, searchController]);

  const handleMessageScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      onScroll(event);
      syncBottomButton(event.currentTarget);
      const top = event.currentTarget.scrollTop;
      if (top > 240) {
        olderBoundaryArmedRef.current = true;
        return;
      }
      const userDriven = performance.now() - lastUserScrollIntentAtRef.current < 1_500;
      if (
        top <= 80 &&
        userDriven &&
        olderBoundaryArmedRef.current &&
        olderState.hasMore &&
        !olderState.loading
      ) {
        // wheel / touch / scrollbar 操作で実際に上端へ到達した時だけ1ページ。
        // 初期レイアウトやプログラムによる scrollTop 変更では取得しない。
        olderBoundaryArmedRef.current = false;
        requestOlderMessages();
      }
    },
    [olderState.hasMore, olderState.loading, onScroll, requestOlderMessages, syncBottomButton],
  );

  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => syncBottomButton());
    return () => cancelAnimationFrame(frame);
  }, [activeChatId, bottomSpacer, displayMessages.length, hasMeasured, syncBottomButton, topSpacer]);

  useEffect(() => {
    const viewport = containerRef.current;
    const content = messageListRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => syncBottomButton(viewport));
    observer.observe(viewport);
    if (content) observer.observe(content);
    return () => observer.disconnect();
  }, [activeChatId, containerRef, syncBottomButton]);

  useEffect(() => {
    olderBoundaryArmedRef.current = true;
    // 前のトークの検索語を持ち越すと、新しいトークの非一致メッセージが薄く表示される。
    setOlderState({ hasMore: true, loading: false });
    return onAppEvent("history:state", (detail) => {
      if (detail.chatMid !== activeChatId) return;
      const next = { hasMore: detail.hasMore, loading: detail.loading };
      setOlderState(next);
    });
  }, [activeChatId]);

  const openedChatRef = useRef<string | null>(null);

  // 開いた瞬間は常に最新メッセージへ置く。仮想行や画像の高さが後から確定しても、
  // useVirtualList の bottom 追従が実際の最下端まで補正する。
  useEffect(() => {
    if (!activeChatId) {
      openedChatRef.current = null;
      return;
    }
    if (!rows.length || openedChatRef.current === activeChatId) return;
    if (!hasMeasured) return;
    const frame = requestAnimationFrame(() => {
      openedChatRef.current = activeChatId;
      scrollToBottom("auto");
    });
    return () => cancelAnimationFrame(frame);
  }, [activeChatId, hasMeasured, rows, scrollToBottom]);

  // 返信ジャンプ（store.scrollToMessage → highlightMessageId）
  useEffect(() => {
    if (!highlightMessageId) return;
    const frame = requestAnimationFrame(() =>
      scrollToMessagePosition(highlightMessageId, { center: true }),
    );
    return () => cancelAnimationFrame(frame);
  }, [highlightMessageId, scrollToMessagePosition]);

  // 既読者一覧を開いた行が、最下部追従で画面外へ飛ばされないようにする。
  useEffect(() => {
    if (!openReadersMessageId) return;
    releaseAutoPosition();
  }, [openReadersMessageId, releaseAutoPosition]);

  // 検索ヒットへジャンプ
  const searchScrollId = rows.find(({ item }) => item.kind === "msg" &&
    (item.message.id === search.scrollId || item.mediaGroup?.some((message) => message.id === search.scrollId)))?.key.replace(/^msg-/, "");
  useEffect(() => {
    if (!searchScrollId) return;
    const frame = requestAnimationFrame(() => scrollToMessagePosition(searchScrollId, { center: true }));
    return () => cancelAnimationFrame(frame);
  }, [searchScrollId, search.window, scrollToMessagePosition]);

  if (!chat) {
    return (
      <div
        className="hidden h-full min-h-0 w-full flex-1 items-center justify-center bg-[var(--vy-chat-bg)] md:flex"
        data-pattern="0"
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--vy-surface-2)] text-3xl opacity-60">
            💬
          </span>
          <div>
            <p className="text-sm font-medium text-[var(--vy-text-dim)]">
              チャットを選択してください
            </p>
            <p className="mt-1 text-xs text-[var(--vy-text-dim)] opacity-60">
              左のリストからトークを開くか、新しい会話を始めましょう
            </p>
          </div>
        </div>
      </div>
    );
  }

  const name = maskPrivacyText(displayName(chat, privacy.names), privacySettings);

  const todayText = chatMessages
    .filter(
      (m) => new Date(m.createdAt).toDateString() === new Date().toDateString() && m.text?.trim(),
    )
    .slice(-120)
    .map((m) => `${m.authorId === "me" ? "自分" : name}: ${m.text!.trim().slice(0, 800)}`)
    .join("\n");

  const panelItems: MenuItem[] = [
    {
      label: "メッセージを検索",
      icon: <IconSearch size={16} />,
      onClick: searchController.open,
    },
    ...(agentEnabled
      ? [
          {
            label: "今日の会話をAIで要約",
            icon: <IconMemo size={16} />,
            onClick: () =>
              setAgentPrompt(
                todayText
                  ? `次の今日の会話を日本語で5行以内に要約してください。重要な話題、決定、TODOを含めてください。\n\n${todayText}`
                  : "今日の会話に要約できるテキストメッセージはありません。",
              ),
          },
        ]
      : []),
    {
      label: "一番下へスクロール",
      icon: <IconArrowDown size={16} />,
      onClick: () => {
        scrollToLatest("smooth");
        emitAppEvent("chat:scroll-latest", { chatId: chat.id });
      },
    },
    {
      label: chat.muted ? "ミュートを解除" : "通知をミュート",
      icon: chat.muted ? <IconBell size={16} /> : <IconBellOff size={16} />,
      onClick: () => toggleMute(chat.id),
    },
    {
      label: "VyTheme を開く",
      icon: <IconPalette size={16} />,
      onClick: () => setScreen("settings"),
    },
    {
      label: "プロフィールを表示",
      icon: <IconMore size={16} />,
      onClick: () => updateProfileDrawer(true),
    },
  ];

  return (
    <div className="flex h-full min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* header */}
        <header
          className={cn(
            "vy-chat-header relative flex items-center gap-2 border-b border-[var(--vy-border)] bg-[var(--vy-surface)] px-3 py-2.5 md:gap-3 md:pr-4",
            reserveSidebarToggle ? "md:pl-12" : "md:pl-4",
          )}
        >
          <button
            type="button"
            onClick={closeCurrentChat}
            aria-label="このトークを閉じて一覧に戻る"
            className="vy-mobile-back vy-touch-target flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--vy-text-dim)] transition-colors hover:bg-[var(--vy-surface-2)] hover:text-[var(--vy-text)] focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)] focus-visible:outline-none"
          >
            <IconArrowLeft size={20} />
          </button>
          <button
            type="button"
            onClick={() => updateProfileDrawer(true)}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-lg py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)]"
          >
            <Avatar
              glyph={privacy.avatars ? "•" : chat.avatar}
              color={chat.color}
              size={40}
              online={chat.online}
              imageUrl={privacy.avatars ? undefined : chat.avatarUrl}
              icon={!privacy.avatars && chat.isSelf ? <IconMemo size={22} /> : undefined}
            />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5">
                <span className="vy-chat-header-title truncate text-sm font-semibold">{name}</span>
                {chat.isOfficial && <OfficialBadge />}
                {chat.muted && (
                  <IconBellOff size={13} className="shrink-0 text-[var(--vy-text-dim)]" />
                )}
              </span>
              <span
                className="block truncate text-xs"
                style={{ color: chat.online ? "#3fd07d" : "var(--vy-text-dim)" }}
              >
                {maskPrivacyText(chat.status, privacySettings)}
              </span>
            </span>
          </button>
          {desktopInteraction && paneCount > 1 && onPaneDragStart && (
            <div
              data-vy-pane-drag-handle
              draggable
              onDragStart={onPaneDragStart}
              onPointerDown={(event) => event.stopPropagation()}
              title="ドラッグしてトーク画面を移動"
              aria-label="トーク画面をドラッグして再配置"
              className="vy-desktop-manipulator absolute left-1/2 top-1/2 z-20 hidden h-7 w-14 -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center rounded-full border border-[var(--vy-border)] bg-[var(--vy-surface-2)]/95 shadow-sm active:cursor-grabbing md:flex"
            >
              <span className="grid grid-cols-3 gap-1" aria-hidden>
                {Array.from({ length: 6 }, (_, index) => (
                  <span key={index} className="h-1 w-1 rounded-full bg-[var(--vy-text-dim)]" />
                ))}
              </span>
            </div>
          )}
          <HeaderButton
            label="このトークを再取得"
            disabled={!accountId || demoMode || refreshingChat === refreshKey}
            busy={refreshingChat === refreshKey}
            onClick={() => void refreshCurrentChat()}
          >
            <IconRefresh
              size={19}
              className={refreshingChat === refreshKey ? "motion-safe:animate-spin" : undefined}
            />
          </HeaderButton>
          <HeaderButton
            label="検索"
            active={search.open}
            onClick={search.open ? searchController.close : searchController.open}
          >
            <IconSearch size={19} />
          </HeaderButton>
          <HeaderButton label="メニュー" onClick={() => updateProfileDrawer(!profileOpen)}>
            <IconMore size={19} />
          </HeaderButton>
        </header>

        {groupCall && (
          <GroupCallBanner
            memberCount={groupCall.memberCount}
            video={groupCall.kind === "video"}
            onJoin={joinGroupCall}
            joining={Boolean(callRequest)}
          />
        )}

        {/* in-chat search bar */}
        {search.open && (
          <div className="vy-fade-in flex items-center gap-2 border-b border-[var(--vy-border)] bg-[var(--vy-surface)] px-3 py-2 md:px-4">
            <div className="flex flex-1 items-center gap-2 rounded-xl bg-[var(--vy-surface-2)] px-3 py-2">
              <IconSearch size={16} className="text-[var(--vy-text-dim)]" />
              <input
                value={search.query}
                onChange={(e) => searchController.setQuery(e.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") searchController.close();
                  if (event.key === "Enter") void (event.shiftKey ? searchController.previous() : searchController.next());
                }}
                maxLength={512}
                placeholder={search.regex ? "正規表現で検索" : "このトーク内を検索"}
                aria-label="トーク内を検索"
                className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--vy-text-dim)]"
              />
              <span className="shrink-0 text-xs tabular-nums text-[var(--vy-text-dim)]">
                {search.query.trim()
                  ? `${matches.length ? (search.index % matches.length) + 1 : 0}/${matches.length}${search.nextCursor ? "+" : ""}`
                  : ""}
              </span>
            </div>
            <button type="button" aria-label="正規表現検索を切り替え" aria-pressed={search.regex}
              onClick={() => searchController.setRegex(!search.regex)}
              className={cn("vy-touch-target h-9 rounded-lg border px-2 font-mono text-xs", search.regex
                ? "border-[var(--vy-accent)] text-[var(--vy-accent)]" : "border-[var(--vy-border)] text-[var(--vy-text-dim)]")}>
              .*
            </button>
            <button
              type="button"
              disabled={!matches.length || search.loading}
              onClick={() => void searchController.previous()}
              aria-label="前の一致"
              className="vy-touch-target flex h-9 w-9 items-center justify-center rounded-lg text-[var(--vy-text-dim)] transition-colors hover:bg-[var(--vy-surface-2)] hover:text-[var(--vy-text)] disabled:opacity-30"
            >
              <IconChevron size={16} className="-rotate-90" />
            </button>
            <button
              type="button"
              disabled={!matches.length || search.loading}
              onClick={() => void searchController.next()}
              aria-label="次の一致"
              className="vy-touch-target flex h-9 w-9 items-center justify-center rounded-lg text-[var(--vy-text-dim)] transition-colors hover:bg-[var(--vy-surface-2)] hover:text-[var(--vy-text)] disabled:opacity-30"
            >
              <IconChevron size={16} className="rotate-90" />
            </button>
            <button
              type="button"
              onClick={searchController.close}
              aria-label="検索を閉じる"
              className="vy-touch-target flex h-9 w-9 items-center justify-center rounded-lg text-[var(--vy-text-dim)] transition-colors hover:bg-[var(--vy-surface-2)] hover:text-[var(--vy-text)]"
            >
              <IconClose size={16} />
            </button>
          </div>
        )}

        {search.open && (
          <div className="border-b border-[var(--vy-border)] bg-[var(--vy-surface)] px-3 py-2 text-xs text-[var(--vy-text-dim)]">
            <div role="status" aria-live="polite" className="flex flex-wrap items-center gap-2">
              <span>{demoMode ? "表示中のトークを検索" : "このアカウントの端末に保存済みのトーク本文を検索（100件ずつ）"}</span>
              {(search.loading || search.contextLoading) && <span>読み込み中…</span>}
              {(search.loading || search.contextLoading) && <button type="button" onClick={searchController.cancel}>中断</button>}
              {search.nextCursor && <button type="button" disabled={search.loading} onClick={() => void searchController.more()}>さらに100件を検索</button>}
              {search.error && <><span role="alert">{search.error}</span><button type="button" onClick={searchController.retry}>再試行</button></>}
              {!!search.query.trim() && !search.loading && !search.error && !matches.length && <span>一致するメッセージはありません</span>}
            </div>
            {!!matches.length && <ol aria-label="検索結果" className="mt-2 max-h-32 overflow-y-auto">
              {search.hits.map((hit, index) => <li key={hit.id}>
                <button type="button" aria-current={index === search.index ? "true" : undefined}
                  onClick={() => void searchController.select(index)}
                  className={cn("block w-full truncate rounded px-2 py-1 text-left hover:bg-[var(--vy-surface-2)]", index === search.index && "text-[var(--vy-accent)]")}>
                  {new Date(hit.createdTime).toLocaleString()} · {hit.text.slice(0, 160)}
                </button>
              </li>)}
            </ol>}
          </div>
        )}
        {search.window && <div className="flex flex-wrap items-center justify-center gap-3 border-b border-[var(--vy-border)] px-3 py-2 text-xs text-[var(--vy-text-dim)]">
          <span>検索した履歴を表示中</span>
          <button type="button" disabled={search.contextLoading || !search.window.hasOlder} onClick={() => void searchController.pageContext("before")}>前を読む</button>
          <button type="button" disabled={search.contextLoading || !search.window.hasNewer} onClick={() => void searchController.pageContext("after")}>後を読む</button>
          <button type="button" onClick={() => scrollToLatest("auto")}>最新へ戻る</button>
        </div>}

        {/* pinned announcement banner */}
        {(() => {
          const list = activeChatId ? (announcements[activeChatId] ?? []) : [];
          if (!list.length) return null;
          const panelId = `vy-announcements-${encodeURIComponent(activeChatId ?? "chat")}`;
          const jumpToAnnouncement = (link: string) => {
            const messageId = announcementMessageId(link);
            if (messageId) scrollToMessage(messageId);
          };
          const removePinnedAnnouncement = (announcementSeq: string) => {
            if (activeChatId) void removeChatAnnouncement(activeChatId, announcementSeq);
          };
          const first = list[0]!;
          return (
            <div className="relative z-30 px-3 py-2">
              <div className="mx-auto w-full max-w-2xl overflow-hidden rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface)] text-xs text-[var(--vy-text)] shadow-sm">
                <div className="flex min-h-10 items-center gap-2 px-3 py-1.5">
                  <IconPin size={14} className="shrink-0 text-[var(--vy-accent)]" />
                  <span className="font-semibold">アナウンス</span>
                  <span className="text-[var(--vy-text-dim)]">({list.length}件)</span>
                  {!announcementExpanded && (
                    <button
                      type="button"
                      onClick={() => jumpToAnnouncement(first.link)}
                      className="ml-1 min-w-0 flex-1 truncate text-left text-[var(--vy-text-dim)] transition-colors hover:text-[var(--vy-text)]"
                      title={maskPrivacyText(first.text, privacySettings)}
                    >
                      {maskPrivacyText(first.text, privacySettings)}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={toggleAnnouncementExpanded}
                    aria-expanded={announcementExpanded}
                    aria-controls={panelId}
                    aria-label={announcementExpanded ? "アナウンスをたたむ" : "アナウンスを広げる"}
                    className="vy-touch-target ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-base font-semibold text-[var(--vy-text-dim)] transition-colors hover:bg-[var(--vy-surface-2)] hover:text-[var(--vy-text)]"
                  >
                    <span aria-hidden>{announcementExpanded ? "∧" : "∨"}</span>
                  </button>
                </div>
                {announcementExpanded && (
                  <div
                    id={panelId}
                    className="vy-scroll max-h-[min(18rem,38vh)] overflow-y-auto border-t border-[var(--vy-border)] p-1"
                  >
                    {list.map((announcement) => (
                      <div
                        key={announcement.announcementSeq}
                        className="flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-[var(--vy-surface-2)]"
                      >
                        <button
                          type="button"
                          onClick={() => jumpToAnnouncement(announcement.link)}
                          className="min-w-0 flex-1 truncate text-left underline-offset-2 hover:underline"
                          title={maskPrivacyText(announcement.text, privacySettings)}
                        >
                          {maskPrivacyText(announcement.text, privacySettings)}
                        </button>
                        <button
                          type="button"
                          onClick={() => removePinnedAnnouncement(announcement.announcementSeq)}
                          className="shrink-0 rounded-lg p-1 transition-colors hover:bg-[var(--vy-bg)]"
                          aria-label={`「${maskPrivacyText(announcement.text, privacySettings)}」のアナウンスを解除`}
                        >
                          <IconClose size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* messages */}
        <div className="relative min-h-0 flex-1">
          <div
            ref={containerRef}
            style={{ overflowAnchor: "none" }}
            onScroll={handleMessageScroll}
            onWheel={() => {
              lastUserScrollIntentAtRef.current = performance.now();
            }}
            onTouchStart={() => {
              lastUserScrollIntentAtRef.current = performance.now();
            }}
            onPointerDown={() => {
              lastUserScrollIntentAtRef.current = performance.now();
            }}
            onContextMenu={(e) => {
              // Mobile long-press is reserved for message actions. Do not let the
              // generic chat menu race the message gesture/native context event.
              if (!isDesktopInteraction()) return;
              const target = e.target as HTMLElement;
              if (
                target.closest("[data-vy-message='true']") ||
                target.closest("button, input, textarea, a, [data-message-actionable='true']")
              ) {
                return;
              }
              e.preventDefault();
              setPanel({ x: e.clientX, y: e.clientY });
            }}
            className="vy-scroll vy-chat-surface vy-chat-messages h-full w-full overflow-y-auto px-3 py-4 md:px-6"
            data-pattern={theme.pattern}
            data-image={theme.chatImage ? "" : undefined}
          >
            <div ref={messageListRef} className="mx-auto flex w-full max-w-3xl flex-col">
              <div className="mb-4 flex justify-center">
                {search.window ? (
                  <button type="button" disabled={search.contextLoading || !search.window.hasOlder}
                    onClick={() => void searchController.pageContext("before")}
                    className="rounded-xl bg-[var(--vy-surface-2)] px-4 py-2 text-xs text-[var(--vy-text-dim)] disabled:opacity-50">
                    {search.contextLoading ? "過去のメッセージを読み込み中…" : search.window.hasOlder ? "↑ 保存済みの前の履歴を読む" : "▲ 保存済み履歴の先頭です"}
                  </button>
                ) : olderState.hasMore ? (
                  <button
                    type="button"
                    onClick={requestOlderMessages}
                    disabled={olderState.loading}
                    className="rounded-xl bg-[color-mix(in_oklab,var(--vy-text)_10%,transparent)] px-4 py-2 text-center text-xs leading-relaxed text-[var(--vy-text-dim)] transition-colors hover:text-[var(--vy-text)] disabled:cursor-wait disabled:opacity-70"
                  >
                    {olderState.loading
                      ? "過去のメッセージを読み込み中…"
                      : "↑ 過去のメッセージを読み込む"}
                  </button>
                ) : (
                  <span className="rounded-xl bg-[color-mix(in_oklab,var(--vy-text)_10%,transparent)] px-4 py-2 text-center text-xs leading-relaxed text-[var(--vy-text-dim)]">
                    {chat.type === "group"
                      ? "▲ ここがトークの一番上です"
                      : "▲ ここから会話が始まります"}
                  </span>
                )}
              </div>
              {topSpacer > 0 && <div style={{ height: topSpacer }} aria-hidden />}
              {visibleRows.map(({ key, item }) =>
                item.kind === "unread" ? (
                  <div key={key} ref={rowRef(key)} data-vy-unread-boundary role="separator" aria-label={item.label}
                    className="py-2">
                    <div className="flex min-h-9 items-center gap-3 rounded-full bg-[color-mix(in_oklab,var(--vy-text)_8%,var(--vy-bg))] px-3 py-2 text-xs font-medium text-[var(--vy-text)]">
                    <IconTag size={16} />
                    <span className="flex-1 text-center">{item.label}</span>
                    <span className="w-4" aria-hidden />
                    </div>
                  </div>
                ) : item.kind === "day" ? (
                  <div key={key} ref={rowRef(key)} className="my-3 flex justify-center">
                    <span className="rounded-full bg-[color-mix(in_oklab,var(--vy-text)_12%,transparent)] px-3 py-1 text-[0.7rem] font-medium text-[var(--vy-text)] backdrop-blur">
                      {item.label}
                    </span>
                  </div>
                ) : (
                  <div
                    key={key}
                    id={key}
                    ref={rowRef(key)}
                    className={cnRow(
                      item.searching,
                      item.isMatch,
                      item.isActive,
                      item.sameAuthorAsPrev,
                      item.flash,
                    )}
                  >
                    <MessageBubble
                      message={item.message}
                      mediaGroup={item.mediaGroup}
                      chat={chat}
                      showAvatar={!item.sameAuthorAsNext}
                      showName={!item.sameAuthorAsPrev}
                      highlight={item.searching ? (item.highlight as string) : undefined}
                      onJoinGroupCall={
                        groupCall && item.message.callMeta?.group ? joinGroupCall : undefined
                      }
                      joiningGroupCall={Boolean(callRequest)}
                    />
                  </div>
                ),
              )}
              {bottomSpacer > 0 && <div style={{ height: bottomSpacer }} aria-hidden />}
            </div>
          </div>
          {showScrollToBottom && (
            <button
              type="button"
              onClick={() => scrollToLatest("smooth")}
              aria-label="トークの一番下へ移動"
              title="トークの一番下へ"
              className="absolute bottom-4 right-4 z-20 flex h-11 w-11 items-center justify-center rounded-full border border-[var(--vy-border)] bg-[var(--vy-accent)] text-[var(--vy-accent-contrast)] shadow-lg transition-[transform,opacity,background-color] hover:scale-105 active:scale-95 md:right-5"
            >
              <IconArrowDown size={22} />
            </button>
          )}
        </div>

        {/* input */}
        <MessageInput chatId={chat.id} />
      </div>

      {profileOpen && !isComposeMode(mode) && <ProfileDrawer chat={chat} />}
      {isFocusedPane &&
        memberProfile &&
        memberProfile.chatId === chat.id &&
        !isComposeMode(mode) && <MemberProfilePopover chat={chat} />}
      {panel && (
        <MessageContextMenu
          x={panel.x}
          y={panel.y}
          items={panelItems}
          onClose={() => setPanel(null)}
        />
      )}
      {agentPrompt && (
        <AgentIActionDialog
          title="今日の会話の要約"
          prompt={agentPrompt}
          onClose={() => setAgentPrompt(null)}
        />
      )}
    </div>
  );
}

export const ChatArea = memo(ChatAreaBase);

function cnRow(
  searching: boolean,
  isMatch: boolean,
  isActive: boolean,
  sameAuthorAsPrev: boolean,
  flashHighlight: boolean,
) {
  const base = sameAuthorAsPrev ? "mt-0.5 vy-msg-stack-gap-tight" : "mt-3 vy-msg-stack-gap";
  if (flashHighlight) {
    return `${base} rounded-xl ring-2 ring-[var(--vy-accent)] vy-fade-in transition-all`;
  }
  if (!searching) return base;
  if (isActive) return `${base} rounded-xl ring-2 ring-[var(--vy-accent)] transition-all`;
  if (isMatch) return base;
  return `${base} opacity-40 transition-opacity`;
}

function HeaderButton({
  children,
  label,
  onClick,
  active,
  disabled,
  busy,
}: {
  children: React.ReactNode;
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      disabled={disabled}
      aria-busy={busy}
      aria-pressed={active}
      className={cn(
        "vy-touch-target flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)] focus-visible:outline-none disabled:opacity-50",
        active
          ? "bg-[color-mix(in_oklab,var(--vy-accent)_18%,transparent)] text-[var(--vy-accent)]"
          : "text-[var(--vy-text-dim)] hover:bg-[var(--vy-surface-2)] hover:text-[var(--vy-text)]",
      )}
    >
      {children}
    </button>
  );
}
