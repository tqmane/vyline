import type { Message } from "@/lib/store-types";

type GroupableMessage = Pick<
  Message,
  "authorId" | "createdAt" | "kind" | "replyToId" | "messageState" | "postNotification"
>;

/** A new speaker, reply or event begins a new visual run. No protocol state is inferred. */
export function sameMessageRun(
  left: GroupableMessage | undefined,
  right: GroupableMessage | undefined,
): boolean {
  if (!left || !right || left.authorId !== right.authorId) return false;
  if (
    left.kind === "system" ||
    right.kind === "system" ||
    left.kind === "call" ||
    right.kind === "call"
  )
    return false;
  if (left.postNotification || right.postNotification || right.replyToId) return false;
  if (left.messageState.startsWith("revoked") || right.messageState.startsWith("revoked"))
    return false;
  const gap = right.createdAt - left.createdAt;
  return (
    gap >= 0 &&
    gap <= 5 * 60_000 &&
    new Date(left.createdAt).toDateString() === new Date(right.createdAt).toDateString()
  );
}
