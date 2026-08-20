/**
 * Vyline API token storage.
 *
 * Only SHA-256 token digests are persisted. The bearer token is returned once at
 * creation time and can never be recovered from list/revoke endpoints.
 */
import { mkdirSync } from "node:fs";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes } from "node:crypto";
import { constantTimeEqual } from "../security.js";

const _dir = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.VYLINE_DATA_DIR ?? join(_dir, "..", "..", "data");
const TOKEN_FILE = join(DATA_DIR, "api-tokens.json");
const ALLOWED_SCOPES = new Set(["read", "write"]);

export interface ApiToken {
  id: string;
  tokenPrefix: string;
  name: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt?: string;
}

export interface IssuedApiToken extends ApiToken {
  /** Plaintext bearer secret. Returned once and never persisted. */
  token: string;
}

interface StoredApiToken extends ApiToken {
  tokenHash: string;
}

type LegacyApiToken = Omit<ApiToken, "id" | "tokenPrefix"> & { token: string };

let cache: StoredApiToken[] | null = null;
let saveQueue: Promise<void> = Promise.resolve();

function digest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function publicToken(token: StoredApiToken): ApiToken {
  const { tokenHash: _tokenHash, ...safe } = token;
  return { ...safe, scopes: [...safe.scopes] };
}

function normalizeScopes(scopes: unknown): string[] {
  if (!Array.isArray(scopes)) return ["read", "write"];
  const normalized = [
    ...new Set(scopes.filter((scope): scope is string => ALLOWED_SCOPES.has(scope))),
  ];
  if (normalized.length === 0) throw new TypeError("at least one valid scope is required");
  return normalized;
}

async function load(): Promise<StoredApiToken[]> {
  if (cache) return cache;
  try {
    const raw = await readFile(TOKEN_FILE, "utf8");
    const parsed = JSON.parse(raw) as Array<StoredApiToken | LegacyApiToken>;
    let migrated = false;
    cache = parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      if ("tokenHash" in entry && typeof entry.tokenHash === "string") {
        return [{ ...entry, scopes: normalizeScopes(entry.scopes) }];
      }
      if ("token" in entry && typeof entry.token === "string" && entry.token) {
        migrated = true;
        return [
          {
            id: `tok_${randomBytes(12).toString("hex")}`,
            tokenHash: digest(entry.token),
            tokenPrefix: entry.token.slice(0, 12),
            name: String(entry.name ?? "migrated token").slice(0, 80),
            scopes: normalizeScopes(entry.scopes),
            createdAt: entry.createdAt ?? new Date().toISOString(),
            ...(entry.lastUsedAt ? { lastUsedAt: entry.lastUsedAt } : {}),
          },
        ];
      }
      return [];
    });
    if (migrated) await save(cache);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      cache = [];
    } else {
      throw new Error("API token store is unreadable or invalid", { cause: error });
    }
  }
  return cache;
}

async function save(tokens: StoredApiToken[]): Promise<void> {
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  const serialized = JSON.stringify(tokens, null, 2);
  saveQueue = saveQueue.catch(() => undefined).then(async () => {
    await writeFile(TOKEN_FILE, serialized, { encoding: "utf8", mode: 0o600 });
    await chmod(TOKEN_FILE, 0o600).catch(() => undefined);
  });
  await saveQueue;
  cache = tokens;
}

export async function listTokens(): Promise<ApiToken[]> {
  return (await load()).map(publicToken);
}

export async function createToken(
  name: string,
  scopes: string[] = ["read", "write"],
): Promise<IssuedApiToken> {
  const cleanName = name.trim();
  if (!cleanName || cleanName.length > 80) throw new TypeError("invalid token name");
  const cleanScopes = normalizeScopes(scopes);
  const tokens = await load();
  if (tokens.length >= 256) throw new RangeError("API token limit reached");
  const secret = `vyl_${randomBytes(32).toString("base64url")}`;
  const stored: StoredApiToken = {
    id: `tok_${randomBytes(12).toString("hex")}`,
    tokenHash: digest(secret),
    tokenPrefix: secret.slice(0, 12),
    name: cleanName,
    scopes: cleanScopes,
    createdAt: new Date().toISOString(),
  };
  tokens.push(stored);
  await save(tokens);
  return { ...publicToken(stored), token: secret };
}

export async function validateToken(token: string): Promise<ApiToken | null> {
  if (!token.startsWith("vyl_") || token.length > 128) return null;
  const tokenHash = digest(token);
  const tokens = await load();
  const found = tokens.find((candidate) => constantTimeEqual(candidate.tokenHash, tokenHash));
  if (!found) return null;
  found.lastUsedAt = new Date().toISOString();
  void save(tokens).catch(() => undefined);
  return publicToken(found);
}

export async function revokeToken(id: string): Promise<boolean> {
  if (!/^tok_[a-f0-9]{24}$/.test(id)) return false;
  const tokens = await load();
  const idx = tokens.findIndex((token) => token.id === id);
  if (idx === -1) return false;
  tokens.splice(idx, 1);
  await save(tokens);
  return true;
}
