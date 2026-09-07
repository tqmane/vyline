import type { Chat, Message } from "./store-types";
import { displayName, sortChats } from "./store";

export type ChatListTab = "all" | "friend" | "group" | "hidden" | "official";

export function filterChatList(
  chats: Chat[],
  messages: Message[],
  tab: ChatListTab,
  query: string,
  sort: "recent" | "unread" | "custom",
  customOrder: string[],
): Chat[] {
  let list = chats;
  if (tab === "friend")
    list = chats.filter((c) => c.type === "friend" && !c.isOfficial && !c.hidden && !c.left);
  else if (tab === "group")
    list = chats.filter((c) => c.type === "group" && !c.hidden && (!c.left || c.restoredHistory));
  else if (tab === "hidden") list = chats.filter((c) => c.hidden);
  else if (tab === "official") list = chats.filter((c) => c.isOfficial && !c.hidden && !c.left);
  else
    list = chats.filter(
      (c) =>
        !c.hidden && (!c.left || c.restoredHistory || (c.members != null && c.members.length > 0)),
    );
  if (query.trim()) {
    const q = query.toLowerCase();
    list = list.filter((c) => displayName(c, false).toLowerCase().includes(q));
  }
  return sortChats(list, sort, sort === "custom" ? [] : messages, customOrder);
}

export function buildPreviewMap(
  messages: Message[],
  chats: Chat[],
  prev?: Map<string, { text: string; time: number } | null>,
): Map<string, { text: string; time: number } | null> {
  const previewForMessage = (m: (typeof messages)[number]): string => {
    if (m.messageState.startsWith("revoked")) {
      if (m.revokedSnapshot) return `取り消し済み: ${previewForMessage(m.revokedSnapshot)}`;
      const last = m.history
        ? [...m.history].reverse().find((h) => h.state === "normal" || h.state === "edited")
        : undefined;
      return last?.text ? `取り消し済み: ${last.text}` : "取り消し済みのメッセージ";
    }
    if (m.kind === "sticker") return m.altText || "[スタンプ]";
    if (m.kind === "image") return "[画像]";
    if (m.kind === "video") return "[動画]";
    if (m.kind === "audio") return "[音声メッセージ]";
    if (m.kind === "file") return `[${m.file?.name || "ファイル"}]`;
    if (m.kind === "flex" || m.kind === "rich")
      return m.altText || m.text || (m.kind === "flex" ? "[Flex]" : "[リッチメッセージ]");
    if (m.kind === "call") return "[通話]";
    if (m.kind === "emoji") return "[絵文字]";
    if (m.kind === "location") return "[位置情報]";
    if (m.kind === "contact") return "[連絡先]";
    if (m.kind === "system") return m.text ?? "";
    return m.text ?? "";
  };

  const lastByChat = new Map<string, (typeof messages)[number]>();
  for (const message of messages) {
    const previous = lastByChat.get(message.chatId);
    if (
      !previous ||
      message.createdAt > previous.createdAt ||
      (message.createdAt === previous.createdAt && message.id.localeCompare(previous.id) > 0)
    ) {
      lastByChat.set(message.chatId, message);
    }
  }
  const out = new Map<string, { text: string; time: number } | null>();
  for (const chat of chats) {
    const last = lastByChat.get(chat.id);
    // 前回と同内容なら前回のオブジェクトを使い ChatRow の memo を有効に保つ
    const prevEntry = prev?.get(chat.id);
    const stable = (text: string, time: number) =>
      prevEntry && prevEntry.text === text && prevEntry.time === time ? prevEntry : { text, time };
    const apiTime = chat.lastMessageTime ?? 0;
    if (!last) {
      out.set(chat.id, chat.lastMessagePreview ? stable(chat.lastMessagePreview, apiTime) : null);
      continue;
    }
    let text = previewForMessage(last) || chat.lastMessagePreview || "";
    if (last.authorId === "me" && text) text = `あなた: ${text}`;
    out.set(chat.id, stable(text, Math.max(last.createdAt, apiTime)));
  }
  return out;
}
