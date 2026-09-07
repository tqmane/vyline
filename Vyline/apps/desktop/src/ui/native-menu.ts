import { useSyncExternalStore } from "react";

export type NativeMenuItem = {
  id: string;
  label: string;
  danger: boolean;
  children: NativeMenuItem[];
};

/** Presentation only; callbacks and account binding never enter the iframe. */
export type NativeMenuSnapshot = {
  id: string;
  x: number;
  y: number;
  items: NativeMenuItem[];
};

type MenuSourceItem = {
  label: string;
  danger?: boolean;
  children?: MenuSourceItem[];
  onClick?: () => void;
};

type MenuSource = {
  x: number;
  y: number;
  items: MenuSourceItem[];
  accountId: string | null;
  getAccountId: () => string | null;
  onClose: () => void;
};

let available = false;
let generation = 0;
let active: {
  owner: symbol;
  snapshot: NativeMenuSnapshot;
  source: MenuSource;
  actions: Map<string, (() => void) | undefined>;
} | null = null;
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function getNativeMenuSnapshot(): NativeMenuSnapshot | null {
  return active && active.source.accountId === active.source.getAccountId()
    ? active.snapshot
    : null;
}

export function useNativeMenuSnapshot(): NativeMenuSnapshot | null {
  return useSyncExternalStore(subscribe, getNativeMenuSnapshot, () => null);
}

export function useNativeMenuAvailable(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => available,
    () => false,
  );
}

export function setNativeMenuAvailable(value: boolean): void {
  if (available === value) return;
  available = value;
  // A lost renderer must not retain executable callbacks; the mounted React menu can fall back.
  if (!value) active = null;
  notify();
}

export function publishNativeMenu(owner: symbol, source: MenuSource): void {
  if (!available || source.accountId !== source.getAccountId()) return;
  const previous = active;
  const id = `native-menu-${++generation}`;
  const actions = new Map<string, (() => void) | undefined>();
  let itemIndex = 0;
  const project = (items: MenuSourceItem[]): NativeMenuItem[] =>
    items.map((item) => {
      const itemId = `${id}-${++itemIndex}`;
      const children = project(item.children ?? []);
      if (!children.length) actions.set(itemId, item.onClick);
      return { id: itemId, label: item.label, danger: !!item.danger, children };
    });
  active = {
    owner,
    source,
    actions,
    snapshot: { id, x: source.x, y: source.y, items: project(source.items) },
  };
  notify();
  // Replacing a menu dismisses its original host state, without letting its cleanup erase us.
  if (previous && previous.owner !== owner) previous.source.onClose();
}

export function unpublishNativeMenu(owner: symbol): void {
  if (active?.owner !== owner) return;
  active = null;
  notify();
}

export function invokeNativeMenu(itemId: string): boolean {
  const menu = active;
  if (!available || !menu || !menu.actions.has(itemId)) return false;
  if (menu.source.accountId !== menu.source.getAccountId()) {
    unpublishNativeMenu(menu.owner);
    menu.source.onClose();
    return false;
  }
  const action = menu.actions.get(itemId);
  // Retire before calling the host, so a duplicate or reentrant click cannot execute twice.
  unpublishNativeMenu(menu.owner);
  try {
    action?.();
  } finally {
    menu.source.onClose();
  }
  return true;
}

export function dismissNativeMenu(menuId?: string): boolean {
  const menu = active;
  if (!menu || (menuId !== undefined && menu.snapshot.id !== menuId)) return false;
  unpublishNativeMenu(menu.owner);
  menu.source.onClose();
  return true;
}
