import { api } from "../api/client.js";
import { useStore } from "./store.js";

/** A blocked friend, with the profile fields resolved for display in Settings. */
export type BlockedContact = { mid: string; name?: string; avatarUrl?: string };

/**
 * Reads the blocked list plus one profile per MID.
 *
 * Returns `null` instead of the list when the active account changed while the
 * requests were in flight, so a caller cannot render the previous account's
 * blocked friends under the current one.
 */
export async function loadBlockedContacts(accountId: string): Promise<BlockedContact[] | null> {
  const res = await api.line.blockedContacts(accountId);
  const mids = res.ok ? (res.mids ?? []) : [];
  const withProfiles = await Promise.all(
    mids.map(async (mid): Promise<BlockedContact> => {
      try {
        const prof = await api.line.contactProfile(accountId, mid);
        if (!prof.ok) return { mid };
        return { mid, name: prof.profile?.displayName, avatarUrl: prof.profile?.thumbnailUrl };
      } catch {
        return { mid };
      }
    }),
  );
  if (useStore.getState().accountId !== accountId) return null;
  return withProfiles;
}

/**
 * Unblocks one MID and mirrors it into the store's block list.
 *
 * The store write is dropped when the active account changed mid-flight, so a
 * late response cannot unblock a contact in a different account.
 */
export async function unblockBlockedMid(
  accountId: string,
  mid: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await api.line.unblockContact(accountId, mid);
  if (!res.ok) return { ok: false, error: res.error ?? "ブロック解除に失敗しました" };
  if (useStore.getState().accountId !== accountId) return { ok: false };
  useStore.setState((st) => ({ blockedMids: st.blockedMids.filter((m) => m !== mid) }));
  return { ok: true };
}

/**
 * Blocks or unblocks a MID that is not a friend chat (for example a group
 * member opened from the member profile). `setContactBlocked` cannot be used
 * here because it requires the target to be a friend chat row.
 */
export async function setMemberBlocked(
  accountId: string,
  mid: string,
  blocked: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const res = blocked
    ? await api.line.blockContact(accountId, mid)
    : await api.line.unblockContact(accountId, mid);
  if (!res.ok)
    return {
      ok: false,
      error: res.error ?? (blocked ? "ブロックに失敗しました" : "ブロック解除に失敗しました"),
    };
  if (useStore.getState().accountId !== accountId) return { ok: false };
  useStore.setState((st) => ({
    blockedMids: blocked
      ? st.blockedMids.includes(mid)
        ? st.blockedMids
        : [...st.blockedMids, mid]
      : st.blockedMids.filter((m) => m !== mid),
  }));
  return { ok: true };
}
