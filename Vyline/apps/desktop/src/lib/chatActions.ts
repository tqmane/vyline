import { api } from "@/api/client";
import { useStore } from "./store";

const BLOCK_PROTECTED_MIDS = new Set(["u085311ecd9e3e3d74ae4c9f5437cbcb5"]);

export async function removeChatAnnouncement(chatId: string, sequence: string): Promise<void> {
  const state = useStore.getState();
  if (!(state.announcements[chatId] ?? []).some((item) => item.announcementSeq === sequence))
    return;
  if (state.demoMode) {
    state.removeAnnouncement(chatId, sequence);
    return;
  }
  if (!state.accountId) return;
  try {
    const result = await api.line.announce.remove(state.accountId, chatId, sequence);
    if (useStore.getState().accountId !== state.accountId) return;
    if (!result.ok) throw new Error("アナウンスの解除に失敗しました");
    useStore.getState().removeAnnouncement(chatId, sequence);
  } catch (error) {
    if (useStore.getState().accountId === state.accountId)
      useStore
        .getState()
        .showNotice(error instanceof Error ? error.message : "アナウンスの解除に失敗しました");
  }
}

export function announcementMessageId(link: string): string | undefined {
  const match = link.match(/[?&]messageId=([^&]+)/);
  try {
    return match ? decodeURIComponent(match[1]!) : undefined;
  } catch {
    return undefined;
  }
}

export function canToggleContactBlock(chatId: string): boolean {
  const state = useStore.getState();
  const chat = state.chats.find((entry) => entry.id === chatId);
  return (
    !!state.accountId &&
    chat?.type === "friend" &&
    !chat.isSelf &&
    !BLOCK_PROTECTED_MIDS.has(chatId) &&
    !state.lockedChatMids.includes(chatId)
  );
}

/** Both renderers use the same guarded API/state update. Confirmation belongs to the view. */
export async function setContactBlocked(
  chatId: string,
  blocked: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const state = useStore.getState();
  if (!canToggleContactBlock(chatId) || !state.accountId)
    return { ok: false, error: "この連絡先のブロック状態は変更できません" };
  try {
    const result = blocked
      ? await api.line.blockContact(state.accountId, chatId)
      : await api.line.unblockContact(state.accountId, chatId);
    if (useStore.getState().accountId !== state.accountId) return { ok: false };
    if (!result.ok) return { ok: false, error: result.error ?? "ブロック操作に失敗しました" };
    useStore.setState((current) => ({
      blockedMids: blocked
        ? [...new Set([...current.blockedMids, chatId])]
        : current.blockedMids.filter((id) => id !== chatId),
      ...(blocked
        ? {
            chats: current.chats.filter((chat) => chat.id !== chatId),
            activeChatId: current.activeChatId === chatId ? null : current.activeChatId,
          }
        : {}),
    }));
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "ブロック操作に失敗しました",
    };
  }
}
