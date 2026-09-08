import { useSyncExternalStore } from "react";
import { useStore } from "@/lib/store";
import { isComposeMode, useDesignSystemStore } from "./design-system-store";

export type ControllerDialog = { id: string; text: string; prompt: boolean; value: string };
let current: { snapshot: ControllerDialog; accountId: string | null; resolve: (value: string | null) => void } | null = null;
let generation = 0;
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };
const snapshot = () => current?.accountId === useStore.getState().accountId ? current?.snapshot ?? null : null;
export function useControllerDialogSnapshot() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, snapshot, () => null);
}
export function closeControllerDialog(id?: string, value: string | null = null): void {
  const dialog = current;
  if (!dialog || id !== undefined && dialog.snapshot.id !== id) return;
  current = null; notify();
  dialog.resolve(dialog.accountId === useStore.getState().accountId ? value : null);
}
function ask(text: string, prompt: boolean, value = ""): Promise<string | null> {
  closeControllerDialog();
  return new Promise((resolve) => {
    current = { snapshot: { id: `dialog-${++generation}`, text, prompt, value }, accountId: useStore.getState().accountId, resolve };
    notify();
  });
}
export async function requestControllerConfirm(text: string): Promise<boolean> {
  if (!isComposeMode(useDesignSystemStore.getState().mode)) return window.confirm(text);
  return await ask(text, false) !== null;
}
export function requestControllerPrompt(text: string, value = ""): Promise<string | null> {
  if (!isComposeMode(useDesignSystemStore.getState().mode)) return Promise.resolve(window.prompt(text, value));
  return ask(text, true, value);
}
