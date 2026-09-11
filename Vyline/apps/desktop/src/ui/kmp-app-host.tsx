import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useStore, displayName, formatTime, CHAT_SORT_LABELS } from "@/lib/store";
import { buildPreviewMap, filterChatList, type ChatListTab } from "@/lib/chatListPresentation";
import { lineAvatarUrl } from "@/utils/lineMedia";
import { useDesignTheme } from "./design-theme";
import { DESIGN_SYSTEMS, useDesignSystemStore } from "./design-system-store";
import {
  COMPOSE_CHANNEL,
  COMPOSE_VERSION,
  matchesKmpContext,
  isKmpChatInteraction,
  readComposeAction,
  type KmpAppSnapshot,
  type KmpAppPatch,
  type KmpPaneSnapshot,
} from "./compose-contract";
import { messageDelta, panePatches } from "./kmp-model";
import { getComposerController } from "./composer-controller";
import { reactToMessage } from "@/lib/messageActions";
import { emitAppEvent } from "@/lib/appEvents";
import { isDesktopInteraction } from "@/lib/interactionEnvironment";
import type { CompatibilityRequest } from "./kmp-compatibility";
import { setContactBlocked, removeChatAnnouncement } from "@/lib/chatActions";
import { KmpHostedMessages } from "./kmp-hosted-messages";
import { KmpPaneBridge } from "./kmp-pane-bridge";
import { invokeNativePanel, useNativePanelSnapshot, type NativePanelSnapshot } from "./native-panel";
import { closeControllerDialog, requestControllerConfirm, useControllerDialogSnapshot } from "./controller-dialog";
import { createKmpCallGate } from "./kmp-call-gate";
import { useControllerCallSnapshot } from "./controller-call";
import {
  type ChatPaneLayoutMode,
  resizeAdjacentChatPanes,
  placeChatPane,
  equalChatPaneSizes,
  chatPaneDropPlan,
} from "@/lib/chatPanes";
import {
  dismissNativeMenu,
  invokeNativeMenu,
  setNativeMenuAvailable,
  useNativeMenuSnapshot,
} from "./native-menu";

const KmpCompatibility = lazy(() =>
  import("./kmp-compatibility").then((module) => ({ default: module.KmpCompatibility })),
);

const TABS = [
  { id: "all", label: "全体" },
  { id: "friend", label: "友だち" },
  { id: "group", label: "グループ" },
  { id: "official", label: "公式" },
  { id: "hidden", label: "非表示" },
];
const CHAT_COMMANDS = {
  "chat-search": "search",
  "chat-search-query": "search-query",
  "chat-search-next": "search-next",
  "chat-search-previous": "search-previous",
  "chat-search-close": "search-close",
  "chat-refresh": "refresh",
  "join-call": "join-call",
  "chat-menu": "menu",
  "announcement-toggle": "announcement-toggle",
} as const;

const EMPTY_PANE: KmpPaneSnapshot = {
  id: "",
  chat: null,
  messages: [],
  composer: {
    text: "",
    pending: [],
    recording: false,
    recordingSeconds: 0,
    sending: false,
    enterToSend: true,
    voiceEnabled: true,
    mute: false,
  },
};

/** One real Compose application. The host is the sole owner of product state/actions. */
export function KmpAppHost({
  paneIds,
  paneRects,
  paneLayout,
  onPaneLayout,
  onPaneRatio,
}: {
  paneIds: string[];
  paneRects: NonNullable<KmpAppSnapshot["paneRects"]>;
  paneLayout: ChatPaneLayoutMode;
  onPaneLayout: (layout: ChatPaneLayoutMode) => void;
  onPaneRatio: (axis: "main" | "cross", value: number) => void;
}) {
  const { mode, dark } = useDesignTheme();
  const appearance = useDesignSystemStore((state) => state.appearance);
  const chats = useStore((state) => state.chats);
  const messages = useStore((state) => state.messages);
  const activeChatId = useStore((state) => state.activeChatId);
  const self = useStore((state) => state.self);
  const settings = useStore((state) => state.settings);
  const customOrder = useStore((state) => state.customOrder);
  const sidebarWidth = useStore((state) => state.sidebarWidth);
  const sidebarCollapsed = useStore((state) => state.sidebarCollapsed);
  const lockedChatMids = useStore((state) => state.lockedChatMids);
  const profileOpen = useStore((state) => state.profileDrawerOpen);
  const memberProfile = useStore((state) => state.memberProfile);
  const screen = useStore((state) => state.screen);
  const accountId = useStore((state) => state.accountId);
  const binding = useRef({ accountId, epoch: 1 });
  if (binding.current.accountId !== accountId)
    binding.current = { accountId, epoch: binding.current.epoch + 1 };
  const epoch = binding.current.epoch;
  const notice = useStore((state) => state.notice);
  const indexing = useStore((state) => state.indexing);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<ChatListTab>("all");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [splitPick, setSplitPick] = useState(false);
  const [supportsPanes, setSupportsPanes] = useState(false);
  const [paneViews, setPaneViews] = useState<Record<string, KmpPaneSnapshot>>({});
  const publishPane = useCallback((id: string, value: KmpPaneSnapshot | null) => {
    setPaneViews((current) =>
      value
        ? current[id] === value
          ? current
          : { ...current, [id]: value }
        : Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)),
    );
  }, []);
  const panes = useMemo(
    () => paneIds.map((id) => paneViews[id]).filter((pane): pane is KmpPaneSnapshot => !!pane),
    [paneIds, paneViews],
  );
  const activePane = paneViews[activeChatId ?? ""] ?? EMPTY_PANE;
  const layoutControls = useRef({ onPaneLayout, onPaneRatio });
  layoutControls.current = { onPaneLayout, onPaneRatio };
  const [hostContentHeights, setHostContentHeights] = useState<Record<string, number>>({});
  const [hostContentModels, setHostContentModels] = useState<Record<string, NativePanelSnapshot>>({});
  const reportContentModel = useCallback((id: string, model: NativePanelSnapshot | null, ownerEpoch: number, retiredId?: string) => {
    if (binding.current.epoch !== ownerEpoch) return;
    setHostContentModels((current) => {
      if (model) return current[id] === model ? current : { ...current, [id]: model };
      if (current[id]?.id !== retiredId) return current;
      const next = { ...current }; delete next[id]; return next;
    });
  }, []);
  const reportContentHeight = useCallback((id: string, height: number) => {
    const state = useStore.getState();
    if (
      !state.messages.some(
        (message) =>
          message.id === id &&
          (state.chatPaneIds.includes(message.chatId) || message.chatId === state.activeChatId),
      )
    )
      return;
    setHostContentHeights((current) =>
      current[id] === height ? current : { ...current, [id]: height },
    );
  }, []);
  useEffect(() => setHostContentHeights({}), [epoch, attempt]);
  useEffect(() => setHostContentModels({}), [epoch, attempt]);
  const [compatibility, setCompatibility] = useState<CompatibilityRequest | null>(null);
  useEffect(() => {
    if (memberProfile) setCompatibility({ kind: "member-profile", accountId, chatId: memberProfile.chatId, memberId: memberProfile.memberId });
  }, [memberProfile, accountId]);
  const restoreCompatibilityFocus = useRef(false);
  useEffect(() => {
    if (profileOpen && mode !== "apple" && activeChatId && !compatibility)
      setCompatibility({ kind: "profile", accountId, chatId: activeChatId });
  }, [profileOpen, mode, activeChatId, accountId, compatibility]);
  const closeCompatibility = useCallback(() => {
    restoreCompatibilityFocus.current = true;
    setCompatibility(null);
    useStore.getState().setProfileDrawer(false);
    useStore.getState().closeMemberProfile();
  }, []);
  useLayoutEffect(() => {
    if (!compatibility && restoreCompatibilityFocus.current) {
      restoreCompatibilityFocus.current = false;
      frame.current?.focus({ preventScroll: true });
    }
  }, [compatibility]);
  const [reduceMotion, setReduceMotion] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const frame = useRef<HTMLIFrameElement>(null);
  const nativeMenu = useNativeMenuSnapshot();
  const nativePanel = useNativePanelSnapshot();
  const controllerDialog = useControllerDialogSnapshot();
  const controllerCall = useControllerCallSnapshot();
  useEffect(() => () => closeControllerDialog(), [accountId]);
  const hostMenu = useMemo(() => {
    const bounds = frame.current?.getBoundingClientRect();
    return nativeMenu
      ? { ...nativeMenu, x: nativeMenu.x - (bounds?.x ?? 0), y: nativeMenu.y - (bounds?.y ?? 0) }
      : null;
  }, [nativeMenu]);
  const previous = useRef<Partial<KmpAppSnapshot>>({});
  const supportsMessageDelta = useRef(false);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduceMotion(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const rows = useMemo(() => {
    const previews = buildPreviewMap(messages, chats);
    return filterChatList(chats, messages, tab, query, settings.chatSort, customOrder).map(
      (entry) => {
        const preview = previews.get(entry.id);
        return {
          id: entry.id,
          title: displayName(entry, settings.streamerMode),
          preview: settings.streamerMode ? "メッセージ" : (preview?.text ?? "").slice(0, 240),
          time: preview?.time ? formatTime(preview.time) : "",
          unread: entry.unread,
          avatar: settings.streamerMode ? "•" : entry.avatar,
          color: entry.color,
          avatarUrl:
            !settings.streamerMode && entry.avatarUrl ? lineAvatarUrl(entry.avatarUrl) : undefined,
          selected: entry.id === activeChatId,
          pinned: !!entry.pinned,
          muted: !!entry.muted,
          locked: lockedChatMids.includes(entry.id),
        };
      },
    );
  }, [
    messages,
    chats,
    tab,
    query,
    settings.chatSort,
    settings.streamerMode,
    customOrder,
    activeChatId,
    lockedChatMids,
  ]);
  const visibleSettings = useMemo(
    () => ({
      enterToSend: settings.enterToSend,
      voiceMessagesEnabled: settings.voiceMessagesEnabled,
      compactDensity: settings.compactDensity,
      bubbleTail: settings.bubbleTail,
      fontScale: settings.fontScale,
      showReaderList: settings.showReaderList,
    }),
    [settings],
  );
  const profile = useMemo(
    () => ({
      name: self.name,
      status: self.status,
      avatar: self.avatar,
      avatarUrl: self.avatarUrl ? lineAvatarUrl(self.avatarUrl) : undefined,
    }),
    [self.name, self.status, self.avatar, self.avatarUrl],
  );
  const snapshot = useMemo<KmpAppSnapshot>(
    () => ({
      epoch,
      mode: mode as KmpAppSnapshot["mode"],
      dark,
      reducedMotion: reduceMotion || settings.animationMode === "none",
      query,
      tab,
      tabs: TABS,
      rows,
      profile,
      sortLabel: CHAT_SORT_LABELS[settings.chatSort],
      chatSort: settings.chatSort,
      sidebarWidth,
      sidebarCollapsed,
      desktopInteraction: isDesktopInteraction(),
      canRefresh: !!accountId,
      splitPick,
      view: screen === "settings" ? "settings" : "chat",
      appearance,
      chat: activePane.chat,
      messages: supportsPanes && panes.length > 1 ? EMPTY_PANE.messages : activePane.messages,
      composer: activePane.composer,
      history: activePane.history,
      readersPanel: activePane.readersPanel,
      chatUi: activePane.chatUi,
      announcements: activePane.announcements,
      highlightMessageId: activePane.highlightMessageId,
      scrollLatest: activePane.scrollLatest,
      profileOpen: activePane.profileOpen,
      panes: panes.length > 1 ? panes : [],
      paneRects,
      paneLayout,
      settings: visibleSettings,
      hostMenu,
      nativePanel,
      controllerDialog,
      controllerCall,
      hostContentHeights,
      hostContentModels,
      notice: indexing?.active ? indexing.label : (notice ?? ""),
    }),
    [
      epoch,
      mode,
      dark,
      reduceMotion,
      settings.animationMode,
      query,
      tab,
      rows,
      profile,
      settings.chatSort,
      sidebarWidth,
      sidebarCollapsed,
      accountId,
      splitPick,
      supportsPanes,
      screen,
      appearance,
      activePane,
      panes,
      paneRects,
      paneLayout,
      visibleSettings,
      hostMenu,
      nativePanel,
      controllerDialog,
      controllerCall,
      hostContentHeights,
      hostContentModels,
      indexing,
      notice,
    ],
  );
  const latest = useRef(snapshot);
  latest.current = snapshot;
  const callGateRef = useRef<ReturnType<typeof createKmpCallGate> | null>(null);
  // Retire consent during unmount, before passive effect cleanup or promise continuations.
  useLayoutEffect(() => () => callGateRef.current?.dispose(), []);

  useEffect(() => {
    previous.current = {};
    supportsMessageDelta.current = false;
    setSupportsPanes(false);
    setNativeMenuAvailable(false);
    setReady(false);
    setError(false);
    const timer = setTimeout(() => setError(true), 45_000);
    const callGate = createKmpCallGate({
      getState: useStore.getState,
      getEpoch: () => binding.current.epoch,
      subscribe: (listener) => useStore.subscribe(listener),
      confirm: requestControllerConfirm,
      requestCall: (chatId, kind) => useStore.getState().requestCall(chatId, kind),
    });
    callGateRef.current = callGate;
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== location.origin) return;
      let value = event.data;
      if (typeof value === "string") {
        if (value.length > 262_144) return;
        try {
          value = JSON.parse(value);
        } catch {
          return;
        }
      }
      if (
        !value ||
        typeof value !== "object" ||
        value.channel !== COMPOSE_CHANNEL ||
        value.version !== COMPOSE_VERSION
      )
        return;
      if (value.type === "ready") {
        setSupportsPanes(value.panes === true);
        supportsMessageDelta.current = value.messageDelta === true;
        setNativeMenuAvailable(value.hostMenu === true);
        clearTimeout(timer);
        setReady(true);
        setError(false);
        frame.current?.contentWindow?.postMessage(
          JSON.stringify({
            channel: COMPOSE_CHANNEL,
            version: COMPOSE_VERSION,
            type: "snapshot",
            ...latest.current,
          }),
          location.origin,
        );
        previous.current = latest.current;
        return;
      }
      if (value.type === "error") {
        clearTimeout(timer);
        setReady(false);
        setError(true);
        setNativeMenuAvailable(false);
        return;
      }
      const context = useStore.getState();
      const targetChatId =
        typeof value.chatId === "string" && context.chatPaneIds.includes(value.chatId)
          ? value.chatId
          : context.activeChatId;
      if (
        context.accountId !== binding.current.accountId ||
        !matchesKmpContext(value, binding.current.epoch, targetChatId)
      )
        return;
      if (value.type === "files") {
        const current = getComposerController(targetChatId);
        if (
          current?.snapshot.accountId === useStore.getState().accountId &&
          Array.isArray(value.files)
        )
          current.addFiles(
            value.files.filter((file: unknown): file is File => file instanceof File),
          );
        return;
      }
      const action = readComposeAction(value);
      if (!action) return;
      if (
        isKmpChatInteraction(action.action) &&
        targetChatId &&
        targetChatId !== context.activeChatId
      )
        context.focusChatPane(context.chatPaneIds.indexOf(targetChatId));
      const state = useStore.getState();
      const selected = state.chats.find((entry) => entry.id === state.activeChatId);
      const candidate = getComposerController(state.activeChatId);
      const composerController =
        candidate?.snapshot.accountId === state.accountId ? candidate : null;
      const message = action.id
        ? state.messages.find((entry) => entry.id === action.id && entry.chatId === selected?.id)
        : undefined;
      switch (action.action) {
        case "open":
          if (state.chats.some((entry) => entry.id === action.id)) {
            if (latest.current.splitPick) {
              state.openChatInSplit(action.id!);
              setSplitPick(false);
            } else state.openChat(action.id!);
          }
          break;
        case "context":
          if (state.chats.some((entry) => entry.id === action.id)) {
            const bounds = frame.current?.getBoundingClientRect();
            emitAppEvent("chat:context-menu", {
              chatId: action.id!,
              x: (bounds?.x ?? 0) + action.x,
              y: (bounds?.y ?? 0) + action.y,
            });
          }
          break;
        case "split-pick":
          setSplitPick(true);
          state.setScreen("chat");
          state.showNotice("分割表示するトークを選択してください");
          break;
        case "pane-focus": {
          const index = state.chatPaneIds.indexOf(action.id ?? "");
          if (index >= 0) state.focusChatPane(index);
          break;
        }
        case "pane-close": {
          const index = state.chatPaneIds.indexOf(action.id ?? "");
          if (index >= 0) state.closeChatPane(index);
          break;
        }
        case "pane-layout":
          if (["columns", "split-left", "split-right", "grid"].includes(action.value ?? ""))
            layoutControls.current.onPaneLayout(action.value as ChatPaneLayoutMode);
          break;
        case "pane-main-ratio":
        case "pane-cross-ratio": {
          const ratio = Number(action.value);
          if (Number.isFinite(ratio))
            layoutControls.current.onPaneRatio(
              action.action === "pane-main-ratio" ? "main" : "cross",
              Math.max(22, Math.min(78, ratio)),
            );
          break;
        }
        case "pane-resize": {
          const divider = Number(action.id);
          const delta = Number(action.value);
          const count = state.chatPaneIds.length;
          if (
            Number.isInteger(divider) &&
            count > 1 &&
            Number.isFinite(delta) &&
            Math.abs(delta) <= 100
          ) {
            const minimum = Math.max(
              10,
              Math.min(100 / count - 1, (220 / Math.max(1, action.x)) * 100),
            );
            state.setChatPaneSizes(
              resizeAdjacentChatPanes(state.chatPaneSizes, divider, delta, minimum),
            );
          }
          break;
        }
        case "pane-move": {
          const slot = Number(action.value);
          if (
            state.chatPaneIds.includes(action.id ?? "") &&
            Number.isInteger(slot) &&
            slot >= 0 &&
            slot < state.chatPaneIds.length
          ) {
            const ids = placeChatPane(state.chatPaneIds, action.id!, slot);
            useStore.setState({
              chatPaneIds: ids,
              chatPaneSizes: equalChatPaneSizes(ids.length),
              focusedChatPane: ids.indexOf(action.id!),
              activeChatId: action.id!,
            });
          }
          break;
        }
        case "back":
          if (latest.current.splitPick) setSplitPick(false);
          else if (state.screen === "settings") state.setScreen("chat");
          else state.closeChat();
          break;
        case "search":
          setQuery(action.value ?? "");
          break;
        case "sidebar-toggle":
          if (isDesktopInteraction()) state.toggleSidebar();
          break;
        case "sidebar-width": {
          const width = Number(action.value);
          if (isDesktopInteraction() && Number.isFinite(width)) state.setSidebarWidth(width);
          break;
        }
        case "mark-all-read":
          void state.markAllChatsRead();
          break;
        case "reorder-chat":
          if (
            isDesktopInteraction() &&
            state.chats.some((chat) => chat.id === action.id) &&
            state.chats.some((chat) => chat.id === action.value)
          )
            state.reorderChat(action.id!, action.value!);
          break;
        case "drop-chat": {
          if (
            !isDesktopInteraction() ||
            !state.chats.some((chat) => chat.id === action.id) ||
            action.x < 0 ||
            action.x > 1 ||
            action.y < 0 ||
            action.y > 1
          )
            break;
          // Match openChatInSplit's fallback for older stores with a single active chat.
          const currentIds = state.chatPaneIds.length
            ? state.chatPaneIds
            : state.activeChatId
              ? [state.activeChatId]
              : [];
          const existing = currentIds.includes(action.id!);
          if (!existing && currentIds.length >= 4) {
            state.showNotice("同時に開けるトークは最大4画面です");
            break;
          }
          const plan = chatPaneDropPlan(
            Math.min(4, Math.max(1, currentIds.length + (existing ? 0 : 1))),
            action.x,
            action.y,
          );
          if (!existing) state.openChatInSplit(action.id!);
          const ids = placeChatPane(useStore.getState().chatPaneIds, action.id!, plan.slot);
          useStore.setState({
            chatPaneIds: ids,
            chatPaneSizes: equalChatPaneSizes(ids.length),
            focusedChatPane: ids.indexOf(action.id!),
            activeChatId: action.id!,
          });
          layoutControls.current.onPaneLayout(plan.mode);
          break;
        }
        case "tab":
          if (TABS.some((entry) => entry.id === action.id)) setTab(action.id as ChatListTab);
          break;
        case "settings":
          if (useDesignSystemStore.getState().mode === "fluent")
            setCompatibility({ kind: "settings", accountId: state.accountId });
          else state.setScreen("settings");
          break;
        case "host-menu":
          if (action.id) invokeNativeMenu(action.id);
          break;
        case "dismiss-host-menu":
          dismissNativeMenu(action.id);
          break;
        case "advanced-settings":
          setCompatibility({ kind: "settings", accountId: state.accountId });
          break;
        case "panel-action":
        case "panel-change":
        case "panel-selection":
        case "panel-secondary":
        case "panel-close":
        case "panel-confirm":
        case "panel-cancel":
          invokeNativePanel(action.action, action.id, action.value, action.selectionStart, action.selectionEnd,
            action.x + (frame.current?.getBoundingClientRect().x ?? 0), action.y + (frame.current?.getBoundingClientRect().y ?? 0), action.chatId);
          break;
        case "controller-dialog-accept":
          closeControllerDialog(action.id, action.value ?? "");
          break;
        case "controller-dialog-cancel":
          closeControllerDialog(action.id);
          break;
        case "sticker-picker":
          if (selected)
            setCompatibility({ kind: "stickers", accountId: state.accountId, chatId: selected.id });
          break;
        case "message-menu":
          if (message)
            setCompatibility({
              kind: "message-actions",
              requestId: crypto.randomUUID(),
              accountId: state.accountId,
              chatId: message.chatId,
              messageId: message.id,
              menuPoint: {
                x: action.x + (frame.current?.getBoundingClientRect().x ?? 0),
                y: action.y + (frame.current?.getBoundingClientRect().y ?? 0),
              },
            });
          break;
        case "view-rich":
          if (message)
            setCompatibility({
              kind: "message",
              accountId: state.accountId,
              chatId: message.chatId,
              messageId: message.id,
            });
          break;
        case "chat-tools":
          if (selected)
            setCompatibility({
              kind: "chat-tools",
              accountId: state.accountId,
              chatId: selected.id,
            });
          break;
        case "readers":
          if (message && selected?.type === "group" && state.settings.showReaderList)
            state.toggleReadersPanel(selected.id, message.id);
          break;
        case "close-readers":
          state.closeReadersPanel();
          break;
        case "reader-profile":
          if (selected?.members?.some((member) => member.id === action.id))
            state.openMemberProfile(selected.id, action.id!);
          break;
        case "chat-search":
        case "chat-search-query":
        case "chat-search-next":
        case "chat-search-previous":
        case "chat-search-close":
        case "announcement-toggle":
        case "chat-refresh":
        case "join-call":
        case "chat-menu":
          if (selected) {
            const bounds = frame.current?.getBoundingClientRect();
            emitAppEvent("chat:ui-command", {
              chatId: selected.id,
              action: CHAT_COMMANDS[action.action],
              value: action.value,
              x: action.x + (bounds?.x ?? 0),
              y: action.y + (bounds?.y ?? 0),
            });
          }
          break;
        case "jump-message":
          if (message) state.scrollToMessage(message.id);
          break;
        case "announcement-remove":
          if (selected && action.id) void removeChatAnnouncement(selected.id, action.id);
          break;
        case "create-group":
          setCompatibility({ kind: "create-group", accountId: state.accountId });
          break;
        case "profile":
          if (selected && action.id === selected.id) {
            state.setProfileDrawer(true);
            setCompatibility({ kind: "profile", accountId: state.accountId, chatId: selected.id });
          } else
            setCompatibility({
              kind: "settings",
              accountId: state.accountId,
              initialSection: "profile",
            });
          break;
        case "chat-details":
          if (selected) state.setProfileDrawer(true);
          break;
        case "close-details":
          state.setProfileDrawer(false);
          break;
        case "chat-mute":
          if (
            selected &&
            (action.value === undefined || Boolean(selected.muted) !== (action.value === "true"))
          )
            state.toggleMute(selected.id);
          break;
        case "pin-chat":
          if (selected) state.togglePin(selected.id);
          break;
        case "block-chat":
          if (selected)
            void setContactBlocked(selected.id, !state.blockedMids.includes(selected.id)).then(
              (result) => {
                if (!result.ok && result.error) useStore.getState().showNotice(result.error);
              },
            );
          break;
        case "open-member":
          if (selected?.members?.some((member) => member.id === action.id))
            state.openDirectChatWith(action.id!);
          break;
        case "draft":
          composerController?.setText(
            action.value ?? "",
            action.selectionStart,
            action.selectionEnd,
          );
          break;
        case "send":
          composerController?.send();
          break;
        case "attach":
          composerController?.pickFiles();
          break;
        case "remove-attachment":
          if (action.id) composerController?.removeFile(action.id);
          break;
        case "clear-attachments":
          composerController?.clearFiles();
          break;
        case "send-attachments":
          void composerController?.sendMedia();
          break;
        case "record-start":
          composerController?.startRecording();
          break;
        case "record-stop":
          composerController?.stopRecording(true);
          break;
        case "record-cancel":
          composerController?.stopRecording(false);
          break;
        case "mute":
          composerController?.setMuted(action.value === "true");
          break;
        case "mention": {
          const option = composerController?.snapshot.mentionOptions[Number(action.id)];
          if (option) composerController?.insertMention(option);
          break;
        }
        case "reply":
          if (message) state.setReplyTo(message.id);
          break;
        case "cancel-reply":
          state.setReplyTo(null);
          break;
        case "retry":
          if (message) void state.retryMessage(message.id);
          break;
        case "edit":
          if (message?.authorId === "me" && action.value !== undefined)
            void state.editMessage(message.id, action.value);
          break;
        case "revoke":
          if (message?.authorId === "me") void state.revokeMessage(message.id);
          break;
        case "react":
          if (message) {
            const type = Number(action.value);
            void reactToMessage(
              message.id,
              type,
              !!message.reactions?.some(
                (entry) => entry.type === type && entry.fromMid === (state.self.mid ?? ""),
              ),
            ).then((result) => {
              if (!result.ok && result.error) useStore.getState().showNotice(result.error);
            });
            break;
          }
          break;
        case "load-older":
          if (selected && state.accountId)
            emitAppEvent("history:load-older", { chatMid: selected.id });
          break;
        case "call":
          if (selected && state.accountId && (action.value === "voice" || action.value === "video"))
            void callGate.request(selected.id, action.value, displayName(selected, state.settings.streamerMode));
          break;
        case "refresh":
          void state.refreshChatsSilently();
          break;
        case "appearance":
          if (action.value === "system" || action.value === "light" || action.value === "dark")
            useDesignSystemStore.getState().setAppearance(action.value);
          break;
        case "ui-mode": {
          const next = DESIGN_SYSTEMS.find((entry) => entry.id === (action.value ?? action.id));
          if (next) useDesignSystemStore.getState().setMode(next.id);
          break;
        }
        case "setting":
          if (
            [
              "enterToSend",
              "voiceMessagesEnabled",
              "compactDensity",
              "bubbleTail",
              "showReaderList",
            ].includes(action.id ?? "") &&
            (action.value === "true" || action.value === "false")
          )
            state.updateSetting(action.id as "enterToSend", action.value === "true");
          break;
        case "sort":
          if (action.value === "recent" || action.value === "unread" || action.value === "custom")
            state.updateSetting("chatSort", action.value);
          break;
        default:
          break;
      }
    };
    window.addEventListener("message", receive);
    return () => {
      callGate.dispose();
      clearTimeout(timer);
      window.removeEventListener("message", receive);
      setNativeMenuAvailable(false);
    };
  }, [attempt]);

  useEffect(() => {
    if (!ready) return;
    // A keystroke crosses the boundary as a composer patch, not a serialized chat history.
    let patch: KmpAppPatch = Object.fromEntries(
      Object.entries(snapshot).filter(
        ([key, value]) => previous.current[key as keyof KmpAppSnapshot] !== value,
      ),
    );
    if (
      supportsMessageDelta.current &&
      patch.messages &&
      previous.current.messages &&
      previous.current.chat?.id === snapshot.chat?.id &&
      previous.current.epoch === snapshot.epoch
    ) {
      const delta = messageDelta(previous.current.messages, snapshot.messages);
      patch = Object.fromEntries(Object.entries(patch).filter(([key]) => key !== "messages"));
      if (delta.updates.length || delta.ids) patch.messageDelta = delta;
    }
    if (
      supportsPanes &&
      patch.panes &&
      previous.current.panes &&
      previous.current.epoch === snapshot.epoch &&
      previous.current.panes.length === patch.panes.length &&
      patch.panes.every((pane, index) => pane.id === previous.current.panes?.[index]?.id)
    ) {
      const changes = panePatches(previous.current.panes, patch.panes);
      patch = Object.fromEntries(Object.entries(patch).filter(([key]) => key !== "panes"));
      if (Object.keys(changes).length) patch.panePatches = changes;
    }
    if (!Object.keys(patch).length) return;
    frame.current?.contentWindow?.postMessage(
      JSON.stringify({
        channel: COMPOSE_CHANNEL,
        version: COMPOSE_VERSION,
        type: "patch",
        ...patch,
      }),
      location.origin,
    );
    previous.current = snapshot;
  }, [snapshot, ready, supportsPanes]);

  return (
    <div className="vy-kmp-host" data-kmp-ready={ready}>
      {paneIds.map((id) => (
        <KmpPaneBridge key={id} chatId={id} onChange={publishPane} />
      ))}
      <iframe
        key={attempt}
        ref={frame}
        src="/dist/ui-compose/index.html"
        title="Vyline Compose UI"
        onError={() => setError(true)}
      />
      {!ready && (
        <div className="vy-kmp-loading" role="status">
          <p>{error ? "Compose UIを読み込めませんでした" : "Compose UIを起動中…"}</p>
          {error && (
            <button type="button" onClick={() => setAttempt((current) => current + 1)}>
              再試行
            </button>
          )}
          <button type="button" onClick={() => useDesignSystemStore.getState().setMode("legacy")}>
            Vyline Classicを開く
          </button>
        </div>
      )}
      {ready &&
        panes.map((pane) => (
          <KmpHostedMessages
            key={`${epoch}:${pane.id}`}
            frame={frame.current}
            epoch={epoch}
            chatId={pane.id}
            onHeight={reportContentHeight}
            onModel={reportContentModel}
            canJoinCall={!!pane.chatUi?.groupCall}
            joiningCall={!!pane.chatUi?.joiningCall}
          />
        ))}
      {compatibility && (
        <Suspense fallback={null}>
          <KmpCompatibility request={compatibility} onClose={closeCompatibility} />
        </Suspense>
      )}
    </div>
  );
}
