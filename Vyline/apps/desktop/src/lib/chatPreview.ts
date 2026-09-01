import type { Chat, Message } from "../types/index.js";

export const ENCRYPTED_CHAT_PREVIEW = "暗号化メッセージ";

export function isUnresolvedChatPreview(value: string | null | undefined): boolean {
  const normalized = value?.trim().toUpperCase();
  return (
    !normalized ||
    normalized === ENCRYPTED_CHAT_PREVIEW ||
    normalized === "E2EE_UNAVAILABLE" ||
    normalized === "UNSENT" ||
    normalized === "UNSEND" ||
    normalized === "(UNSENT)" ||
    normalized === "(UNSEND)" ||
    normalized === "CHATEVENT" ||
    normalized === "NONE" ||
    normalized === "0"
  );
}

export type LastMessageMetadata = {
  lastMessageId?: string;
  lastMessageTime?: number;
  lastMessagePreview?: string;
};

type LastMessageCursor = Pick<LastMessageMetadata, "lastMessageId" | "lastMessageTime">;

function validMessageTime(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function compareNumericMessageIds(left: string | undefined, right: string | undefined) {
  if (!left || !right || !/^\d+$/.test(left) || !/^\d+$/.test(right)) return undefined;
  const normalizedLeft = left.replace(/^0+(?=\d)/, "");
  const normalizedRight = right.replace(/^0+(?=\d)/, "");
  if (normalizedLeft.length !== normalizedRight.length) {
    return normalizedLeft.length > normalizedRight.length ? 1 : -1;
  }
  if (normalizedLeft === normalizedRight) return 0;
  return normalizedLeft > normalizedRight ? 1 : -1;
}

/** Returns 1 when left is newer, -1 when right is newer, 0 when equal, and undefined when unknown. */
export function compareLastMessageCursor(
  left: LastMessageCursor,
  right: LastMessageCursor,
): -1 | 0 | 1 | undefined {
  const leftTime = validMessageTime(left.lastMessageTime);
  const rightTime = validMessageTime(right.lastMessageTime);
  if (leftTime && rightTime && leftTime !== rightTime) return leftTime > rightTime ? 1 : -1;

  const idComparison = compareNumericMessageIds(left.lastMessageId, right.lastMessageId);
  if (idComparison !== undefined && idComparison !== 0) return idComparison;
  if (left.lastMessageId && right.lastMessageId && left.lastMessageId === right.lastMessageId) {
    return 0;
  }
  if (leftTime && rightTime && leftTime === rightTime) return 0;

  if (leftTime && !rightTime && !right.lastMessageId) return 1;
  if (rightTime && !leftTime && !left.lastMessageId) return -1;
  if (left.lastMessageId && !right.lastMessageId && !rightTime) return 1;
  if (right.lastMessageId && !left.lastMessageId && !leftTime) return -1;
  return undefined;
}

export function isSameLastMessage(left: LastMessageCursor, right: LastMessageCursor): boolean {
  if (left.lastMessageId && right.lastMessageId) {
    return left.lastMessageId === right.lastMessageId;
  }
  const leftTime = left.lastMessageTime ?? 0;
  const rightTime = right.lastMessageTime ?? 0;
  return leftTime > 0 && leftTime === rightTime;
}

function copyLastMessageMetadata<T extends LastMessageMetadata>(base: T, source: T): T {
  return {
    ...base,
    lastMessageId: source.lastMessageId,
    lastMessageTime: source.lastMessageTime,
    lastMessagePreview: source.lastMessagePreview,
  };
}

function richerSameMessagePreview(
  previous: string | undefined,
  incoming: string | undefined,
): string | undefined {
  if (previous && isUnresolvedChatPreview(incoming)) return previous;
  if (previous && incoming && previous === `あなた: ${incoming}`) return previous;
  return incoming ?? previous;
}

/**
 * Merge background chat metadata without allowing an older snapshot to replace a
 * locally observed send/receive. Other chat fields still come from the incoming
 * object so profile, unread, and membership updates continue to apply.
 */
export function mergeLatestChatMetadata<T extends LastMessageMetadata>(
  previous: T | undefined,
  incoming: T,
): T {
  if (!previous) return incoming;
  const comparison = compareLastMessageCursor(previous, incoming);
  if (comparison === 1) return copyLastMessageMetadata(incoming, previous);
  if (comparison === -1) return incoming;

  const sameMessage = isSameLastMessage(previous, incoming) || comparison === 0;
  if (!sameMessage) {
    const previousHasCursor = Boolean(
      previous.lastMessageId || validMessageTime(previous.lastMessageTime),
    );
    if (previousHasCursor) return copyLastMessageMetadata(incoming, previous);
  }

  return {
    ...incoming,
    lastMessageId: incoming.lastMessageId ?? previous.lastMessageId,
    lastMessageTime: incoming.lastMessageTime ?? previous.lastMessageTime,
    lastMessagePreview: richerSameMessagePreview(
      previous.lastMessagePreview,
      incoming.lastMessagePreview,
    ),
  };
}

/**
 * A lightweight message-box refresh can only see an E2EE placeholder. Do not let
 * it clobber a preview that was already resolved from chatdb/bootstrap for the
 * exact same last message.
 */
export function mergeResolvedChatPreviews(previous: Chat[], incoming: Chat[]): Chat[] {
  if (previous.length === 0) return incoming;
  const previousByMid = new Map(previous.map((chat) => [chat.mid, chat]));
  return incoming.map((chat) => mergeLatestChatMetadata(previousByMid.get(chat.mid), chat));
}

function bootstrapMessageMatchesChat(chat: Chat, message: Message): boolean {
  if (chat.lastMessageId) return chat.lastMessageId === message.id;
  const chatTime = chat.lastMessageTime ?? 0;
  return chatTime <= 0 || message.createdTime >= chatTime;
}

/**
 * Bootstrap already returns a small newest-first message window for the hottest
 * chats. Reuse the decoded local message as the list preview instead of waiting
 * until the user opens that conversation.
 */
export function hydrateBootstrapChatPreviews(
  chats: Chat[],
  messagesByChat: Record<string, Message[]>,
  toPreview: (message: Message, chat: Chat) => string,
): Chat[] {
  return chats.map((chat) => {
    const latest = messagesByChat[chat.mid]?.[0];
    if (!latest || !bootstrapMessageMatchesChat(chat, latest)) return chat;
    const preview = toPreview(latest, chat).trim();
    if (!preview || isUnresolvedChatPreview(preview)) return chat;
    return { ...chat, lastMessagePreview: preview };
  });
}
