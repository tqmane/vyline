import type { Chat } from "./store-types";

export const isUserMid = (value: string) => /^u[0-9a-f]{32}$/i.test(value);
export const maskSocialUrls = (value: string, mask: boolean) => mask ? value.replace(/https?:\/\/[^\s]+/giu, "[URL]") : value;

export function mergeCommonGroups(local: Chat[], remote: Array<{ chatMid: string; name: string; thumbnailUrl?: string }>, chats: Chat[], exclude?: string): Chat[] {
  const byId = new Map(chats.map(chat => [chat.id, chat]));
  const groups = new Map(local.filter(chat => !chat.left && chat.id !== exclude).map(chat => [chat.id, chat]));
  for (const group of remote) {
    const cached = byId.get(group.chatMid);
    if (cached?.left || group.chatMid === exclude || !/^[cr][0-9a-f]{32}$/i.test(group.chatMid)) continue;
    const name = group.name && !/^[ucr][0-9a-f]{32}$/i.test(group.name) ? group.name : cached?.name || "グループ";
    groups.set(group.chatMid, { ...cached, id: group.chatMid, type: "group", name, avatar: name.charAt(0).toUpperCase(), avatarUrl: group.thumbnailUrl || cached?.avatarUrl, color: cached?.color ?? "#7c5cff", status: "グループ", unread: cached?.unread ?? 0 });
  }
  return [...groups.values()];
}
