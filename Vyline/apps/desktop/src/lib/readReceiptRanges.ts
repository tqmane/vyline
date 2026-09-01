export type MemberReadRange = {
  mid: string;
  startExclusive: string;
  endInclusive: string;
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

export function mergeMemberReadRanges(
  previous: readonly MemberReadRange[] | undefined,
  incoming: readonly MemberReadRange[] | undefined,
): MemberReadRange[] {
  const byMid = new Map<string, Array<{ startExclusive: bigint; endInclusive: bigint }>>();
  for (const range of [...(previous ?? []), ...(incoming ?? [])]) {
    const mid = range.mid.trim();
    const startExclusive = messageId(range.startExclusive);
    const endInclusive = messageId(range.endInclusive);
    if (!mid || startExclusive == null || endInclusive == null || endInclusive <= startExclusive) {
      continue;
    }
    const list = byMid.get(mid) ?? [];
    list.push({ startExclusive, endInclusive });
    byMid.set(mid, list);
  }

  const result: MemberReadRange[] = [];
  for (const [mid, ranges] of byMid) {
    ranges.sort((a, b) => {
      if (a.startExclusive !== b.startExclusive) {
        return a.startExclusive < b.startExclusive ? -1 : 1;
      }
      return a.endInclusive === b.endInclusive ? 0 : a.endInclusive < b.endInclusive ? -1 : 1;
    });
    const merged: Array<{ startExclusive: bigint; endInclusive: bigint }> = [];
    for (const range of ranges) {
      const last = merged[merged.length - 1];
      if (!last || range.startExclusive > last.endInclusive) {
        merged.push({ ...range });
      } else if (range.endInclusive > last.endInclusive) {
        last.endInclusive = range.endInclusive;
      }
    }
    for (const range of merged) {
      result.push({
        mid,
        startExclusive: String(range.startExclusive),
        endInclusive: String(range.endInclusive),
      });
    }
  }
  return result;
}

export function readersForMessageId(
  ranges: readonly MemberReadRange[] | undefined,
  id: string | number | bigint,
): string[] {
  const target = messageId(id);
  if (target == null) return [];
  const readers = new Set<string>();
  for (const range of ranges ?? []) {
    const startExclusive = messageId(range.startExclusive);
    const endInclusive = messageId(range.endInclusive);
    if (
      range.mid &&
      startExclusive != null &&
      endInclusive != null &&
      startExclusive < target &&
      target <= endInclusive
    ) {
      readers.add(range.mid);
    }
  }
  return [...readers];
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
