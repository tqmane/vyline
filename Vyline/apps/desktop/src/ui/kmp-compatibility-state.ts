import type { Chat } from "@/lib/store";

type ScopedRequest = {
  kind: string;
  accountId: string | null;
  chatId?: string;
};

export function compatibilityRequestExpired(
  request: ScopedRequest,
  context: {
    accountId: string | null;
    activeChatId: string | null;
    chatExists: boolean;
    messageExists: boolean;
    memberExists: boolean;
    profileOpen: boolean;
  },
): boolean {
  if (context.accountId !== request.accountId) return true;
  if (request.chatId && (context.activeChatId !== request.chatId || !context.chatExists)) return true;
  if ((request.kind === "message-actions" || request.kind === "message") && !context.messageExists)
    return true;
  if (request.kind === "member-profile" && !context.memberExists) return true;
  return request.kind === "profile" && !context.profileOpen;
}

export function resolveMemberProfileChat(
  groupChat: Chat | undefined,
  memberId: string | undefined,
  directChat: Chat | undefined,
): Chat | null {
  if (!memberId) return null;
  const member = groupChat?.members?.find((entry) => entry.id === memberId);
  if (!member) return null;
  if (directChat?.id === memberId && directChat.type === "friend") return directChat;
  return member
    ? {
        id: member.id,
        type: "friend",
        name: member.name,
        avatar: member.avatar,
        avatarUrl: member.avatarUrl,
        color: member.color,
        unread: 0,
        status: "",
      }
    : null;
}
