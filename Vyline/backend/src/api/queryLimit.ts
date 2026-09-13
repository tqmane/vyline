/** HTTP list limits must remain finite integer counts for both SQLite and Thrift. */
export function parseQueryLimit(raw: string | undefined, fallback: number, max: number): number {
  const value = raw?.trim() ? Number(raw) : Number.NaN;
  return Number.isFinite(value) ? Math.min(max, Math.max(1, Math.floor(value))) : fallback;
}
