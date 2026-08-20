/**
 * tokenStore.ts
 *
 * authToken とセッションメタのローカル保存。
 * 保存先: <backend>/data/tokens.json
 *
 * 構造:
 * {
 *   "accountId": {
 *     "authToken": "...",
 *     "storageFile": "<backend>/data/storage-accountId.json",
 *     "savedAt": "ISO8601",
 *     "mid": "u...",
 *     "displayName": "...",
 *     "picturePath": "...",
 *     "statusMessage": "..."
 *   }
 * }
 */

import { join, dirname } from "node:path";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { childLogger } from "../logger.js";
import { assertSafeAccountId, isSafeAccountId } from "../security.js";

const log = childLogger("tokenStore");

const _dir = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.VYLINE_DATA_DIR ?? join(_dir, "..", "..", "data");
const TOKENS_FILE = join(DATA_DIR, "tokens.json");
let writeQueue: Promise<void> = Promise.resolve();

export interface TokenEntry {
  authToken: string;
  /** VylineFileStorage のパス */
  storageFile: string;
  savedAt: string;
  mid?: string;
  displayName?: string;
  picturePath?: string;
  statusMessage?: string;
}

export type TokenMap = Record<string, TokenEntry>;

export type SessionMeta = {
  mid?: string;
  displayName?: string;
  picturePath?: string;
  statusMessage?: string;
};

async function ensureDataDir(): Promise<void> {
  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
    log.debug({ dir: DATA_DIR }, "created data dir");
  }
}

async function writeTokens(tokens: TokenMap): Promise<void> {
  const serialized = JSON.stringify(tokens, null, 2);
  writeQueue = writeQueue.catch(() => undefined).then(async () => {
    await writeFile(TOKENS_FILE, serialized, { encoding: "utf-8", mode: 0o600 });
    await chmod(TOKENS_FILE, 0o600).catch(() => undefined);
  });
  await writeQueue;
}

export async function loadTokens(): Promise<TokenMap> {
  await ensureDataDir();
  if (!existsSync(TOKENS_FILE)) return {};
  try {
    const raw = await readFile(TOKENS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as TokenMap;
    // 空トークンのゴミを除外
    const cleaned: TokenMap = {};
    for (const [id, entry] of Object.entries(parsed)) {
      if (isSafeAccountId(id) && entry?.authToken && typeof entry.authToken === "string") {
        // Never trust a persisted storageFile path. Rebuild it inside DATA_DIR.
        cleaned[id] = { ...entry, storageFile: join(DATA_DIR, `storage-${id}.json`) };
      }
    }
    return cleaned;
  } catch (err) {
    log.error({ err }, "failed to parse token store");
    throw new Error("token store is unreadable or invalid", { cause: err });
  }
}

function normalizeAuthToken(authToken: unknown): string | null {
  if (typeof authToken === "string" && authToken.trim()) {
    const value = authToken.trim();
    return value.length <= 8192 && !/[\r\n\0]/.test(value) ? value : null;
  }
  if (authToken && typeof authToken === "object") {
    const obj = authToken as Record<string, unknown>;
    const access =
      (typeof obj.accessToken === "string" && obj.accessToken) ||
      (typeof obj.authToken === "string" && obj.authToken) ||
      (typeof obj.token === "string" && obj.token);
    if (access) {
      const value = access.trim();
      return value.length <= 8192 && !/[\r\n\0]/.test(value) ? value : null;
    }
  }
  return null;
}

export async function saveToken(
  accountId: string,
  authToken: unknown,
  meta?: SessionMeta,
): Promise<void> {
  assertSafeAccountId(accountId);
  const token = normalizeAuthToken(authToken);
  if (!token) {
    log.warn({ accountId }, "skip token save — empty authToken");
    return;
  }

  await ensureDataDir();
  const tokens = await loadTokens();
  const existing = tokens[accountId];
  const entry: TokenEntry = {
    authToken: token,
    storageFile: existing?.storageFile ?? join(DATA_DIR, `storage-${accountId}.json`),
    savedAt: new Date().toISOString(),
  };
  const mid = meta?.mid ?? existing?.mid;
  const displayName = meta?.displayName ?? existing?.displayName;
  const picturePath = meta?.picturePath ?? existing?.picturePath;
  const statusMessage = meta?.statusMessage ?? existing?.statusMessage;
  if (mid) entry.mid = mid;
  if (displayName) entry.displayName = displayName;
  if (picturePath) entry.picturePath = picturePath;
  if (statusMessage) entry.statusMessage = statusMessage;
  tokens[accountId] = entry;

  await writeTokens(tokens);
  log.info({ accountId, displayName: entry.displayName, mid: entry.mid }, "token saved");
}

export async function updateSessionMeta(accountId: string, meta: SessionMeta): Promise<void> {
  assertSafeAccountId(accountId);
  const tokens = await loadTokens();
  const existing = tokens[accountId];
  if (!existing) return;
  if (meta.mid != null) existing.mid = meta.mid;
  if (meta.displayName != null) existing.displayName = meta.displayName;
  if (meta.picturePath != null) existing.picturePath = meta.picturePath;
  if (meta.statusMessage != null) existing.statusMessage = meta.statusMessage;
  existing.savedAt = new Date().toISOString();
  tokens[accountId] = existing;
  await writeTokens(tokens);
}

export async function deleteToken(accountId: string): Promise<void> {
  assertSafeAccountId(accountId);
  const tokens = await loadTokens();
  delete tokens[accountId];
  await writeTokens(tokens);
  log.info({ accountId }, "token deleted");
}

export async function getToken(accountId: string): Promise<TokenEntry | undefined> {
  assertSafeAccountId(accountId);
  const tokens = await loadTokens();
  return tokens[accountId];
}

/** ログイン画面用のセッション一覧 */
export async function listSavedSessions(): Promise<
  Array<{
    accountId: string;
    savedAt: string;
    mid?: string;
    displayName?: string;
    picturePath?: string;
    statusMessage?: string;
    hasToken: boolean;
  }>
> {
  const tokens = await loadTokens();
  return Object.entries(tokens)
    .map(([accountId, entry]) => {
      const row: {
        accountId: string;
        savedAt: string;
        mid?: string;
        displayName?: string;
        picturePath?: string;
        statusMessage?: string;
        hasToken: boolean;
      } = {
        accountId,
        savedAt: entry.savedAt,
        hasToken: Boolean(entry.authToken),
      };
      if (entry.mid) row.mid = entry.mid;
      if (entry.displayName) row.displayName = entry.displayName;
      if (entry.picturePath) row.picturePath = entry.picturePath;
      if (entry.statusMessage) row.statusMessage = entry.statusMessage;
      return row;
    })
    .sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
}
