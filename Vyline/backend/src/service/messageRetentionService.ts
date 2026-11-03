import { assertChatUnlocked } from "./lineService.js";
import { deleteLocalRevokedMessage } from "../storage/chatStore.js";

export async function deleteRetainedMessage(accountId: string, chatMid: string, messageId: string): Promise<boolean> {
  await assertChatUnlocked(accountId, chatMid);
  return deleteLocalRevokedMessage(accountId, chatMid, messageId);
}
