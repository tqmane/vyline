import type { Chat } from "./store-types";
import { looksLikeMid } from "./mappers";

type ContactProfileUpdate = {
  displayName?: string;
  thumbnailUrl?: string;
  statusMessage?: string;
  backgroundUrl?: string;
};

/** Refresh existing contacts and group members without adding a friendship or membership. */
export function updateContactProfile(chats: Chat[], mid: string, profile: ContactProfileUpdate): Chat[] {
  const name = profile.displayName && !looksLikeMid(profile.displayName) ? profile.displayName : undefined;
  return chats.map(chat => {
    if (chat.id === mid) return {
      ...chat,
      name: name ?? chat.name,
      avatarUrl: profile.thumbnailUrl || chat.avatarUrl,
      status: profile.statusMessage ?? chat.status,
      statusMessage: profile.statusMessage ?? chat.statusMessage,
      backgroundUrl: profile.backgroundUrl ?? chat.backgroundUrl,
    };
    if (chat.type !== "group" || !chat.members?.some(member => member.id === mid)) return chat;
    return { ...chat, members: chat.members.map(member => member.id === mid ? {
      ...member,
      name: name ?? member.name,
      avatar: name ? name.trim().charAt(0).toUpperCase() : member.avatar,
      avatarUrl: profile.thumbnailUrl || member.avatarUrl,
    } : member) };
  });
}
