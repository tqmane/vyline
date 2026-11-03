import type { Database } from "bun:sqlite";

export const MESSAGE_SEARCH_PAGE_SIZE = 100;
export type MessageSearchInput = { query: string; regex?: boolean; cursor?: string };
export type MessageSearchHit = { id: string; text: string; createdTime: number; highlight: string };
export type MessageSearchPage = {
  hits: MessageSearchHit[];
  nextCursor: string | null;
  limit: number;
};
export type MessageSearchDirection = "around" | "before" | "after";
type Row = { id: string; text: string | null; created_time: number };
type Cursor = { id: string; time: number };

const idWeight = "CASE WHEN id NOT GLOB '*[^0-9]*' THEN length(id) ELSE 0 END";
const key = `(created_time, ${idWeight}, id)`;
const order = `created_time DESC, ${idWeight} DESC, id DESC`;

export class MessageSearchError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: 400 | 404 | 408 | 429 | 500,
  ) {
    super(message);
  }
}

function cursorValues(cursor: Cursor): [number, number, string] {
  return [cursor.time, /^\d+$/.test(cursor.id) ? cursor.id.length : 0, cursor.id];
}

export function validateMessageSearch(input: MessageSearchInput): Cursor | null {
  if (!input.query.trim() || input.query.length > 512)
    throw new MessageSearchError("検索語は1〜512文字で入力してください", "INVALID_QUERY", 400);
  if (!input.cursor) return null;
  try {
    if (input.cursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(input.cursor)) throw new Error();
    const value = JSON.parse(Buffer.from(input.cursor, "base64url").toString()) as Cursor;
    if (
      !Number.isSafeInteger(value.time) ||
      typeof value.id !== "string" ||
      !value.id ||
      value.id.length > 512
    )
      throw new Error();
    return value;
  } catch {
    throw new MessageSearchError(
      "検索ページが不正です。検索し直してください",
      "INVALID_CURSOR",
      400,
    );
  }
}

/** Runs only in the disposable worker: a pathological RegExp cannot block Hono. */
export function searchMessageRows(
  db: Database,
  chatMid: string,
  input: MessageSearchInput,
): MessageSearchPage {
  let cursor = validateMessageSearch(input);
  let expression: RegExp | undefined;
  if (input.regex) {
    try {
      expression = new RegExp(input.query, "iu");
    } catch {
      throw new MessageSearchError("正規表現が不正です", "INVALID_QUERY", 400);
    }
  }
  const query = input.query.toLowerCase();
  const hits: MessageSearchHit[] = [];
  // shortcut: scan the local chat in bounded batches; add FTS when measured latency warrants it.
  while (hits.length <= MESSAGE_SEARCH_PAGE_SIZE) {
    const rows = db
      .query(`SELECT id, text, created_time FROM messages WHERE chat_mid = ?
      ${cursor ? `AND ${key} < (?, ?, ?)` : ""} ORDER BY ${order} LIMIT 256`)
      .all(chatMid, ...(cursor ? cursorValues(cursor) : [])) as Row[];
    if (!rows.length) break;
    for (const row of rows) {
      cursor = { id: row.id, time: row.created_time };
      if (row.text == null) continue;
      const match = expression?.exec(row.text);
      if (expression ? !match : !row.text.toLowerCase().includes(query)) continue;
      hits.push({
        id: row.id,
        text: row.text,
        createdTime: row.created_time,
        highlight: expression ? (match?.[0] ?? "") : input.query,
      });
      if (hits.length > MESSAGE_SEARCH_PAGE_SIZE) break;
    }
  }
  const hasMore = hits.length > MESSAGE_SEARCH_PAGE_SIZE;
  hits.length = Math.min(hits.length, MESSAGE_SEARCH_PAGE_SIZE);
  const last = hits.at(-1);
  return {
    hits,
    limit: MESSAGE_SEARCH_PAGE_SIZE,
    nextCursor:
      hasMore && last
        ? Buffer.from(JSON.stringify({ id: last.id, time: last.createdTime })).toString("base64url")
        : null,
  };
}

export function messageContextIds(
  db: Database,
  chatMid: string,
  messageId: string,
  direction: MessageSearchDirection,
) {
  const anchor = db
    .query("SELECT id, created_time FROM messages WHERE chat_mid = ? AND id = ?")
    .get(chatMid, messageId) as Row | null;
  if (!anchor)
    throw new MessageSearchError("メッセージはローカル履歴にありません", "NOT_FOUND", 404);
  const beforeLimit = direction === "after" ? 0 : direction === "before" ? 80 : 40;
  const afterLimit = direction === "before" ? 0 : direction === "after" ? 80 : 40;
  const before = db
    .query(`SELECT id FROM messages WHERE chat_mid = ? AND ${key} < (?, ?, ?)
    ORDER BY ${order} LIMIT ?`)
    .all(
      chatMid,
      ...cursorValues({ id: anchor.id, time: anchor.created_time }),
      beforeLimit + 1,
    ) as Array<{ id: string }>;
  const after = db
    .query(`SELECT id FROM messages WHERE chat_mid = ? AND ${key} > (?, ?, ?)
    ORDER BY created_time ASC, ${idWeight} ASC, id ASC LIMIT ?`)
    .all(
      chatMid,
      ...cursorValues({ id: anchor.id, time: anchor.created_time }),
      afterLimit + 1,
    ) as Array<{ id: string }>;
  return {
    ids: [...before.slice(0, beforeLimit).reverse(), anchor, ...after.slice(0, afterLimit)].map(
      (row) => row.id,
    ),
    hasOlder: before.length > beforeLimit,
    hasNewer: after.length > afterLimit,
  };
}
