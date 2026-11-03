import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import * as manager from "../line/clientManager.js";
import * as locks from "../storage/featureLocks.js";
import * as chatLocks from "../storage/chatLockStore.js";
import { addSocialFriend, deleteSocialFriend, listSocialFriendMids, socialSelfMid, createGroupChat } from "./lineService.js";

const peer = `u${"a".repeat(32)}`;
const self = `u${"b".repeat(32)}`;
type Client = NonNullable<ReturnType<typeof manager.getClient>>;
let current: Client | undefined;
let requests: Array<{ method: string; input: unknown }>;
let undo: Array<() => void>;
beforeEach(() => {
  requests = [];
  current = { base: { profile: { mid: self }, getReqseq: async () => 7,
    relation: {
      getUserFriendIds: async (input: unknown) => { requests.push({ method: "friends", input }); return { userFriendMids: [peer] }; },
      addFriendByMid: async (input: unknown) => { requests.push({ method: "add", input }); },
    }, talk: {
      updateContactSetting: async (input: unknown) => { requests.push({ method: "delete", input }); },
      createChat: async (input: unknown) => { requests.push({ method: "create", input }); return { chat: { chatMid: `c${"c".repeat(32)}`, chatName: "Created" } }; },
    },
  } } as unknown as Client;
  undo = [spyOn(manager, "getClient").mockImplementation(() => current),
    spyOn(locks, "isCreateGroupBanned").mockResolvedValue(false),
    spyOn(chatLocks, "isChatLocked").mockResolvedValue(false),
  ].map(spy => () => spy.mockRestore());
});
afterEach(() => { for (const restore of undo) restore(); });

test("friend wrappers use the current session's relation and contact-setting protocols", async () => {
  expect(await socialSelfMid("social-contract")).toBe(self);
  expect(await listSocialFriendMids("social-contract")).toEqual([peer]);
  expect(requests).toHaveLength(1);
  await addSocialFriend("social-contract", peer);
  await deleteSocialFriend("social-contract", peer);
  expect(requests[1]).toEqual({ method: "add", input: { mid: peer, trackingMetaType: 5 } });
  expect(requests[2]).toEqual({ method: "delete", input: { reqSeq: 7, mid: peer, flag: "CONTACT_SETTING_DELETE", value: "true" } });
});

test("group default and explicit room creation reach distinct createChat types", async () => {
  await createGroupChat("social-contract", "Group", [peer]);
  await createGroupChat("social-contract", "", [peer, peer], "room");
  expect(requests[0]).toMatchObject({ method: "create", input: { request: { type: "GROUP", targetUserMids: [peer] } } });
  expect(requests[1]).toMatchObject({ method: "create", input: { request: { type: "ROOM", targetUserMids: [peer], reqSeq: 7 } } });
});

test("creation ban prevents both modes and missing sessions never reach the RPC", async () => {
  spyOn(locks, "isCreateGroupBanned").mockResolvedValue(true);
  await expect(createGroupChat("social-contract", "", [peer], "room")).rejects.toThrow("CREATE_GROUP_BANNED");
  expect(requests).toEqual([]);
  current = undefined;
  await expect(listSocialFriendMids("social-contract")).rejects.toThrow("not logged in");
});

test("a retired friend lookup cannot return a replacement session's state", async () => {
  const deferred = Promise.withResolvers<{ userFriendMids: string[] }>();
  current!.base.relation.getUserFriendIds = async () => await deferred.promise as never;
  const pending = listSocialFriendMids("social-contract");
  current = { ...current!, base: { ...current!.base, profile: { mid: peer } } } as Client;
  deferred.resolve({ userFriendMids: [peer] });
  await expect(pending).rejects.toThrow("superseded");
});
