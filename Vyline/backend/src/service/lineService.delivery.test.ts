import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import * as manager from "../line/clientManager.js";
import * as storage from "../storage/chatStore.js";
import * as locks from "../storage/chatLockStore.js";
import * as tokens from "../storage/tokenStore.js";
import { silentlyUnsendMessage, unsendMessage } from "./lineService.js";

const now = 1_800_000_000_000;
const hour = 60 * 60 * 1000;
let premium = false;
let age = 23 * hour;
let missing = false;
let revoked = false;
let restores: Array<() => void> = [];
let unsend = mock(async (..._args: unknown[]) => {});
let silent = mock(async () => ({ silentUnsend: true }));
let marked = mock(async () => {});

beforeEach(() => {
  premium = false;
  age = 23 * hour;
  missing = false;
  revoked = false;
  unsend = mock(async (..._args: unknown[]) => {});
  silent = mock(async () => ({ silentUnsend: true }));
  marked = mock(async () => {});
  const client = {
    base: {
      profile: { mid: "u-self" },
      getReqseq: async () => 7,
      request: { request: async () => ({ active: premium }) },
      talk: { unsendMessage: unsend, silentlyUnsendMessage: silent },
    },
  } as unknown as NonNullable<ReturnType<typeof manager.getClient>>;
  const spies = [
    spyOn(Date, "now").mockReturnValue(now),
    spyOn(manager, "getClient").mockReturnValue(client),
    spyOn(locks, "isChatLocked").mockResolvedValue(false),
    spyOn(tokens, "updateSessionMeta").mockResolvedValue(),
    spyOn(storage, "findStoredMessageById").mockImplementation(async () => missing ? null : ({
      chatMid: "c-fixture",
      message: {
        id: "100", from: "u-self", to: "c-fixture", isMyMessage: true,
        createdTime: now - age, contentType: "NONE", text: "fixture",
        chatMid: "c-fixture", savedAt: new Date(now).toISOString(),
        messageState: revoked ? "revoked-by-self" : "normal",
      },
    })),
    spyOn(storage, "markMessageRevoked").mockImplementation(marked),
  ];
  restores = spies.map(spy => () => spy.mockRestore());
});

afterEach(() => { for (const restore of restores) restore(); });

for (const hours of [1, 23, 24]) {
  test(`ordinary ${hours}-hour unsend uses legacy transport and commits only after success`, async () => {
    age = hours * hour;
    await unsendMessage("delivery-fixture", "100");
    expect(unsend).toHaveBeenCalledWith({ seq: 7, messageId: "100" }, { legacy: true });
    expect(silent).not.toHaveBeenCalled();
    expect(marked).toHaveBeenCalledWith("delivery-fixture", "c-fixture", "100");
  });
}

test("expired, missing and already-revoked messages do not reach LINE", async () => {
  age = 24 * hour + 1;
  await expect(unsendMessage("delivery-fixture", "100")).rejects.toThrow("message too old");
  age = hour;
  missing = true;
  await expect(unsendMessage("delivery-fixture", "100")).rejects.toThrow("timestamp unavailable");
  missing = false;
  revoked = true;
  await expect(unsendMessage("delivery-fixture", "100")).rejects.toThrow("MESSAGE_ALREADY_REVOKED");
  expect(unsend).not.toHaveBeenCalled();
  expect(marked).not.toHaveBeenCalled();
});

test("premium seven-day unsend retains its native transport", async () => {
  premium = true;
  age = 7 * 24 * hour;
  await unsendMessage("delivery-fixture", "100");
  expect(unsend).toHaveBeenCalledWith({ seq: 7, messageId: "100" }, { legacy: false });
  age++;
  await expect(unsendMessage("delivery-fixture", "100")).rejects.toThrow("message too old");
  expect(unsend).toHaveBeenCalledTimes(1);
});

test("LINE rejection is propagated without persisting a successful unsend", async () => {
  unsend.mockRejectedValueOnce(new Error("MESSAGE_NOT_DESTRUCTIBLE: server refused"));
  await expect(unsendMessage("delivery-fixture", "100")).rejects.toThrow("server refused");
  expect(marked).not.toHaveBeenCalled();
});

test("mute send support does not unlock premium silent unsend", async () => {
  await expect(silentlyUnsendMessage("delivery-fixture", "100")).rejects.toThrow("PREMIUM_REQUIRED");
  expect(silent).not.toHaveBeenCalled();
  expect(marked).not.toHaveBeenCalled();
});
