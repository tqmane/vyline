import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BlockedContactStore } from "../storage/blockedContactStore.js";
import { SocialService, type SocialDependencies } from "./socialService.js";
import { createSocialRouter } from "../api/social.js";

const mid = `u${"a".repeat(32)}`;
const other = `u${"b".repeat(32)}`;
let dir: string;
let store: BlockedContactStore;
let deps: SocialDependencies;
let writes: string[];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "vyline-social-"));
  store = new BlockedContactStore(account => join(dir, account, "blocked.sqlite"));
  writes = [];
  deps = {
    profile: async (_account, target) => ({ mid: target, displayName: "Test" }),
    friendMids: async () => [], selfMid: async () => other,
    addFriend: async () => { writes.push("add"); }, deleteFriend: async () => { writes.push("delete"); },
    blockedMids: async () => [], blockContact: async () => { writes.push("block"); }, unblockContact: async () => { writes.push("unblock"); },
    createChat: async (_account, name, mids, mode) => { writes.push(`${mode}:${mids.length}`); return { chatMid: "c-test", name }; },
  };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("blocked snapshots survive reopen, stay account isolated, and accept an authoritative empty sync", () => {
  store.sync("a", [mid, mid], 123);
  store.sync("b", [other], 456);
  const reopened = new BlockedContactStore(account => join(dir, account, "blocked.sqlite"));
  expect(reopened.read("a")).toEqual({ mids: [mid], syncedAt: 123 });
  reopened.sync("a", [], 789);
  expect(reopened.read("a")).toEqual({ mids: [], syncedAt: 789 });
  expect(reopened.read("b").mids).toEqual([other]);
  expect(() => reopened.sync("b", ["invalid"])).toThrow();
  expect(reopened.read("b").mids).toEqual([other]);
});

test("expired snapshots are visibly stale on failure; no snapshot remains an error", async () => {
  store.sync("a", [mid], 1);
  deps.blockedMids = async () => { throw new Error("offline"); };
  const service = new SocialService(deps, store);
  expect(await service.blocked("a")).toEqual({ mids: [mid], syncedAt: 1, stale: true });
  await expect(service.blocked("b")).rejects.toThrow("offline");
});

test("concurrent blocked refreshes coalesce and a later unblock cannot be overwritten", async () => {
  const pending = Promise.withResolvers<string[]>();
  let calls = 0;
  deps.blockedMids = () => { calls++; return pending.promise; };
  store.sync("a", [mid], 1);
  const service = new SocialService(deps, store);
  const first = service.blocked("a");
  const second = service.blocked("a");
  service.recordBlock("a", mid, false);
  pending.resolve([mid]);
  expect((await first).mids).toEqual([]);
  expect((await second).stale).toBe(true);
  expect(calls).toBe(1);
});

test("profile lookup never mutates friendship; add/delete are explicit and idempotent", async () => {
  const service = new SocialService(deps, store);
  expect((await service.profile("a", mid)).isFriend).toBe(false);
  expect(writes).toEqual([]);
  await service.friend("a", mid, true);
  deps.friendMids = async () => [mid];
  await service.friend("a", mid, true);
  await service.friend("a", mid, false);
  expect(writes).toEqual(["add", "delete"]);
  await expect(service.friend("a", other, false)).rejects.toThrow();
  await expect(service.friend("a", "U085311ECD9E3E3D74AE4C9F5437CBCB5", false)).rejects.toThrow();
  await expect(service.friend("a", other.toUpperCase(), false)).rejects.toThrow();
  await expect(service.profile("a", "not-mid")).rejects.toThrow();
});

test("blocked or stale contacts cannot be added, and a failed mutation preserves the cache", async () => {
  deps.blockedMids = async () => [mid];
  deps.unblockContact = async () => { throw new Error("denied"); };
  const service = new SocialService(deps, store);
  await expect(service.friend("a", mid, true)).rejects.toThrow("ブロック");
  await expect(service.block("a", mid, false)).rejects.toThrow("denied");
  expect(store.read("a").mids).toEqual([mid]);
});

test("group and room route payloads are distinct; invalid modes and empty selections never create", async () => {
  const router = createSocialRouter(new SocialService(deps, store));
  for (const mode of ["group", "room"]) {
    const response = await router.request("/a/social/chats", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, name: "Test", memberMids: [mid, mid] }) });
    expect(response.status).toBe(200);
  }
  for (const body of [{ mode: "bad", memberMids: [mid] }, { mode: "room", memberMids: [] }, null]) {
    const response = await router.request("/a/social/chats", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    expect(response.status).toBe(400);
  }
  expect(writes).toEqual(["group:1", "room:1"]);
});
