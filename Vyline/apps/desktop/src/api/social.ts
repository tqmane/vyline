import { captureBackendFetch } from "./client";

export type SocialProfile = { mid?: string; displayName?: string; thumbnailUrl?: string; backgroundUrl?: string; statusMessage?: string; userType?: number };
export type SocialContact = { profile: SocialProfile; isFriend: boolean; isBlocked: boolean; blockedStale: boolean };
export type BlockedContacts = { mids: string[]; syncedAt: number | null; stale: boolean };

async function request<T>(accountId: string, path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await captureBackendFetch()(`/line/${encodeURIComponent(accountId)}/social/${path}`, {
    method, headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json() as T & { ok?: boolean; error?: string; code?: string };
  if (!response.ok || result.ok === false) throw Object.assign(new Error(result.error || "連絡先の操作に失敗しました"), { code: result.code });
  return result;
}

export const socialApi = {
  profile: (accountId: string, mid: string) => request<SocialContact>(accountId, `profile/${encodeURIComponent(mid)}`),
  blocked: (accountId: string) => request<BlockedContacts>(accountId, "blocked"),
  friend: (accountId: string, mid: string, add: boolean) => request(accountId, `friends/${encodeURIComponent(mid)}`, add ? "POST" : "DELETE"),
  createChat: (accountId: string, name: string, memberMids: string[], mode: "group" | "room") => request<{ chat: { chatMid: string; name: string } }>(accountId, "chats", "POST", { name, memberMids, mode }),
};
