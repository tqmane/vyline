import { useMemo, useSyncExternalStore } from "react";
import { mapMessage } from "./mappers";
import type { Message } from "./store-types";
import type { MessageSearchController, SearchState } from "./searchController";

const panes = new Map<string, MessageSearchController>();
const listeners = new Set<() => void>();
const key = (account: string | null, chat: string | null) => JSON.stringify([account, chat]);
const notify = () => {
  for (const listener of listeners) listener();
};

/** Exposes the same pane controller to native projections without merging into store.messages. */
export function registerSearchPane(
  account: string | null,
  chat: string | null,
  controller: MessageSearchController,
) {
  const id = key(account, chat);
  panes.set(id, controller);
  const unsubscribe = controller.subscribe(notify);
  notify();
  return () => {
    unsubscribe();
    if (panes.get(id) === controller) panes.delete(id);
    notify();
  };
}

export function searchPaneMessages(
  state: SearchState | null,
  source: Message[],
  account: string | null,
  chat: string | null,
) {
  if (!state?.window || !account || !chat) return source;
  const loaded = new Map(
    source.filter((message) => message.chatId === chat).map((message) => [message.id, message]),
  );
  return state.window.messages.map(
    (message) => loaded.get(message.id) ?? mapMessage(message, chat, account),
  );
}

export function useSearchPaneState(account: string | null, chat: string | null) {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => panes.get(key(account, chat))?.getSnapshot() ?? null,
  );
}

export function useSearchPaneMessages(
  account: string | null,
  chat: string | null,
  source: Message[],
) {
  const state = useSearchPaneState(account, chat);
  return useMemo(
    () => searchPaneMessages(state, source, account, chat),
    [state?.window, source, account, chat],
  );
}

export function getSearchPaneController(account: string | null, chat: string | null) {
  return panes.get(key(account, chat));
}

export function getSearchPaneMessages(
  account: string | null,
  chat: string | null,
  source: Message[],
) {
  return searchPaneMessages(
    panes.get(key(account, chat))?.getSnapshot() ?? null,
    source,
    account,
    chat,
  );
}
