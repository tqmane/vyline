import { api } from "@/api/client";
import { useStore } from "./store";
import type { Chat, Message } from "./store-types";

const REACTIONS = { 2: "NICE", 3: "LOVE", 4: "FUN", 5: "AMAZING", 6: "SAD", 7: "OMG" } as const;

export function canReactToMessage(message: Message, chat: Chat, now = Date.now()): boolean {
  return (
    !chat.isOfficial &&
    !message.id.startsWith("pending_") &&
    message.status !== "sending" &&
    message.status !== "failed" &&
    !message.messageState.startsWith("revoked") &&
    now - message.createdAt <= 14 * 24 * 60 * 60 * 1000
  );
}

/** Shared by Classic and Compose; only commit local reactions after a successful RPC. */
export async function reactToMessage(
  messageId: string,
  type: number | NonNullable<Message["reactions"]>[number]["emoji"],
  remove: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const state = useStore.getState();
  const message = state.messages.find(entry => entry.id === messageId);
  const chat = message && state.chats.find(entry => entry.id === message.chatId);
  const reaction = remove ? "UNDO" : typeof type === "object" ? type : REACTIONS[type as keyof typeof REACTIONS];
  if (!message || !chat || !reaction || (!state.accountId && !state.demoMode) || !canReactToMessage(message, chat))
    return { ok: false, error: "このメッセージにはリアクションできません" };
  try {
    if (!state.demoMode) {
      const result = await api.line.react(state.accountId!, message.id, reaction);
      if (!result.ok) return { ok: false, error: result.error ?? "リアクションに失敗しました" };
    }
    if (useStore.getState().accountId !== state.accountId || useStore.getState().demoMode !== state.demoMode) return { ok: false };
    state.setMessageReaction(message.id, reaction, state.self.mid ?? "");
    return { ok: true };
  } catch {
    return { ok: false, error: "リアクションに失敗しました" };
  }
}
