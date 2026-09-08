/**
 * Vyline クライアント側キャッシュ — mid → name / icon の即時解決
 * localStorage: vyline-profile-cache:{accountId}
 */

import { looksLikeMid, type ContactInfo } from "./mappers.js";
import type { BootstrapResponse, LineProfile } from "@vyline/types";

type ClientHydration = {
  version: 1;
  accountId: string;
  updatedAt: number;
  profile?: LineProfile | null;
  bootstrap?: Pick<Extract<BootstrapResponse, { ok: true }>, "ok" | "chats" | "messagesByChat">;
  profileUpdatedAt?: number;
  bootstrapUpdatedAt?: number;
};
const hydrationKey = (accountId: string) => `vyline-data-cache:${accountId}`;
const HYDRATION_MAX_AGE = 24 * 60 * 60 * 1000;
const HYDRATION_MAX_BYTES = 2_000_000;

/** Account-scoped, expiring data only. Existing bitmap/font/profile caches remain separate. */
export function vylineClientHydration(accountId: string, now = Date.now()): ClientHydration | null {
  if (!accountId) return null;
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(hydrationKey(accountId));
    if (!raw || raw.length > HYDRATION_MAX_BYTES) return null;
    const value = JSON.parse(raw) as ClientHydration;
    if (value.version !== 1 || value.accountId !== accountId || !Number.isFinite(value.updatedAt) ||
      value.updatedAt > now || now - value.updatedAt > HYDRATION_MAX_AGE) return null;
    if (value.bootstrap && (!Array.isArray(value.bootstrap.chats) ||
      value.bootstrap.chats.some((chat) => !chat || typeof chat.mid !== "string"))) return null;
    if (value.bootstrap && (!value.bootstrap.messagesByChat || Object.values(value.bootstrap.messagesByChat)
      .some((messages) => !Array.isArray(messages) || messages.some((message) => !message || typeof message !== "object")))) return null;
    if (!value.profileUpdatedAt || now - value.profileUpdatedAt > HYDRATION_MAX_AGE) delete value.profile;
    if (!value.bootstrapUpdatedAt || now - value.bootstrapUpdatedAt > HYDRATION_MAX_AGE) delete value.bootstrap;
    return value;
  } catch { return null; }
}

export function vylineClientSaveHydration(accountId: string, patch: Pick<ClientHydration, "profile" | "bootstrap">): void {
  if (!accountId) return;
  try {
    if (typeof localStorage === "undefined") return;
    const previous = vylineClientHydration(accountId);
    const bootstrap = patch.bootstrap ?? previous?.bootstrap;
    const bounded = bootstrap ? {
      ...bootstrap,
      chats: bootstrap.chats?.slice(0, 1000) ?? [],
      messagesByChat: Object.fromEntries(Object.entries(bootstrap.messagesByChat ?? {}).slice(0, 24)
        .map(([id, messages]) => [id, messages.slice(0, 40)])),
    } : undefined;
    const now = Date.now();
    const value: ClientHydration = { ...previous, ...patch, bootstrap: bounded, version: 1, accountId, updatedAt: now,
      profileUpdatedAt: patch.profile !== undefined ? now : previous?.profileUpdatedAt,
      bootstrapUpdatedAt: patch.bootstrap !== undefined ? now : previous?.bootstrapUpdatedAt };
    let raw = JSON.stringify(value);
    if (raw.length > HYDRATION_MAX_BYTES && value.bootstrap) {
      value.bootstrap.messagesByChat = {};
      raw = JSON.stringify(value);
    }
    if (raw.length <= HYDRATION_MAX_BYTES) localStorage.setItem(hydrationKey(accountId), raw);
  } catch { /* An optional cache must not interrupt synchronization in private/quota-limited storage. */ }
}

export function vylineClientClearHydration(accountId: string): void {
  try { localStorage.removeItem(hydrationKey(accountId)); } catch { /* optional storage */ }
}

export type VylineClientProfile = {
  mid: string;
  displayName: string;
  thumbnailUrl?: string;
  statusMessage?: string;
  musicProfile?: string;
  birthday?: string;
  backgroundUrl?: string;
  updatedAt: number;
};

type VylineClientDb = {
  version: 1;
  profiles: Record<string, VylineClientProfile>;
};

function key(accountId: string): string {
  return `vyline-profile-cache:${accountId}`;
}

function empty(): VylineClientDb {
  return { version: 1, profiles: {} };
}

export function vylineClientLoad(accountId: string): VylineClientDb {
  if (!accountId || typeof localStorage === "undefined") return empty();
  try {
    const raw = localStorage.getItem(key(accountId));
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as VylineClientDb;
    if (!parsed?.profiles) return empty();
    return parsed;
  } catch {
    return empty();
  }
}

export function vylineClientSave(accountId: string, db: VylineClientDb): void {
  if (!accountId || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key(accountId), JSON.stringify(db));
  } catch {
    /* quota */
  }
}

export function vylineClientPut(
  accountId: string,
  entry: Omit<VylineClientProfile, "updatedAt"> & { updatedAt?: number },
): void {
  const db = vylineClientLoad(accountId);
  const prev = db.profiles[entry.mid];
  const name = entry.displayName?.trim() ?? "";
  db.profiles[entry.mid] = {
    mid: entry.mid,
    displayName:
      name && !looksLikeMid(name)
        ? name
        : prev?.displayName && !looksLikeMid(prev.displayName)
          ? prev.displayName
          : name || entry.mid,
    thumbnailUrl: entry.thumbnailUrl || prev?.thumbnailUrl,
    statusMessage: entry.statusMessage !== undefined ? entry.statusMessage : prev?.statusMessage,
    musicProfile: entry.musicProfile !== undefined ? entry.musicProfile : prev?.musicProfile,
    birthday: entry.birthday !== undefined ? entry.birthday : prev?.birthday,
    backgroundUrl: entry.backgroundUrl !== undefined ? entry.backgroundUrl : prev?.backgroundUrl,
    updatedAt: entry.updatedAt ?? Date.now(),
  };
  vylineClientSave(accountId, db);
}

export function vylineClientPutMany(
  accountId: string,
  entries: Array<Omit<VylineClientProfile, "updatedAt">>,
): void {
  if (!entries.length) return;
  const db = vylineClientLoad(accountId);
  const now = Date.now();
  for (const entry of entries) {
    if (!entry.mid) continue;
    const prev = db.profiles[entry.mid];
    const name = entry.displayName?.trim() ?? "";
    db.profiles[entry.mid] = {
      mid: entry.mid,
      displayName:
        name && !looksLikeMid(name)
          ? name
          : prev?.displayName && !looksLikeMid(prev.displayName)
            ? prev.displayName
            : name || entry.mid,
      thumbnailUrl: entry.thumbnailUrl || prev?.thumbnailUrl,
      statusMessage: entry.statusMessage !== undefined ? entry.statusMessage : prev?.statusMessage,
      musicProfile: entry.musicProfile !== undefined ? entry.musicProfile : prev?.musicProfile,
      birthday: entry.birthday !== undefined ? entry.birthday : prev?.birthday,
      backgroundUrl: entry.backgroundUrl !== undefined ? entry.backgroundUrl : prev?.backgroundUrl,
      updatedAt: now,
    };
  }
  vylineClientSave(accountId, db);
}

export function vylineClientToContactMap(accountId: string): Map<string, ContactInfo> {
  const db = vylineClientLoad(accountId);
  const out = new Map<string, ContactInfo>();
  for (const [mid, p] of Object.entries(db.profiles)) {
    if (p.displayName && !looksLikeMid(p.displayName)) {
      out.set(mid, { name: p.displayName, thumbnailUrl: p.thumbnailUrl });
    } else if (p.thumbnailUrl) {
      out.set(mid, { thumbnailUrl: p.thumbnailUrl });
    }
  }
  return out;
}

export function parseMusicProfile(raw: string | undefined | null): {
  title?: string;
  artist?: string;
  raw: string;
} | null {
  if (!raw?.trim()) return null;
  const s = raw.trim();
  try {
    const j = JSON.parse(s) as Record<string, unknown>;
    return {
      title:
        typeof j.title === "string" ? j.title : typeof j.name === "string" ? j.name : undefined,
      artist:
        typeof j.artist === "string"
          ? j.artist
          : typeof j.artistName === "string"
            ? j.artistName
            : undefined,
      raw: s,
    };
  } catch {
    return { raw: s, title: s.length > 40 ? `${s.slice(0, 40)}…` : s };
  }
}
