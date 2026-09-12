import { useSyncExternalStore } from "react";
import type { SticonResource } from "@/utils/lineSticon";

export type ComposerMention = { mid?: string; all?: boolean; name: string };
export type ComposerSelection = { start: number; end: number };
export type ComposerSnapshot = {
  chatId: string;
  /** Host-only: never include account credentials in the iframe snapshot. */
  accountId: string | null;
  text: string;
  selectionStart: number;
  selectionEnd: number;
  replyToId?: string;
  replyText?: string;
  replyAuthor?: string;
  pending: { id: string; name: string; url: string; kind: "image" | "video" | "file" }[];
  recording: boolean;
  recordingSeconds: number;
  recordingLevels?: number[];
  sending: boolean;
  enterToSend: boolean;
  voiceEnabled: boolean;
  mute: boolean;
  blocked: boolean;
  locked: boolean;
  mentionOptions: ComposerMention[];
  mentionIndex: number;
  sticons: SticonResource[];
};

/** Imperative view adapter over the existing MessageInput controller.
 * It owns no drafts, uploads, recordings, account data or send implementation.
 */
export type ComposerController = {
  snapshot: ComposerSnapshot;
  setText: (text: string, selectionStart?: number, selectionEnd?: number) => void;
  setSelection: (start: number, end?: number) => void;
  send: () => void;
  pickFiles: (kind?: "media" | "file") => void;
  addFiles: (files: File[]) => void;
  removeFile: (id: string) => void;
  clearFiles: () => void;
  sendMedia: () => Promise<void>;
  setMuted: (muted: boolean) => void;
  startRecording: () => void;
  stopRecording: (send: boolean) => void;
  insertMention: (mention: ComposerMention) => void;
  insertEmoji: (packageId: string, sticonId: string) => void;
  sendSticker: (packageId: string, stickerId: string, isPremium?: boolean) => Promise<void>;
  sendCombinationSticker: (
    items: { packageId: string; stickerId: string; x?: number; y?: number; size?: number }[],
  ) => Promise<void>;
};

const controllers = new Map<string, { owner: symbol; controller: ComposerController }>();
const listeners = new Set<() => void>();

export function publishComposerController(owner: symbol, controller: ComposerController): void {
  const chatId = controller.snapshot.chatId;
  if (controllers.get(chatId)?.controller === controller) return;
  controllers.set(chatId, { owner, controller });
  for (const listener of listeners) listener();
}

export function unregisterComposerController(chatId: string, owner: symbol): void {
  // An old pane's cleanup must not unregister the new pane for the same chat.
  if (controllers.get(chatId)?.owner !== owner) return;
  controllers.delete(chatId);
  for (const listener of listeners) listener();
}

export function getComposerController(
  chatId: string | null | undefined,
): ComposerController | null {
  return chatId ? (controllers.get(chatId)?.controller ?? null) : null;
}

export function subscribeComposerControllers(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useComposerController(
  chatId: string | null | undefined,
): ComposerController | null {
  return useSyncExternalStore(
    subscribeComposerControllers,
    () => getComposerController(chatId),
    () => null,
  );
}

export function clampComposerSelection(
  text: string,
  start = text.length,
  end = start,
): ComposerSelection {
  const clamp = (value: number) =>
    Number.isFinite(value) ? Math.min(text.length, Math.max(0, Math.floor(value))) : text.length;
  const from = clamp(start);
  return { start: from, end: Math.max(from, clamp(end)) };
}

/** A controller publish can lag the store draft by one React commit. Never pair an old range with new text. */
export function composerSelectionForDraft(
  draft: string,
  snapshot: ComposerSnapshot | null | undefined,
): ComposerSelection {
  return snapshot?.text === draft
    ? clampComposerSelection(draft, snapshot.selectionStart, snapshot.selectionEnd)
    : clampComposerSelection(draft);
}

/** Reply id comes from the store; only reuse the controller preview when it describes that same reply. */
export function composerReplyPreview(
  snapshot: ComposerSnapshot | null | undefined,
  replyId: string | undefined,
  fallback: string | undefined,
): string | undefined {
  if (!snapshot || snapshot.replyToId !== replyId) return fallback;
  return snapshot.replyText || fallback;
}
