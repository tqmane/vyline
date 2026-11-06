import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import * as manager from "../line/clientManager.js";
import * as events from "../line/talkEventBuffer.js";
import * as locks from "../storage/chatLockStore.js";
import * as messages from "../storage/chatStore.js";
import * as rules from "../storage/groupInviteRules.js";
import * as cache from "../storage/vylineCache.js";
import { fetchMessages, processFetchedOperations, saveGroupInviteReject } from "./lineService.js";

const account = "invite-rejection-fixture";
const chatMid = `c${"3".repeat(32)}`;
const self = `u${"0".repeat(32)}`;
const target = `u${"1".repeat(32)}`;
const other = `u${"2".repeat(32)}`;
const storedMessage = { id: "100", from: self, to: chatMid, text: "fixture", contentType: "NONE", createdTime: 1, isMyMessage: true };
let rule: rules.GroupInviteRule;
let memberMids: Record<string, bigint>;
let inviteeMids: Record<string, bigint>;
let client: NonNullable<ReturnType<typeof manager.getClient>>;
let restores: Array<() => void> = [];
let getChats = mock(async (..._args: unknown[]) => ({ chats: [{ chatMid, extra: { groupExtra: { memberMids, inviteeMids } } }] }));
let cancel = mock(async (..._args: unknown[]) => {});
let kick = mock(async (..._args: unknown[]) => {});
let removed = mock(async (..._args: unknown[]) => {});
let published = mock((..._args: unknown[]) => 1);

beforeEach(() => {
  rule = { enabled: true, targetMids: [target] };
  memberMids = { [self]: 1n, [other]: 2n };
  inviteeMids = {};
  getChats = mock(async (..._args: unknown[]) => ({ chats: [{ chatMid, extra: { groupExtra: { memberMids, inviteeMids } } }] }));
  cancel = mock(async (..._args: unknown[]) => {});
  kick = mock(async (..._args: unknown[]) => {});
  removed = mock(async (..._args: unknown[]) => {});
  published = mock((..._args: unknown[]) => 1);
  client = {
    base: {
      profile: { mid: self },
      getReqseq: async () => 7,
      talk: { getChats, cancelChatInvitation: cancel, deleteOtherFromChat: kick },
    },
  } as unknown as typeof client;
  const spies = [
    spyOn(manager, "getClient").mockImplementation(() => client),
    spyOn(locks, "isChatLocked").mockResolvedValue(false),
    spyOn(rules, "readGroupInviteRule").mockImplementation(async () => rule),
    spyOn(rules, "writeGroupInviteRule").mockImplementation(async (_account, _chat, value) => {
      rule = rules.validateInviteRule(value);
      return rule;
    }),
    spyOn(cache, "vylineRemoveGroupMembers").mockImplementation(removed),
    spyOn(events, "pushTalkEvent").mockImplementation(published),
    spyOn(messages, "getStoredMessages").mockResolvedValue([storedMessage]),
  ];
  restores = spies.map(spy => () => spy.mockRestore());
});

afterEach(() => { for (const restore of restores) restore(); });

test("saving a direct MID removes an existing member without requiring friend lookup", async () => {
  memberMids[target] = 3n;
  expect(await saveGroupInviteReject(account, chatMid, rule)).toEqual({ rule });
  expect(getChats).toHaveBeenCalledWith({ chatMids: [chatMid], withMembers: true, withInvitees: true });
  expect(kick).toHaveBeenCalledWith({ request: { reqSeq: 7, chatMid, targetUserMids: [target] } });
  expect(cancel).not.toHaveBeenCalled();
  expect(removed).toHaveBeenCalledWith(account, chatMid, [target], expect.any(Function));
});

test("an invitation accepted during cancellation is re-read and removed as a member", async () => {
  inviteeMids[target] = 3n;
  cancel.mockImplementationOnce(async () => {
    inviteeMids = {};
    memberMids[target] = 3n;
    throw new Error("NOT_AN_INVITEE");
  });
  expect(await saveGroupInviteReject(account, chatMid, rule)).toEqual({ rule });
  expect(getChats).toHaveBeenCalledTimes(2);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(kick).toHaveBeenCalledTimes(1);
  expect(removed).toHaveBeenCalledWith(account, chatMid, [target], expect.any(Function));
});

test("persistent LINE rejection retries once and reports saved-but-not-applied", async () => {
  inviteeMids[target] = 3n;
  cancel.mockRejectedValue(new Error("FORBIDDEN"));
  const result = await saveGroupInviteReject(account, chatMid, rule);
  expect(result.rule).toEqual(rule);
  expect(result.warning).toContain("適用に失敗");
  expect(getChats).toHaveBeenCalledTimes(2);
  expect(cancel).toHaveBeenCalledTimes(2);
  expect(kick).not.toHaveBeenCalled();
  expect(removed).not.toHaveBeenCalled();
  expect(published).not.toHaveBeenCalled();
});

test("successful removal updates only that member's cache when another target fails", async () => {
  rule.targetMids.push(other);
  memberMids[target] = 3n;
  kick.mockImplementation(async (...args) => {
    const mid = (args[0] as { request: { targetUserMids: string[] } }).request.targetUserMids[0];
    if (mid === other) throw new Error("FORBIDDEN");
    delete memberMids[target];
  });
  expect((await saveGroupInviteReject(account, chatMid, rule)).warning).toBeDefined();
  expect(removed).toHaveBeenCalledTimes(1);
  expect(removed).toHaveBeenCalledWith(account, chatMid, [target], expect.any(Function));
});

test("a disabled rule and an attempted self-target do not mutate membership", async () => {
  memberMids[target] = 3n;
  await saveGroupInviteReject(account, chatMid, { ...rule, enabled: false });
  await expect(saveGroupInviteReject(account, chatMid, { enabled: true, targetMids: [self] })).rejects.toThrow("自分自身");
  expect(getChats).not.toHaveBeenCalled();
  expect(kick).not.toHaveBeenCalled();
  expect(cancel).not.toHaveBeenCalled();
});

test("disabling the rule while the membership snapshot loads cancels pending action", async () => {
  memberMids[target] = 3n;
  const snapshot = getChats.getMockImplementation()!;
  getChats.mockImplementationOnce(async () => {
    const result = await snapshot();
    rule = { ...rule, enabled: false };
    return result;
  });
  await saveGroupInviteReject(account, chatMid, rule);
  expect(kick).not.toHaveBeenCalled();
});

test("a replaced session does not receive a kick or a false success", async () => {
  memberMids[target] = 3n;
  const snapshot = getChats.getMockImplementation()!;
  getChats.mockImplementationOnce(async () => {
    const result = await snapshot();
    client = { ...client } as typeof client;
    return result;
  });
  expect((await saveGroupInviteReject(account, chatMid, rule)).warning).toBeDefined();
  expect(kick).not.toHaveBeenCalled();
  expect(removed).not.toHaveBeenCalled();
});

test("a session replaced during the final kick cannot update cache, publish or retry", async () => {
  memberMids[target] = 3n;
  const started = Promise.withResolvers<void>();
  const pendingKick = Promise.withResolvers<void>();
  kick.mockImplementationOnce(async () => {
    started.resolve();
    await pendingKick.promise;
  });
  const application = saveGroupInviteReject(account, chatMid, rule);
  await started.promise;
  const replacementRpc = mock(async () => { throw new Error("replacement client must not be used"); });
  client = {
    base: {
      profile: { mid: self },
      getReqseq: async () => 8,
      talk: { getChats: replacementRpc, cancelChatInvitation: replacementRpc, deleteOtherFromChat: replacementRpc },
    },
  } as unknown as typeof client;
  pendingKick.resolve();
  expect((await application).warning).toBeDefined();
  expect(getChats).toHaveBeenCalledTimes(1);
  expect(kick).toHaveBeenCalledTimes(1);
  expect(removed).not.toHaveBeenCalled();
  expect(published).not.toHaveBeenCalled();
  expect(replacementRpc).not.toHaveBeenCalled();
});

test("opening cached group history catches up on a missed join event", async () => {
  memberMids[target] = 3n;
  expect(await fetchMessages(account, chatMid, 30)).toEqual([storedMessage]);
  await Bun.sleep(0);
  expect(kick).toHaveBeenCalledTimes(1);
  expect(removed).toHaveBeenCalledWith(account, chatMid, [target], expect.any(Function));
});

test("local-only history and pagination do not trigger additional group actions", async () => {
  memberMids[target] = 3n;
  await fetchMessages(account, chatMid, 30, { localOnly: true });
  await fetchMessages(account, chatMid, 30, { localOnly: true, beforeMessageId: "100" });
  await fetchMessages(account, other, 30);
  await Bun.sleep(0);
  expect(getChats).not.toHaveBeenCalled();
});

for (const [type, status] of [[124, "invited"], [130, "joined"]] as const) {
  test(`membership operation ${type} applies the rule to ${status} targets`, async () => {
    if (status === "invited") inviteeMids[target] = 3n;
    else memberMids[target] = 3n;
    await processFetchedOperations(account, [{ type, param1: chatMid, param2: target }]);
    await Bun.sleep(0);
    expect(status === "invited" ? cancel : kick).toHaveBeenCalledTimes(1);
  });
}
