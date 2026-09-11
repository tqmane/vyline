import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { useStore } from "@/lib/store";

export type NativeSceneLayer = {
  id: string;
  label: string;
  url: string;
  x: number;
  y: number;
  size: number;
  xId: string;
  yId: string;
  sizeId: string;
  removeId: string;
};
export type NativePanelItem = {
  id: string;
  kind:
    | "text"
    | "heading"
    | "row"
    | "choice"
    | "progress"
    | "account"
    | "slider"
    | "button"
    | "input"
    | "toggle"
    | "select"
    | "image"
    | "media"
    | "portal"
    | "avatar"
    | "avatar-image"
    | "profile-summary"
    | "link"
    | "section"
    | "grid"
    | "tool-grid"
    | "strip"
    | "sticker-tabs"
    | "sticker-packs"
    | "navigation"
    | "navigation-item"
    | "scene"
    | "call-width"
    | "call-header"
    | "call-summary"
    | "call-controls";
  label: string;
  description?: string;
  symbol?: string;
  caption?: string;
  live?: boolean;
  size?: number;
  color?: string;
  value?: string;
  minimum?: number;
  maximum?: number;
  step?: number;
  url?: string;
  backgroundUrl?: string;
  largeImage?: boolean;
  showLabel?: boolean;
  mediaId?: string;
  mediaVersion?: string;
  autoplay?: boolean;
  disabled?: boolean;
  danger?: boolean;
  primary?: boolean;
  multiline?: boolean;
  secret?: boolean;
  readOnly?: boolean;
  secondary?: boolean;
  sceneSize?: number;
  minSize?: number;
  maxSize?: number;
  layers?: NativeSceneLayer[];
  confirm?: string;
  options?: { value: string; label: string }[];
  items?: NativePanelItem[];
};
export type NativePanelSnapshot = {
  id: string;
  title: string;
  items: NativePanelItem[];
  compact?: boolean;
  presentation?: "sheet" | "stickers";
  callLayout?: string;
  confirmation?: { id: string; text: string };
};
export type NativePanelControl = Omit<NativePanelItem, "items"> & {
  items?: NativePanelControl[];
  onClick?: (() => void) | (() => Promise<unknown>);
  onChange?: (value: string) => void;
  onSelection?: (start: number, end: number) => void;
  onSecondary?: (x: number, y: number) => void;
};
type Source = {
  accountId: string | null;
  title: string;
  items: NativePanelControl[];
  onClose: () => void;
  chatId?: string;
  modal?: boolean;
  compact?: boolean;
  presentation?: "sheet" | "stickers";
  callLayout?: string;
  persistent?: boolean;
};
type PanelRecord = {
  owner: symbol;
  source: Source;
  snapshot: NativePanelSnapshot;
  controls: Map<string, NativePanelControl>;
};
let active: PanelRecord | null = null;
const inlinePanels = new Map<symbol, PanelRecord>();
const panelsById = new Map<string, PanelRecord>();
const pendingActions = new Set<string>();
let generation = 0;
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};
const getSnapshot = () =>
  active?.source.accountId === useStore.getState().accountId ? (active?.snapshot ?? null) : null;

export function useNativePanelSnapshot() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot,
    () => null,
  );
}

/** Host controllers publish values and callbacks; only Kotlin lays out or paints this panel. */
export function usePublishNativePanel(
  source: Source,
  enabled = true,
  onSnapshot?: (value: NativePanelSnapshot | null, retiredId?: string) => void,
) {
  const owner = useRef(Symbol("native-panel"));
  const registered = useRef(new Set<string>());
  const report = useRef(onSnapshot);
  report.current = onSnapshot;
  useLayoutEffect(() => {
    if (!enabled || source.accountId !== useStore.getState().accountId) return;
    const inline = !!onSnapshot && (!source.modal || source.persistent);
    const previous = inline
      ? inlinePanels.get(owner.current)
      : active?.owner === owner.current
        ? active
        : null;
    const panelId = previous?.snapshot.id ?? `panel-${++generation}`;
    const controls = new Map<string, NativePanelControl>();
    const project = (items: NativePanelControl[]): NativePanelItem[] =>
      items.map(({ onClick, onChange, onSelection, onSecondary, items: children, ...item }) => {
        const id = `${panelId}:${item.id}`;
        controls.set(id, { ...item, id, onClick, onChange, onSelection, onSecondary });
        return {
          ...item,
          id,
          ...(item.layers
            ? {
                layers: item.layers.map((layer) => ({
                  ...layer,
                  xId: `${panelId}:${layer.xId}`,
                  yId: `${panelId}:${layer.yId}`,
                  sizeId: `${panelId}:${layer.sizeId}`,
                  removeId: `${panelId}:${layer.removeId}`,
                })),
              }
            : {}),
          ...(children ? { items: project(children) } : {}),
        };
      });
    const snapshot: NativePanelSnapshot = {
      id: panelId,
      title: source.title,
      compact: source.compact,
      presentation: source.presentation,
      callLayout: source.callLayout,
      items: project(source.items),
      confirmation: previous?.snapshot.confirmation,
    };
    if (snapshot.confirmation && !controls.has(snapshot.confirmation.id))
      snapshot.confirmation = undefined;
    const same = previous && JSON.stringify(previous.snapshot) === JSON.stringify(snapshot);
    const record = {
      owner: owner.current,
      source,
      controls,
      snapshot: same ? previous.snapshot : snapshot,
    };
    panelsById.set(record.snapshot.id, record);
    registered.current.add(record.snapshot.id);
    if (inline) {
      inlinePanels.set(owner.current, record);
      if (active?.owner === owner.current) {
        panelsById.delete(active.snapshot.id);
        active = null;
        notify();
      }
      if (!same) onSnapshot?.(record.snapshot);
    } else {
      active = record;
      if (!same) notify();
    }
  });
  useLayoutEffect(
    () => () => {
      const inline = inlinePanels.get(owner.current);
      if (inline) {
        panelsById.delete(inline.snapshot.id);
        inlinePanels.delete(owner.current);
        report.current?.(null, inline.snapshot.id);
      }
      if (active?.owner === owner.current) {
        panelsById.delete(active.snapshot.id);
        active = null;
        notify();
      }
      for (const id of registered.current)
        if (panelsById.get(id)?.owner === owner.current) panelsById.delete(id);
      registered.current.clear();
    },
    [enabled, source.accountId],
  );
}

export function invokeNativePanel(
  action: string,
  id?: string,
  value?: string,
  start?: number,
  end?: number,
  x = 16,
  y = 16,
  chatId?: string,
): boolean {
  const panel = id ? panelsById.get(id.split(":", 1)[0]!) : active;
  if (!panel || panel.source.accountId !== useStore.getState().accountId) return false;
  if (
    (active && panel !== active && !panel.source.persistent) ||
    (panel !== active && !inlinePanels.has(panel.owner))
  )
    return false;
  if (panel.source.chatId && panel.source.chatId !== chatId) return false;
  if (action === "panel-close") {
    if (panel !== active && !panel.source.persistent) return false;
    panelsById.delete(panel.snapshot.id);
    if (panel === active) active = null;
    notify();
    panel.source.onClose();
    return true;
  }
  if (action === "panel-cancel") {
    panel.snapshot = { ...panel.snapshot, confirmation: undefined };
    notify();
    return true;
  }
  const control = id ? panel.controls.get(id) : undefined;
  if (!control || control.disabled) return false;
  if (action === "panel-secondary") {
    if (!control.onSecondary) return false;
    control.onSecondary(x, y);
    return true;
  }
  if (action === "panel-selection") {
    if (
      !control.onSelection ||
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start! < 0 ||
      end! < start! ||
      end! > (control.value?.length ?? 0)
    )
      return false;
    control.onSelection(start!, end!);
    return true;
  }
  if (action === "panel-change") {
    if (value === undefined || value.length > 32000 || !control.onChange || control.readOnly)
      return false;
    if (control.kind === "toggle" && !["true", "false"].includes(value)) return false;
    if (control.kind === "choice" && value !== "true") return false;
    if (control.kind === "slider" && (!Number.isFinite(Number(value)) || Number(value) < (control.minimum ?? 0) || Number(value) > (control.maximum ?? 1))) return false;
    if (control.kind === "select" && !control.options?.some((option) => option.value === value))
      return false;
    if (
      control.kind === "call-width" &&
      (!Number.isFinite(Number(value)) || Number(value) < 320 || Number(value) > 10000)
    )
      return false;
    control.onChange(value);
    return true;
  }
  if (action === "panel-action" && control.confirm) {
    panel.snapshot = { ...panel.snapshot, confirmation: { id: control.id, text: control.confirm } };
    notify();
    return true;
  }
  if (action === "panel-confirm" && panel.snapshot.confirmation?.id !== control.id) return false;
  if (action !== "panel-action" && action !== "panel-confirm") return false;
  if (pendingActions.has(control.id)) return false;
  pendingActions.add(control.id);
  panel.snapshot = { ...panel.snapshot, confirmation: undefined };
  notify();
  Promise.resolve()
    .then(() => {
      const current = panelsById.get(panel.snapshot.id);
      const currentControl = current?.controls.get(control.id);
      if (
        current?.source.accountId === useStore.getState().accountId &&
        currentControl &&
        !currentControl.disabled &&
        currentControl.label === control.label &&
        currentControl.confirm === control.confirm
      )
        return currentControl.onClick?.();
    })
    .catch((error) => {
      if (panel.source.accountId === useStore.getState().accountId)
        useStore
          .getState()
          .showNotice(error instanceof Error ? error.message : "操作に失敗しました");
    })
    .finally(() => pendingActions.delete(control.id));
  return true;
}
