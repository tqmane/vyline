import { memberDisplayName } from "./store";
import type { Chat, Message } from "./store-types";

/** The same known readers and first-read times for every presentation. */
export function messageReaders(message: Message, chat: Chat, streamerMode: boolean) {
  if (chat.type !== "group") return [];
  return [...new Set([...(message.readBy ?? []), ...Object.keys(message.readByAt ?? {})])]
    .map((id) => ({
      id,
      readAt: message.readByAt?.[id],
      name: memberDisplayName(
        chat.members?.find((member) => member.id === id)?.name ?? id,
        streamerMode,
      ),
    }))
    .sort((a, b) => (a.readAt ?? Number.MAX_SAFE_INTEGER) - (b.readAt ?? Number.MAX_SAFE_INTEGER));
}
