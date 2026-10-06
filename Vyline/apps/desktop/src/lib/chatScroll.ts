type UnreadMessage = {
  id: string;
  authorId: string;
  read: boolean;
  createdAt: number;
};
import { compareMessagesOldestFirst } from "./messageOrder";

/** Presentation only: this opening boundary must survive automatic read marking. */
export type UnreadBoundary = { count: number; throughId: string | null; messageId: string | null };

export function resolveUnreadBoundary(boundary: UnreadBoundary, messages: readonly UnreadMessage[]): UnreadBoundary {
  if (boundary.messageId || !Number.isSafeInteger(boundary.count) || boundary.count <= 0 || !messages.length) return boundary;
  const ordered = [...messages].sort(compareMessagesOldestFirst);
  const throughId = boundary.throughId ?? ordered.at(-1)!.id;
  const throughIndex = ordered.findIndex(message => message.id === throughId);
  const before = throughIndex >= 0 ? ordered.slice(0, throughIndex + 1) : ordered.filter(message => {
    try { return BigInt(message.id) <= BigInt(throughId); } catch { return false; }
  });
  const received = before.filter(message => message.authorId !== "me" && !message.id.startsWith("pending_"));
  const messageId = received.length >= boundary.count ? received.at(-boundary.count)!.id : null;
  return messageId || throughId !== boundary.throughId ? { ...boundary, throughId, messageId } : boundary;
}

/** チャット内で最初に表示すべき未読メッセージを返す。 */
export function findFirstUnreadMessage<T extends UnreadMessage>(
  messages: readonly T[],
): T | undefined {
  return messages
    .filter((message) => message.authorId !== "me" && !message.read)
    .sort((left, right) => {
      const byTime = left.createdAt - right.createdAt;
      if (byTime) return byTime;
      try {
        const leftId = BigInt(left.id);
        const rightId = BigInt(right.id);
        return leftId === rightId ? 0 : leftId < rightId ? -1 : 1;
      } catch {
        return left.id.localeCompare(right.id);
      }
    })[0];
}

export type ScrollMetrics = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

/**
 * Fractional pixels and browser zoom can leave a tiny remainder even when the viewport
 * is visually at the bottom. Treat a small configurable gap as bottom.
 */
export function isNearScrollBottom(metrics: ScrollMetrics, thresholdPx = 8): boolean {
  const threshold = Math.max(0, thresholdPx);
  const remaining = Math.max(0, metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop);
  return remaining <= threshold;
}
