/**
 * App-local event channel for cross-tree UI coordination.
 *
 * Do not use `window` as an application event bus: those events leak outside
 * the React tree, are hard to type, and can survive refactors unnoticed.
 */
export type ChatPresentation = {
  chatId: string;
  accountId: string | null;
  search: { open: boolean; query: string; index: number; count: number; activeId: string | null };
  groupCall: { kind: "voice" | "video"; memberCount: number } | null;
  joiningCall: boolean;
  refreshing: boolean;
  announcementExpanded?: boolean;
};

export interface AppEventMap {
  "chat:presentation": ChatPresentation;
  "chat:presentation-request": { chatId: string };
  "chat:scroll-latest": { chatId: string; accountId?: string | null };
  "chat:ui-command": {
    chatId: string;
    action:
      | "search"
      | "search-query"
      | "search-next"
      | "search-previous"
      | "search-close"
      | "announcement-toggle"
      | "refresh"
      | "join-call"
      | "menu";
    value?: string;
    x?: number;
    y?: number;
  };
  "chat:context-menu": { chatId: string; x: number; y: number };
  "chat:split-picker": undefined;
  "backup:changed": { accountId: string };
  "history:load-older": { chatMid: string };
  "history:state": { chatMid: string; hasMore: boolean; loading: boolean };
  "backup:restored": {
    accountId: string;
    chatMids: string[];
    source: "android" | "ios";
  };
  "hidden-chats:changed": { data: Record<string, string[]> };
}

/** Local sends qualify their account; legacy manual latest requests omit it. */
export function matchesChatScrollLatestScope(
  detail: AppEventMap["chat:scroll-latest"],
  chatId: string,
  accountId: string | null,
): boolean {
  return (
    detail.chatId === chatId && (detail.accountId === undefined || detail.accountId === accountId)
  );
}

type Listener<K extends keyof AppEventMap> = (detail: AppEventMap[K]) => void;
const listeners = new Map<keyof AppEventMap, Set<(detail: never) => void>>();

export function emitAppEvent<K extends keyof AppEventMap>(type: K, detail: AppEventMap[K]): void {
  const current = listeners.get(type);
  if (!current?.size) return;
  // Copy first so a listener may safely unsubscribe itself during dispatch.
  for (const listener of [...current]) listener(detail as never);
}

export function onAppEvent<K extends keyof AppEventMap>(
  type: K,
  listener: Listener<K>,
): () => void {
  let current = listeners.get(type);
  if (!current) {
    current = new Set();
    listeners.set(type, current);
  }
  current.add(listener as (detail: never) => void);
  return () => {
    const active = listeners.get(type);
    if (!active) return;
    active.delete(listener as (detail: never) => void);
    if (active.size === 0) listeners.delete(type);
  };
}
