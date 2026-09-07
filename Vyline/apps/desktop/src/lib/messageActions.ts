import { api } from "@/api/client";
import { useStore } from "./store";

const REACTIONS = { 2: "NICE", 3: "LOVE", 4: "FUN", 5: "AMAZING", 6: "SAD", 7: "OMG" } as const;

/** Shared action for DOM and Compose presentations; optimistic state stays in Vyline. */
export async function reactToMessage(
  messageId: string,
  type: number,
  remove: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const state = useStore.getState();
  const message = state.messages.find((entry) => entry.id === messageId);
  const chat = message && state.chats.find((entry) => entry.id === message.chatId);
  const name = REACTIONS[type as keyof typeof REACTIONS];
  if (
    !message ||
    !chat ||
    !name ||
    (!state.accountId && !state.demoMode) ||
    messageId.startsWith("pending_")
  )
    return { ok: false };
  if (chat.isOfficial) return { ok: false, error: "公式アカウントにはリアクションできません" };
  if (Date.now() - message.createdAt > 14 * 24 * 60 * 60 * 1000)
    return { ok: false, error: "このメッセージは古すぎてリアクションできません" };
  state.setMessageReaction(message.id, remove ? "UNDO" : name, state.self.mid ?? "");
  if (state.demoMode) {
    state.showNotice(remove ? "リアクションを外しました" : "リアクションを追加しました");
    return { ok: true };
  }
  try {
    // LINE toggles the same reaction type; sending an UNDO enum is not supported.
    const result = await api.line.react(state.accountId!, message.id, name);
    return result.ok
      ? { ok: true }
      : { ok: false, error: result.error ?? "リアクションに失敗しました" };
  } catch {
    return { ok: false, error: "リアクションに失敗しました" };
  }
}
