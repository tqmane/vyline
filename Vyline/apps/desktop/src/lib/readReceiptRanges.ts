export type MemberReadRange = {
  mid: string;
  startExclusive: string;
  endInclusive: string;
  readAt?: number;
};

export type MemberReadWatermark = {
  mid: string;
  upTo: string;
};

function messageId(value: string | number | bigint | undefined): bigint | null {
  if (value == null || value === "") return null;
  try {
    return BigInt(String(value));
  } catch {
    return null;
  }
}

function readAt(value: unknown): number | undefined {
  const timestamp = Number(value);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) return undefined;
  return timestamp;
}

export function mergeMemberReadRanges(
  previous: readonly MemberReadRange[] | undefined,
  incoming: readonly MemberReadRange[] | undefined,
): MemberReadRange[] {
  const byMid = new Map<
    string,
    Array<{ startExclusive: bigint; endInclusive: bigint; readAt?: number }>
  >();
  for (const range of [...(previous ?? []), ...(incoming ?? [])]) {
    const mid = range.mid.trim();
    const startExclusive = messageId(range.startExclusive);
    const endInclusive = messageId(range.endInclusive);
    if (!mid || startExclusive == null || endInclusive == null || endInclusive <= startExclusive) {
      continue;
    }
    const list = byMid.get(mid) ?? [];
    const rangeReadAt = readAt(range.readAt);
    list.push({
      startExclusive,
      endInclusive,
      ...(rangeReadAt != null ? { readAt: rangeReadAt } : {}),
    });
    byMid.set(mid, list);
  }

  const result: MemberReadRange[] = [];
  for (const [mid, ranges] of byMid) {
    const boundaries = [
      ...new Set(ranges.flatMap((range) => [range.startExclusive, range.endInclusive])),
    ].sort((a, b) => (a === b ? 0 : a < b ? -1 : 1));
    const merged: Array<{ startExclusive: bigint; endInclusive: bigint; readAt?: number }> = [];
    for (let index = 0; index + 1 < boundaries.length; index++) {
      const startExclusive = boundaries[index]!;
      const endInclusive = boundaries[index + 1]!;
      const covering = ranges.filter(
        (range) => range.startExclusive <= startExclusive && range.endInclusive >= endInclusive,
      );
      if (covering.length === 0) continue;
      const knownTimes = covering.flatMap((range) => (range.readAt != null ? [range.readAt] : []));
      const rangeReadAt = knownTimes.length > 0 ? Math.min(...knownTimes) : undefined;
      const last = merged[merged.length - 1];
      if (last && last.endInclusive === startExclusive && last.readAt === rangeReadAt) {
        last.endInclusive = endInclusive;
      } else {
        merged.push({
          startExclusive,
          endInclusive,
          ...(rangeReadAt != null ? { readAt: rangeReadAt } : {}),
        });
      }
    }
    for (const range of merged) {
      result.push({
        mid,
        startExclusive: String(range.startExclusive),
        endInclusive: String(range.endInclusive),
        ...(range.readAt != null ? { readAt: range.readAt } : {}),
      });
    }
  }
  return result;
}

/**
 * メンバーごとの既読到達点。既読は巻き戻らないため、複数レンジは
 * 最小 start（＝参加位置）と最大 end（＝既読ウォーターマーク）に畳む。
 */
function memberReadSpans(
  ranges: readonly MemberReadRange[] | undefined,
  excludeMid?: string,
): Map<string, { floor: bigint; ceiling: bigint }> {
  const spans = new Map<string, { floor: bigint; ceiling: bigint }>();
  for (const range of ranges ?? []) {
    const mid = range.mid?.trim();
    if (!mid || (excludeMid && mid === excludeMid)) continue;
    const startExclusive = messageId(range.startExclusive);
    const endInclusive = messageId(range.endInclusive);
    if (startExclusive == null || endInclusive == null) continue;
    const span = spans.get(mid);
    if (!span) {
      spans.set(mid, { floor: startExclusive, ceiling: endInclusive });
      continue;
    }
    if (startExclusive < span.floor) span.floor = startExclusive;
    if (endInclusive > span.ceiling) span.ceiling = endInclusive;
  }
  return spans;
}

export function readersForMessageId(
  ranges: readonly MemberReadRange[] | undefined,
  id: string | number | bigint,
  excludeMid?: string,
): string[] {
  const target = messageId(id);
  if (target == null) return [];
  const readers: string[] = [];
  for (const [mid, span] of memberReadSpans(ranges, excludeMid)) {
    if (span.floor < target && target <= span.ceiling) readers.push(mid);
  }
  return readers;
}

export function readTimesForMessageId(
  ranges: readonly MemberReadRange[] | undefined,
  id: string | number | bigint,
  excludeMid?: string,
  notBefore?: number,
): Record<string, number> {
  const target = messageId(id);
  if (target == null) return {};
  const result: Record<string, number> = {};
  for (const range of ranges ?? []) {
    if (excludeMid && range.mid === excludeMid) continue;
    const startExclusive = messageId(range.startExclusive);
    const endInclusive = messageId(range.endInclusive);
    const rangeReadAt = readAt(range.readAt);
    if (
      !range.mid ||
      startExclusive == null ||
      endInclusive == null ||
      rangeReadAt == null ||
      !(startExclusive < target && target <= endInclusive) ||
      (notBefore != null && rangeReadAt < notBefore)
    ) {
      continue;
    }
    const known = result[range.mid];
    if (known == null || rangeReadAt < known) result[range.mid] = rangeReadAt;
  }
  return result;
}

export function mergeReadByAt(
  previous: Readonly<Record<string, number>> | undefined,
  incoming: Readonly<Record<string, number>> | undefined,
  excludeMid?: string,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const source of [previous, incoming]) {
    for (const [mid, rawReadAt] of Object.entries(source ?? {})) {
      if (!mid || (excludeMid && mid === excludeMid)) continue;
      const timestamp = readAt(rawReadAt);
      if (timestamp == null) continue;
      const known = result[mid];
      if (known == null || timestamp < known) result[mid] = timestamp;
    }
  }
  return result;
}

export function mergeMemberReadWatermarks(
  previous: readonly MemberReadWatermark[] | undefined,
  incoming: readonly MemberReadWatermark[] | undefined,
): MemberReadWatermark[] {
  const byMid = new Map<string, bigint>();
  for (const watermark of [...(previous ?? []), ...(incoming ?? [])]) {
    const mid = watermark.mid.trim();
    const upTo = messageId(watermark.upTo);
    if (!mid || upTo == null) continue;
    const current = byMid.get(mid);
    if (current == null || upTo > current) byMid.set(mid, upTo);
  }
  return [...byMid].map(([mid, upTo]) => ({ mid, upTo: String(upTo) }));
}

export function maxMessageId(
  previous: string | undefined,
  incoming: string | undefined,
): string | undefined {
  const previousId = messageId(previous);
  const incomingId = messageId(incoming);
  if (previousId == null) return incomingId == null ? undefined : String(incomingId);
  if (incomingId == null) return String(previousId);
  return String(previousId > incomingId ? previousId : incomingId);
}
