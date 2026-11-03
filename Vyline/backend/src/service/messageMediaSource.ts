import {
  getStoredMessagesByIds,
  isMessageDeletedLocally,
  type StoredMessage,
} from "../storage/chatStore.js";

/** Use only a received row/snapshot from this account and chat, never an UNSENT placeholder. */
export async function loadMessageMediaSource(
  accountId: string,
  chatMid: string,
  messageId: string,
): Promise<StoredMessage | undefined> {
  let deleted = false;
  let message: StoredMessage | undefined;
  try {
    deleted = await isMessageDeletedLocally(accountId, chatMid, messageId);
    if (!deleted) message = (await getStoredMessagesByIds(accountId, chatMid, [messageId]))[0];
  } catch {
    return undefined;
  }
  if (deleted) throw new Error("message deleted locally");
  if (
    !message ||
    (!message.messageState?.startsWith("revoked") &&
      !/^(?:UNSENT|UNSEND)$/.test(message.contentType))
  )
    return message;
  const snapshot = message.revokedSnapshot;
  if (
    !snapshot ||
    snapshot.id !== messageId ||
    !snapshot.contentType ||
    /^(?:UNSENT|UNSEND)$/.test(snapshot.contentType) ||
    ("chatMid" in snapshot && snapshot.chatMid !== chatMid)
  )
    throw new Error("saved revoked media is unavailable");
  return {
    ...message,
    ...snapshot,
    id: messageId,
    chatMid,
    contentMetadata: snapshot.contentMetadata ?? null,
  };
}
