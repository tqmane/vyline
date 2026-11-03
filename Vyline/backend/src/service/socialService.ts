import { BlockedContactStore, USER_MID } from "../storage/blockedContactStore.js";

export type SocialProfile = { mid?: string | undefined; displayName?: string | undefined; thumbnailUrl?: string | undefined; backgroundUrl?: string | undefined; statusMessage?: string | undefined; userType?: number | undefined };
export type SocialDependencies = {
  profile(accountId: string, mid: string): Promise<SocialProfile | null>;
  friendMids(accountId: string): Promise<string[]>;
  selfMid(accountId: string): Promise<string>;
  addFriend(accountId: string, mid: string): Promise<void>;
  deleteFriend(accountId: string, mid: string): Promise<void>;
  blockedMids(accountId: string): Promise<string[]>;
  blockContact(accountId: string, mid: string): Promise<void>;
  unblockContact(accountId: string, mid: string): Promise<void>;
  createChat(accountId: string, name: string, mids: string[], mode: "group" | "room"): Promise<{ chatMid: string; name: string }>;
};

export class SocialError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409 = 400) { super(message); }
}

const PROTECTED_MID = "u085311ecd9e3e3d74ae4c9f5437cbcb5";
export class SocialService {
  private readonly inflight = new Map<string, Promise<ReturnType<SocialService["blockedResult"]>>>();
  private readonly revisions = new Map<string, number>();
  private readonly mutations = new Set<string>();
  constructor(private readonly deps: SocialDependencies, private readonly store = new BlockedContactStore(), private readonly ttl = 300_000) {}

  private validate(mid: string): string {
    if (!USER_MID.test(mid)) throw new SocialError("ユーザーMIDが正しくありません");
    return mid.toLowerCase();
  }
  private blockedResult(accountId: string, stale: boolean) {
    return { ...this.store.read(accountId), stale };
  }

  async blocked(accountId: string) {
    const snapshot = this.store.read(accountId);
    if (snapshot.syncedAt !== null && Date.now() - snapshot.syncedAt < this.ttl)
      return { ...snapshot, stale: false };
    const pending = this.inflight.get(accountId);
    if (pending) return pending;
    const revision = this.revisions.get(accountId) ?? 0;
    const task = (async () => {
      try {
        const mids = await this.deps.blockedMids(accountId);
        if ((this.revisions.get(accountId) ?? 0) !== revision) return this.blockedResult(accountId, true);
        return { ...this.store.sync(accountId, mids), stale: false };
      } catch (error) {
        // No successful snapshot means "unknown", never a fabricated empty list.
        if (snapshot.syncedAt === null && !snapshot.mids.length && !this.store.read(accountId).mids.length) throw error;
        return this.blockedResult(accountId, true);
      } finally { this.inflight.delete(accountId); }
    })();
    this.inflight.set(accountId, task);
    return task;
  }

  async profile(accountId: string, inputMid: string) {
    const mid = this.validate(inputMid);
    const [profile, friends, blocked] = await Promise.all([
      this.deps.profile(accountId, mid), this.deps.friendMids(accountId), this.blocked(accountId),
    ]);
    if (!profile) throw new SocialError("プロフィールが見つかりません", 404);
    return { profile, isFriend: friends.some(friend => friend.toLowerCase() === mid), isBlocked: blocked.mids.includes(mid), blockedStale: blocked.stale };
  }

  async friend(accountId: string, inputMid: string, add: boolean) {
    const mid = this.validate(inputMid);
    if (mid === PROTECTED_MID || mid === (await this.deps.selfMid(accountId)).toLowerCase())
      throw new SocialError("このアカウントの友だち操作はできません", 403);
    const key = `${accountId}:${mid}`;
    if (this.mutations.has(key)) throw new SocialError("処理中です", 409);
    this.mutations.add(key);
    try {
      const state = await this.profile(accountId, mid);
      if (add && (state.isBlocked || state.blockedStale)) throw new SocialError("ブロック状態を再確認・解除してから追加してください", 409);
      if (state.isFriend === add) return;
      await (add ? this.deps.addFriend(accountId, mid) : this.deps.deleteFriend(accountId, mid));
    } finally { this.mutations.delete(key); }
  }

  async block(accountId: string, inputMid: string, blocked: boolean) {
    const mid = this.validate(inputMid);
    if (mid === PROTECTED_MID || mid === (await this.deps.selfMid(accountId)).toLowerCase()) throw new SocialError("このアカウントはブロックできません", 403);
    await (blocked ? this.deps.blockContact(accountId, mid) : this.deps.unblockContact(accountId, mid));
    this.recordBlock(accountId, mid, blocked);
  }

  /** Also call after successful mutations through the existing /contacts/:mid/block routes. */
  recordBlock(accountId: string, mid: string, blocked: boolean) {
    this.revisions.set(accountId, (this.revisions.get(accountId) ?? 0) + 1);
    this.store.setBlocked(accountId, mid, blocked);
  }

  async create(accountId: string, input: { name?: unknown; memberMids?: unknown; mode?: unknown }) {
    if (input.mode !== "group" && input.mode !== "room") throw new SocialError("作成形式が正しくありません");
    if (!Array.isArray(input.memberMids) || !input.memberMids.length || input.memberMids.length > 499 || input.memberMids.some(mid => typeof mid !== "string" || !USER_MID.test(mid))) throw new SocialError("メンバーを選んでください");
    if (input.name !== undefined && (typeof input.name !== "string" || input.name.length > 100)) throw new SocialError("グループ名が正しくありません");
    const mids = [...new Set((input.memberMids as string[]).map(mid => mid.toLowerCase()))];
    if (mids.includes((await this.deps.selfMid(accountId)).toLowerCase())) throw new SocialError("自分自身は選択できません");
    return await this.deps.createChat(accountId, typeof input.name === "string" ? input.name.trim() : "", mids, input.mode);
  }
}
