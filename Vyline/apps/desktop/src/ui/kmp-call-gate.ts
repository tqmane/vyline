import { canStartCall } from "../utils/callAllowlist";
import type { ControllerConfirmOptions } from "./controller-dialog";

type CallKind = "voice" | "video";
export type KmpCallGateState = {
  accountId: string | null;
  activeChatId: string | null;
  screen: string;
  chatPaneIds: readonly string[];
  focusedChatPane: number;
  chats: readonly { id: string }[];
  lockedChatMids: readonly string[];
  blockedMids: readonly string[];
  callRequest: unknown;
};

// Match ChatShell's rendered pane filtering/fallback and effective focus, which
// are passed to KmpAppHost. Keep the representation so closing the last explicit
// pane retires consent even when the same active chat is rendered as a fallback.
function paneScope(state: KmpCallGateState) {
  const valid = state.chatPaneIds.filter((id) => state.chats.some((chat) => chat.id === id)).slice(0, 4);
  const fallback = valid.length === 0;
  const ids = fallback
    ? state.activeChatId && state.chats.some((chat) => chat.id === state.activeChatId) ? [state.activeChatId] : []
    : valid;
  const focusedId = state.chatPaneIds[state.focusedChatPane] ?? state.activeChatId;
  const index = Math.max(0, ids.indexOf(focusedId ?? ""));
  return { id: ids[index], index, fallback };
}

/** Confirmation only: the injected dispatch is the sole call-controller boundary. */
export function createKmpCallGate(deps: {
  getState: () => KmpCallGateState;
  getEpoch: () => number;
  subscribe: (listener: () => void) => () => void;
  confirm: (text: string, options: ControllerConfirmOptions, signal: AbortSignal) => Promise<boolean>;
  requestCall: (to: string, kind: CallKind) => void;
}) {
  let disposed = false;
  let generation = 0;
  let pending: { chatId: string; kind: CallKind; invalidate: () => void } | null = null;
  const eligible = (state: KmpCallGateState, chatId: string, kind: CallKind) =>
    !!state.accountId && state.screen === "chat" && state.activeChatId === chatId &&
    paneScope(state).id === chatId &&
    state.chats.some((chat) => chat.id === chatId) && canStartCall(chatId, kind) &&
    !state.lockedChatMids.includes(chatId) && !state.blockedMids.includes(chatId) &&
    !state.callRequest;

  return {
    async request(chatId: string, kind: CallKind, name: string): Promise<boolean> {
      const state = deps.getState();
      if (disposed || !eligible(state, chatId, kind)) return false;
      if (pending?.chatId === chatId && pending.kind === kind) return false;
      const requestGeneration = ++generation;
      const accountId = state.accountId;
      const epoch = deps.getEpoch();
      const paneIndex = state.focusedChatPane;
      const originPane = paneScope(state);
      pending?.invalidate();
      // Abort/close notifications may synchronously start a newer request or dispose.
      if (disposed || requestGeneration !== generation) return false;
      const controller = new AbortController();
      let unsubscribe: (() => void) | undefined;
      // Release ownership before notifying cancellation; never touch a newer dialog.
      const request = { chatId, kind, invalidate: () => {
        if (pending === request) pending = null;
        const cleanup = unsubscribe;
        unsubscribe = undefined;
        cleanup?.();
        controller.abort();
      } };
      pending = request;
      const isCurrent = () => {
        const current = deps.getState();
        const pane = paneScope(current);
        return !disposed && !controller.signal.aborted && pending === request && deps.getEpoch() === epoch &&
          current.accountId === accountId && current.focusedChatPane === paneIndex &&
          pane.index === originPane.index && pane.fallback === originPane.fallback &&
          eligible(current, chatId, kind);
      };
      const label = kind === "video" ? "ビデオ通話" : "音声通話";
      const group = chatId.startsWith("c");
      const text = group
        ? `${name} の${label}に参加しますか？通話がない場合は開始します。`
        : `${name} に${label}を発信しますか？`;
      try {
        // Observe every transition: A -> B -> A must not revive old consent.
        // Subscribe may notify synchronously before returning its cleanup function.
        unsubscribe = deps.subscribe(() => { if (!isCurrent()) request.invalidate(); });
        if (!isCurrent()) return false;
        if (!await deps.confirm(text, {
          title: `${label}の確認`,
          acceptLabel: group ? "参加 / 開始する" : "発信する",
          cancelFirst: true,
        }, controller.signal) || !isCurrent()) return false;
        // No await between the final live checks and dispatch.
        deps.requestCall(chatId, kind);
        return true;
      } catch {
        // A failed/dismissed confirmation is never implicit permission to call.
        return false;
      } finally {
        request.invalidate();
      }
    },
    dispose() {
      disposed = true;
      pending?.invalidate();
    },
  };
}
