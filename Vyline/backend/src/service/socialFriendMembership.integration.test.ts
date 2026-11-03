import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import type { Chat } from "@vyline/types";
import * as manager from "../line/clientManager.js";
import * as chatStore from "../storage/chatStore.js";
import * as cache from "../storage/vylineCache.js";
import { AuthService } from "../auth/mod.js";
import { fetchBootstrap, fetchChats } from "./lineService.js";

const peer = `u${"a".repeat(32)}`;
const stranger = `u${"b".repeat(32)}`;
const self = `u${"c".repeat(32)}`;
type Client = NonNullable<ReturnType<typeof manager.getClient>>;
let current: Client;
let roster: string[];
let calls: number;
let undo: Array<() => void>;
const direct = (mid: string): Chat => ({ mid, kind: "direct", name: "Saved", thumbnailUrl: "saved-avatar", hasMessages: true, lastMessageTime: 123, lastMessagePreview: "Saved message" });
const saved = (): Chat[] => [direct(peer), direct(stranger), direct(self), { ...direct(`c${"d".repeat(32)}`), kind: "group" }];
beforeEach(() => {
  roster = [peer]; calls = 0;
  current = { base: { profile: { mid: self }, relation: {
    getUserFriendIds: async () => { calls++; return { userFriendMids: roster }; },
  } } } as unknown as Client;
  undo = [spyOn(manager, "getClient").mockImplementation(() => current),
    spyOn(chatStore, "getStoredChats").mockImplementation(async () => saved()),
    spyOn(chatStore, "getCacheMeta").mockImplementation(async () => ({ chatsSyncedAt: new Date().toISOString() })),
    spyOn(chatStore, "getBootstrapPayload").mockImplementation(async () => ({ chats: saved(), messagesByChat: {}, syncedAt: "saved", chatsSyncedAt: "saved" })),
    spyOn(AuthService, "tryRefreshToken").mockResolvedValue(),
    spyOn(cache, "vylineResolvedNameMap").mockResolvedValue(new Map()),
    spyOn(cache, "vylineGetProfiles").mockResolvedValue(new Map()),
  ].map(spy => () => spy.mockRestore());
});
afterEach(() => { for (const restore of undo) restore(); });

test("cached /chats rows get authoritative membership without changing stored history or requiring a schema", async () => {
  const chats = await fetchChats("friend-membership-cache");
  expect(chats.map(chat => chat.isFriend)).toEqual([true, false, false, undefined]);
  expect(chats.map(chat => chat.lastMessagePreview)).toEqual(saved().map(chat => chat.lastMessagePreview));
  expect(chats[2]?.isSelf).toBe(true);
  expect(calls).toBe(1);
  expect(saved().every(chat => chat.isFriend === undefined)).toBe(true);
});

test("bootstrap remains roster-RPC-free, reapplies the current session roster, and never leaks across session replacement", async () => {
  expect((await fetchBootstrap("friend-membership-bootstrap")).chats[0]?.isFriend).toBeUndefined();
  expect(calls).toBe(0);
  await fetchChats("friend-membership-bootstrap");
  expect((await fetchBootstrap("friend-membership-bootstrap")).chats[0]?.isFriend).toBe(true);
  expect(calls).toBe(1);
  current = { base: { profile: { mid: self }, relation: current.base.relation } } as Client;
  expect((await fetchBootstrap("friend-membership-bootstrap")).chats[0]?.isFriend).toBeUndefined();
  expect(calls).toBe(1);
});

test("an authoritative empty roster clears friendship while preserving all conversations", async () => {
  await fetchChats("friend-membership-empty");
  roster = [];
  const chats = await fetchChats("friend-membership-empty");
  expect(chats.filter(chat => chat.isFriend)).toEqual([]);
  expect(chats).toHaveLength(saved().length);
  expect((await fetchBootstrap("friend-membership-empty")).chats[0]?.isFriend).toBe(false);
});

test("roster failure leaves membership unknown and retains cached messages", async () => {
  await fetchChats("friend-membership-offline");
  current.base.relation.getUserFriendIds = async () => { throw new Error("fixture offline"); };
  const chats = await fetchChats("friend-membership-offline");
  expect(chats.every(chat => chat.isFriend === undefined)).toBe(true);
  expect(chats).toHaveLength(saved().length);
  expect((await fetchBootstrap("friend-membership-offline")).chats[0]?.isFriend).toBeUndefined();
});

test("an earlier roster request cannot recertify a contact after a newer explicit refresh", async () => {
  const deferred = Promise.withResolvers<{ userFriendMids: string[] }>();
  current.base.relation.getUserFriendIds = async () => await deferred.promise as never;
  const older = fetchChats("friend-membership-race");
  current.base.relation.getUserFriendIds = async () => ({ userFriendMids: [] }) as never;
  await fetchChats("friend-membership-race", { force: false, refresh: true });
  deferred.resolve({ userFriendMids: [peer] });
  expect((await older).some(chat => chat.isFriend)).toBe(false);
  expect((await fetchBootstrap("friend-membership-race")).chats[0]?.isFriend).toBe(false);
});
