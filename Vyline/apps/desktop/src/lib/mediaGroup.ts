import type { Message } from "./store-types.js";

export type ImageMediaGroup = NonNullable<Message["mediaGroup"]>;

function parseInteger(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

export function parseImageMediaGroup(
  meta?: Record<string, unknown> | null,
): ImageMediaGroup | undefined {
  const id = typeof meta?.GID === "string" ? meta.GID.trim() : "";
  const total = parseInteger(meta?.GTOTAL);
  const sequence = parseInteger(meta?.GSEQ);
  if (!id || id === "0" || total == null || total <= 1 || sequence == null) return undefined;
  if (sequence < 1 || sequence > total) return undefined;
  return { id, sequence, total };
}

export function shareImageMediaGroup(left: Message, right: Message): boolean {
  const leftGroup = left.mediaGroup;
  const rightGroup = right.mediaGroup;
  return Boolean(
    left.kind === "image" &&
      right.kind === "image" &&
      left.imageSrc &&
      right.imageSrc &&
      !left.replyToId &&
      !right.replyToId &&
      leftGroup &&
      rightGroup &&
      leftGroup.id === rightGroup.id &&
      leftGroup.total === rightGroup.total &&
      left.authorId === right.authorId &&
      left.chatId === right.chatId,
  );
}

function compareMessagePosition(left: Message, right: Message): number {
  if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt;
  return left.id.localeCompare(right.id);
}

function isOptimisticMedia(message: Message): boolean {
  return (
    message.id.startsWith("pending_") &&
    message.authorId === "me" &&
    (message.kind === "image" || message.kind === "video")
  );
}

/**
 * Match local optimistic media to confirmed LINE messages one-to-one.
 *
 * A single confirmed image must never remove every optimistic image in a batch.
 * For a real image group, sequence/total are preferred; when older servers omit
 * group metadata, chronological one-to-one matching remains available.
 */
export function matchOptimisticMediaMessages(
  optimisticMessages: readonly Message[],
  confirmedMessages: readonly Message[],
  maxTimeDiffMs = 120_000,
): Set<string> {
  const optimistic = optimisticMessages.filter(isOptimisticMedia).sort(compareMessagePosition);
  const confirmed = confirmedMessages
    .filter(
      (message) =>
        !message.id.startsWith("pending_") &&
        message.authorId === "me" &&
        (message.kind === "image" || message.kind === "video"),
    )
    .sort(compareMessagePosition);
  const consumedConfirmedIds = new Set<string>();
  const matchedOptimisticIds = new Set<string>();

  for (const local of optimistic) {
    const matchesBase = (candidate: Message) =>
      !consumedConfirmedIds.has(candidate.id) &&
      candidate.chatId === local.chatId &&
      candidate.authorId === local.authorId &&
      candidate.kind === local.kind &&
      Math.abs(candidate.createdAt - local.createdAt) < maxTimeDiffMs;

    let match: Message | undefined;
    if (local.mediaGroup) {
      match = confirmed.find(
        (candidate) =>
          matchesBase(candidate) &&
          candidate.mediaGroup?.total === local.mediaGroup?.total &&
          candidate.mediaGroup?.sequence === local.mediaGroup?.sequence,
      );
      // Some LINE history responses omit GID metadata. Fall back only to an
      // ungrouped candidate so a different sequence cannot consume this row.
      match ??= confirmed.find((candidate) => matchesBase(candidate) && !candidate.mediaGroup);
    } else {
      match = confirmed.find(matchesBase);
    }

    if (!match) continue;
    consumedConfirmedIds.add(match.id);
    matchedOptimisticIds.add(local.id);
  }

  return matchedOptimisticIds;
}
