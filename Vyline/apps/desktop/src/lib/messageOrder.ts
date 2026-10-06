import type { Message } from "./store-types";

export function compareMessagesOldestFirst(left: Pick<Message, "id" | "createdAt">, right: Pick<Message, "id" | "createdAt">): number {
  const byTime = left.createdAt - right.createdAt;
  if (byTime) return byTime;
  try {
    const leftId = BigInt(left.id);
    const rightId = BigInt(right.id);
    return leftId === rightId ? 0 : leftId < rightId ? -1 : 1;
  } catch {
    return left.id.localeCompare(right.id);
  }
}
