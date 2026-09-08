import { useSyncExternalStore } from "react";
import { useStore } from "@/lib/store";
import type { NativePanelSnapshot } from "./native-panel";

let current: { accountId: string | null; snapshot: NativePanelSnapshot } | null = null;
const listeners = new Set<() => void>();
export function publishControllerCall(accountId: string | null, snapshot: NativePanelSnapshot | null, retiredId?: string) {
  if (snapshot) {
    if (useStore.getState().accountId !== accountId) return;
    current = { accountId, snapshot };
  } else {
    if (current?.accountId !== accountId || current.snapshot.id !== retiredId) return;
    current = null;
  }
  for (const listener of listeners) listener();
}
export function useControllerCallSnapshot() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => current?.accountId === useStore.getState().accountId ? current?.snapshot ?? null : null, () => null);
}
