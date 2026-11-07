import { afterEach, expect, mock, spyOn, test } from "bun:test";
import * as protocol from "@vyline/protocol";
import { InternalError } from "@vyline/protocol/stack/base";
import * as manager from "../line/clientManager.js";
import * as locks from "../storage/chatLockStore.js";
import { sendMessage } from "./lineService.js";

afterEach(() => mock.restore());

function fixture() {
  const accountId = `direct-wire-${crypto.randomUUID()}`;
  const mid = `u${"2".repeat(32)}`;
  const sent = mock(async (_request: Record<string, unknown>) => null);
  const groupKey = mock(async () => {
    throw new Error("DM must not request a group key");
  });
  const client = {
    base: {
      profile: { mid: `u${"1".repeat(32)}` },
      talk: {
        sendMessage: sent,
        getBlockedContactIds: async () => [],
        getLastE2EEGroupSharedKey: groupKey,
      },
    },
  } as unknown as protocol.VylineClient;
  spyOn(manager, "getClient").mockReturnValue(client);
  spyOn(locks, "isChatLocked").mockResolvedValue(false);
  const identity = spyOn(protocol, "ensureValidE2EEIdentity").mockResolvedValue({} as never);
  const recreate = spyOn(protocol, "recreateE2EEGroupKey").mockResolvedValue({
    keyId: 8,
    privKey: "synthetic-unused",
  });
  const encrypt = spyOn(protocol, "encryptLetterSealingMessage").mockResolvedValue({
    contentMetadata: { e2eeVersion: "2" },
    chunks: [],
  } as never);
  const error = (code: string | number) =>
    new InternalError("RequestError", "Request internal failed, sendMessage(/S4)", { code });
  return { accountId, mid, sent, groupKey, recreate, identity, encrypt, error };
}

test("ordinary DM stays encrypted and never requests group keys", async () => {
  const f = fixture();
  await sendMessage(f.accountId, f.mid, "synthetic DM", { relatedMessageId: "101", mute: true });
  expect(f.sent).toHaveBeenCalledTimes(1);
  expect(f.sent.mock.calls[0]?.[0]).toMatchObject({
    to: f.mid,
    e2ee: true,
    relatedMessageId: "101",
    contentMetadata: { NOTIFICATION_DISABLED: "true" },
  });
  expect(f.groupKey).not.toHaveBeenCalled();
  expect(f.recreate).not.toHaveBeenCalled();
});

for (const code of [83, "E2EE_UPDATE_SENDER_KEY"] as const)
  test(`DM recovers the structured sender-key code ${code} with encrypted retry`, async () => {
    const f = fixture();
    f.sent.mockRejectedValueOnce(f.error(code));
    await sendMessage(f.accountId, f.mid, "synthetic DM");
    expect(f.sent).toHaveBeenCalledTimes(2);
    expect(f.sent.mock.calls.every(([request]) => request.e2ee === true)).toBe(true);
    expect(f.identity.mock.calls.some(([, options]) => options?.forceNewSenderKey === true)).toBe(
      true,
    );
    expect(f.groupKey).not.toHaveBeenCalled();
  });

test("DM honors LINE's explicit retry-plain instruction and caches that decision", async () => {
  const f = fixture();
  f.sent.mockRejectedValueOnce(f.error(98));
  await sendMessage(f.accountId, f.mid, "synthetic DM");
  await sendMessage(f.accountId, f.mid, "another synthetic DM");
  expect(f.sent.mock.calls.map(([request]) => request.e2ee)).toEqual([true, false, false]);
  expect(f.groupKey).not.toHaveBeenCalled();
});

test("a peer explicitly negotiated without E2EE retains ordinary DM compatibility", async () => {
  const f = fixture();
  f.encrypt.mockRejectedValue(new Error(`Not support E2EE: ${f.mid}`));
  await sendMessage(f.accountId, f.mid, "synthetic DM");
  expect(f.sent).toHaveBeenCalledTimes(1);
  expect(f.sent.mock.calls[0]?.[0]?.e2ee).toBe(false);
});

test("local sender-key absence cannot send or cache plaintext in a DM", async () => {
  const f = fixture();
  const error = new Error("NoE2EEKey: local self key not found");
  f.encrypt.mockRejectedValue(error);
  for (let attempt = 0; attempt < 2; attempt++)
    await expect(sendMessage(f.accountId, f.mid, "synthetic DM")).rejects.toBe(error);
  expect(f.encrypt).toHaveBeenCalledTimes(2);
  expect(f.sent).not.toHaveBeenCalled();
});

test("a rejected DM request propagates without plaintext retry", async () => {
  const f = fixture();
  const error = f.error("NOT_AUTHORIZED_DEVICE");
  f.sent.mockRejectedValue(error);
  await expect(sendMessage(f.accountId, f.mid, "synthetic DM")).rejects.toBe(error);
  expect(f.sent).toHaveBeenCalledTimes(1);
  expect(f.sent.mock.calls[0]?.[0]?.e2ee).toBe(true);
});
