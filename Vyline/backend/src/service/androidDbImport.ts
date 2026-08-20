/**
 * Imports the uncompressed Android LINE `naver_line` SQLite database produced by
 * PrtivateLEIN/LEINs. The source database is never attached to Vyline's own data
 * and is opened read-only with a fixed set of queries.
 */

import { Database } from "bun:sqlite";
import type { MessageContentMeta } from "@vyline/types";
import { childLogger } from "../logger.js";
import {
  importChatDb,
  type StoredChat,
  type StoredMessage,
} from "../storage/chatStore.js";

const log = childLogger("android-db-import");
const LINE_MID = /^[ucr][0-9a-f]{32}$/i;
const SERVER_MESSAGE_ID = /^\d{1,30}$/;

const DEFAULT_MAX_CHATS = 50_000;
const DEFAULT_MAX_MESSAGES = 250_000;
const HARD_MAX_CHATS = 100_000;
const HARD_MAX_MESSAGES = 1_000_000;

type SqlValue = string | number | bigint | Uint8Array | null;
type SqlRow = Record<string, SqlValue>;

export interface AndroidDbImportLimits {
  maxChats?: number;
  maxMessages?: number;
}

export interface AndroidDbImportData {
  meta: { boxOrder: string[]; chatsSyncedAt: string };
  chats: Record<string, StoredChat>;
  messages: Record<string, Record<string, StoredMessage>>;
  sourceChats: number;
  sourceMessages: number;
  skippedChats: number;
  skippedMessages: number;
  /** LEINs ZIP path suffix (`chatMid/local chat_history.id`) to Vyline cache key. */
  mediaRefs: Record<string, { chatMid: string; messageId: string }>;
}

export interface AndroidDbImportResult {
  importedChats: number;
  importedMessages: number;
  skippedChats: number;
  skippedMessages: number;
  sourceChats: number;
  sourceMessages: number;
}

function boundedInteger(value: number | undefined, fallback: number, hardMax: number): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(Math.trunc(value), hardMax));
}

function asString(value: SqlValue | undefined, max = 1_048_576): string {
  if (value == null || value instanceof Uint8Array) return "";
  return String(value).slice(0, max);
}

function asNullableString(value: SqlValue | undefined, max = 1_048_576): string | null {
  if (value == null || value instanceof Uint8Array) return null;
  return String(value).slice(0, max);
}

function asFiniteInteger(value: SqlValue | undefined, fallback = 0): number {
  if (value == null || value instanceof Uint8Array) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function parseAndroidTime(value: SqlValue | undefined): number {
  if (value == null || value instanceof Uint8Array) return 0;
  const raw = String(value).trim();
  if (!raw) return 0;
  const n = Number(raw);
  if (Number.isFinite(n)) {
    // Old Android databases can store seconds, while current ones use milliseconds.
    return n > 0 && n < 10_000_000_000 ? Math.trunc(n * 1_000) : Math.trunc(n);
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function detectChatKind(mid: string): StoredChat["kind"] {
  if (mid.startsWith("c")) return "group";
  if (mid.startsWith("r")) return "room";
  if (mid.startsWith("u")) return "direct";
  return "unknown";
}

function parseContentMetadata(value: SqlValue | undefined): MessageContentMeta | null {
  const raw = asString(value, 131_072).trim();
  if (!raw) return null;
  const out: MessageContentMeta = {};
  // Android LINE stores metadata as alternating TAB-delimited key/value fields.
  const fields = raw.split("\t");
  for (let index = 0, count = 0; index + 1 < fields.length && count < 128; index += 2) {
    const key = fields[index] ?? "";
    const item = fields[index + 1] ?? "";
    if (!/^[A-Za-z0-9_:-]{1,128}$/.test(key)) continue;
    out[key] = item.slice(0, 131_072);
    count++;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function tableColumns(db: Database, table: "chat" | "chat_history"): Set<string> {
  const rows = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name?: unknown }>;
  return new Set(rows.map((row) => String(row.name ?? "")));
}

function requireColumns(table: string, actual: Set<string>, required: string[]): void {
  const missing = required.filter((column) => !actual.has(column));
  if (missing.length > 0) {
    throw new Error(`unsupported Android LINE database: ${table} is missing required columns`);
  }
}

function selectColumn(actual: Set<string>, column: string): string {
  // Column names passed here are constants defined in this module, never input.
  return actual.has(column) ? `"${column}"` : `NULL AS "${column}"`;
}

function cappedCount(db: Database, table: "chat" | "chat_history", max: number): number {
  const row = db
    .query(`SELECT COUNT(*) AS count FROM (SELECT 1 FROM ${table} LIMIT ?)`)
    .get(max + 1) as { count?: number | bigint } | null;
  const count = Number(row?.count ?? 0);
  if (!Number.isSafeInteger(count) || count > max) {
    throw new Error(`Android LINE database exceeds the ${table} import limit`);
  }
  return count;
}

function assertDatabaseIntegrity(db: Database): void {
  const row = db.query("PRAGMA quick_check(1)").get() as Record<string, unknown> | null;
  const result = row ? String(Object.values(row)[0] ?? "") : "";
  if (result !== "ok") throw new Error("Android LINE database failed integrity validation");
}

function deriveContentType(row: SqlRow, metadata: MessageContentMeta | null): string {
  const androidType = asFiniteInteger(row.type, 1);
  if (androidType === 27) return "UNSENT";
  if (androidType === 5 || metadata?.STKID) return "7";
  if (androidType === 4) return "6";
  if (androidType === 13) return "CHATEVENT";
  if (metadata?.FLEX_JSON) return "22";
  if (metadata?.MARKUP_JSON || androidType === 8) return "17";
  if (metadata?.FILE_NAME || metadata?.contentType === "14") return "14";
  if (metadata?.AUDLEN || metadata?.GC_MEDIA_TYPE === "AUDIO") return "3";
  if (metadata?.contentType && /^(0|1|2|3|6|7|13|14|15|17|22)$/.test(metadata.contentType)) {
    return metadata.contentType;
  }
  if (metadata?.OID || metadata?.SID || metadata?.IS_SEND_ORIGINAL_IMAGE) {
    return metadata?.DURATION ? "2" : "1";
  }
  const encrypted = row.chunks instanceof Uint8Array && row.chunks.byteLength > 0;
  const hasPlaintext = asNullableString(row.content)?.length;
  if ((encrypted || androidType === 33) && !hasPlaintext) return "E2EE_UNAVAILABLE";
  return "0";
}

export function readAndroidLineDatabase(
  path: string,
  myMid: string,
  limits: AndroidDbImportLimits = {},
): AndroidDbImportData {
  if (!LINE_MID.test(myMid)) throw new Error("current LINE profile MID is unavailable");
  const maxChats = boundedInteger(limits.maxChats, DEFAULT_MAX_CHATS, HARD_MAX_CHATS);
  const maxMessages = boundedInteger(
    limits.maxMessages,
    DEFAULT_MAX_MESSAGES,
    HARD_MAX_MESSAGES,
  );

  const db = new Database(path, {
    readonly: true,
    create: false,
    readwrite: false,
    strict: true,
    safeIntegers: true,
  });
  try {
    db.exec("PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;");
    assertDatabaseIntegrity(db);

    const chatColumns = tableColumns(db, "chat");
    const messageColumns = tableColumns(db, "chat_history");
    requireColumns("chat", chatColumns, ["chat_id"]);
    requireColumns("chat_history", messageColumns, [
      "id",
      "server_id",
      "chat_id",
      "from_mid",
      "created_time",
    ]);

    const sourceChats = cappedCount(db, "chat", maxChats);
    const sourceMessages = cappedCount(db, "chat_history", maxMessages);
    const importedAt = new Date().toISOString();
    const chats: Record<string, StoredChat> = {};
    const messages: Record<string, Record<string, StoredMessage>> = {};
    const mediaRefs: AndroidDbImportData["mediaRefs"] = {};
    let skippedChats = 0;
    let skippedMessages = 0;

    const chatFields = [
      "chat_id",
      "chat_name",
      "last_message",
      "last_created_time",
      "message_count",
      "read_message_count",
    ];
    const chatSql = `SELECT ${chatFields
      .map((column) => selectColumn(chatColumns, column))
      .join(", ")} FROM chat LIMIT ?`;
    for (const row of db.query(chatSql).iterate(maxChats) as IterableIterator<SqlRow>) {
      const mid = asString(row.chat_id, 64).trim();
      if (!LINE_MID.test(mid)) {
        skippedChats++;
        continue;
      }
      const messageCount = Math.max(0, asFiniteInteger(row.message_count));
      const readCount = Math.max(0, asFiniteInteger(row.read_message_count));
      chats[mid] = {
        mid,
        name: asString(row.chat_name, 512).trim() || mid,
        kind: detectChatKind(mid),
        hasMessages: messageCount > 0,
        lastMessageTime: parseAndroidTime(row.last_created_time),
        lastMessagePreview: asString(row.last_message, 2_048),
        unreadCount: Math.min(Math.max(messageCount - readCount, 0), 1_000_000),
        updatedAt: importedAt,
      };
    }

    const messageFields = [
      "id",
      "server_id",
      "type",
      "chat_id",
      "from_mid",
      "content",
      "created_time",
      "read_count",
      "parameter",
      "chunks",
    ];
    const messageSql = `SELECT ${messageFields
      .map((column) => selectColumn(messageColumns, column))
      .join(", ")} FROM chat_history ORDER BY created_time ASC, id ASC LIMIT ?`;
    for (const row of db.query(messageSql).iterate(maxMessages) as IterableIterator<SqlRow>) {
      const id = asString(row.server_id, 64).trim();
      const chatMid = asString(row.chat_id, 64).trim();
      const rawFrom = asString(row.from_mid, 64).trim();
      if (!SERVER_MESSAGE_ID.test(id) || !LINE_MID.test(chatMid)) {
        skippedMessages++;
        continue;
      }
      // Android system/call/event rows legitimately have no sender MID.
      const from = LINE_MID.test(rawFrom) ? rawFrom : chatMid;

      const metadata = parseContentMetadata(row.parameter);
      const createdTime = parseAndroidTime(row.created_time);
      const readCount = Math.max(0, asFiniteInteger(row.read_count));
      const isMyMessage = from === myMid;
      const contentType = deriveContentType(row, metadata);
      const stored: StoredMessage = {
        id,
        chatMid,
        from,
        to: isMyMessage ? chatMid : myMid,
        text: contentType === "UNSENT" ? null : asNullableString(row.content),
        contentType,
        createdTime,
        isMyMessage,
        contentMetadata: metadata,
        readCount,
        seen: isMyMessage && readCount > 0,
        savedAt: importedAt,
      };
      const relatedMessageId = metadata?.message_relation_server_message_id;
      if (typeof relatedMessageId === "string" && SERVER_MESSAGE_ID.test(relatedMessageId)) {
        stored.relatedMessageId = relatedMessageId;
      }
      (messages[chatMid] ??= {})[id] = stored;
      const localId = asString(row.id, 32);
      if (/^\d{1,20}$/.test(localId)) mediaRefs[`${chatMid}/${localId}`] = { chatMid, messageId: id };

      const chat =
        chats[chatMid] ??
        (chats[chatMid] = {
          mid: chatMid,
          name: chatMid,
          kind: detectChatKind(chatMid),
          hasMessages: true,
          updatedAt: importedAt,
        });
      chat.hasMessages = true;
      if (!chat.lastMessageTime || createdTime >= chat.lastMessageTime) {
        chat.lastMessageTime = createdTime;
        chat.lastMessageId = id;
        const preview = stored.text?.slice(0, 2_048);
        if (preview) chat.lastMessagePreview = preview;
      }
    }

    const boxOrder = Object.values(chats)
      .sort((a, b) => (b.lastMessageTime ?? 0) - (a.lastMessageTime ?? 0))
      .map((chat) => chat.mid);
    return {
      meta: { boxOrder, chatsSyncedAt: importedAt },
      chats,
      messages,
      sourceChats,
      sourceMessages,
      skippedChats,
      skippedMessages,
      mediaRefs,
    };
  } finally {
    db.close(false);
  }
}

export async function importAndroidLineDatabase(
  accountId: string,
  path: string,
  myMid: string,
): Promise<AndroidDbImportResult> {
  const data = readAndroidLineDatabase(path, myMid, {
    maxChats: Number(process.env.VYLINE_ANDROID_DB_MAX_CHATS ?? DEFAULT_MAX_CHATS),
    maxMessages: Number(process.env.VYLINE_ANDROID_DB_MAX_MESSAGES ?? DEFAULT_MAX_MESSAGES),
  });
  const imported = await importChatDb(accountId, data);
  log.info(
    {
      accountId,
      chats: imported.chats,
      messages: imported.messages,
      skippedChats: data.skippedChats,
      skippedMessages: data.skippedMessages,
    },
    "Android LINE database imported",
  );
  return {
    importedChats: imported.chats,
    importedMessages: imported.messages,
    skippedChats: data.skippedChats,
    skippedMessages: data.skippedMessages,
    sourceChats: data.sourceChats,
    sourceMessages: data.sourceMessages,
  };
}
