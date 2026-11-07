import { afterEach, expect, mock, spyOn, test } from "bun:test";
import * as protocol from "@vyline/protocol";
import { InternalError } from "@vyline/protocol/stack/base";
import * as manager from "../line/clientManager.js";
import * as locks from "../storage/chatLockStore.js";
import * as mediaStorage from "../storage/mediaStorage.js";
import { sendMedia, sendMediaBatch, sendMessage } from "./lineService.js";

afterEach(() => mock.restore());

function fixture() {
  const chatMid = `c${crypto.randomUUID().replaceAll("-", "")}`;
  const last = mock(async () => ({ groupKeyId: 7 }));
  const sent = mock(async (_request: Record<string, unknown>) => null);
  const rawUpload = mock(async () => ({ objId: "synthetic-object", objHash: "" }));
  const rawBatch = mock(async () => []);
  const encryptedUpload = mock(async () => ({ id: "synthetic-encrypted" }));
  const client = {
    base: {
      profile: { mid: `u${"1".repeat(32)}` },
      talk: {
        getLastE2EEGroupSharedKey: last,
        sendMessage: sent,
        determineMediaMessageFlow: async () => ({ flowMap: { "14": 2 } }),
      },
      obs: {
        uploadObjTalk: rawUpload,
        uploadObjTalkBatch: rawBatch,
        uploadMediaByE2EEFromFile: encryptedUpload,
      },
    },
  } as unknown as protocol.VylineClient;
  spyOn(manager, "getClient").mockReturnValue(client);
  spyOn(locks, "isChatLocked").mockResolvedValue(false);
  spyOn(mediaStorage, "importMediaStorageFile").mockResolvedValue(true);
  const identity = spyOn(protocol, "ensureValidE2EEIdentity").mockResolvedValue({} as never);
  spyOn(protocol, "ensureGroupKeyById").mockResolvedValue({
    keyId: 7,
    privKey: "synthetic-unused",
  });
  const recreate = spyOn(protocol, "recreateE2EEGroupKey").mockResolvedValue({
    keyId: 8,
    privKey: "synthetic-unused",
  });
  const encrypt = spyOn(protocol, "encryptLetterSealingMessage").mockResolvedValue({
    contentMetadata: { e2eeVersion: "2" },
    chunks: [],
  } as never);
  const error = (code: string | number, method = "getLastE2EEGroupSharedKey") =>
    new InternalError("RequestError", `Request internal failed, ${method}(/S4)`, { code });
  return {
    chatMid,
    last,
    sent,
    recreate,
    identity,
    encrypt,
    error,
    rawUpload,
    rawBatch,
    encryptedUpload,
  };
}

for (const code of [98, "E2EE_RETRY_PLAIN"] as const)
  test(`group send recognizes structured retry-plain ${code}`, async () => {
    const f = fixture();
    f.last.mockRejectedValue(f.error(code));
    await sendMessage("group-wire-error", f.chatMid, "synthetic fixture", { mute: true });
    expect(f.sent).toHaveBeenCalledTimes(1);
    expect(f.sent.mock.calls[0]?.[0]).toMatchObject({
      to: f.chatMid,
      text: "synthetic fixture",
      e2ee: false,
      contentMetadata: { NOTIFICATION_DISABLED: "true" },
    });
    expect(f.recreate).not.toHaveBeenCalled();
  });

test("structured missing group key registers once and keeps the encrypted send", async () => {
  const f = fixture();
  f.last.mockRejectedValue(f.error(5));
  await sendMessage("group-wire-missing", f.chatMid, "synthetic fixture");
  expect(f.recreate).toHaveBeenCalledTimes(1);
  expect(f.sent).toHaveBeenCalledTimes(1);
  expect(f.sent.mock.calls[0]?.[0]?.e2ee).toBe(true);
});

for (const code of [83, 99] as const)
  test(`structured E2EE ${code} retries the encrypted send once`, async () => {
    const f = fixture();
    f.sent.mockRejectedValueOnce(f.error(code, "sendMessage"));
    await sendMessage("group-wire-retry", f.chatMid, "synthetic fixture");
    expect(f.sent).toHaveBeenCalledTimes(2);
    expect(f.sent.mock.calls.every(([request]) => request.e2ee === true)).toBe(true);
    if (code === 83)
      expect(f.identity.mock.calls.some(([, options]) => options?.forceNewSenderKey === true)).toBe(
        true,
      );
    else expect(f.recreate).toHaveBeenCalledTimes(1);
  });

test("a rejected group-key request is not retried as plaintext", async () => {
  const f = fixture();
  const error = f.error("NOT_A_MEMBER");
  f.last.mockRejectedValue(error);
  await expect(sendMessage("group-wire-denied", f.chatMid, "synthetic fixture")).rejects.toBe(
    error,
  );
  expect(f.sent).not.toHaveBeenCalled();
  expect(f.recreate).not.toHaveBeenCalled();
});

test("a rejected key lookup after warmup cannot downgrade the group send to plaintext", async () => {
  const f = fixture();
  const error = f.error("NOT_A_MEMBER");
  f.encrypt.mockRejectedValue(error);
  await expect(
    sendMessage("group-wire-cached-denied", f.chatMid, "synthetic fixture"),
  ).rejects.toBe(error);
  expect(f.sent).not.toHaveBeenCalled();
});

test("a failed group-key recreation is propagated without a plaintext retry", async () => {
  const f = fixture();
  const error = f.error("NOT_A_MEMBER", "registerE2EEGroupSharedKey");
  f.sent.mockRejectedValueOnce(f.error(99, "sendMessage"));
  f.recreate.mockRejectedValue(error);
  await expect(
    sendMessage("group-wire-repair-denied", f.chatMid, "synthetic fixture"),
  ).rejects.toBe(error);
  expect(f.sent).toHaveBeenCalledTimes(1);
  expect(f.sent.mock.calls[0]?.[0]?.e2ee).toBe(true);
});

for (const batch of [false, true])
  test(`group ${batch ? "batch" : "single"} media rejects key permission errors without raw OBS`, async () => {
    const f = fixture();
    const error = f.error("NOT_A_MEMBER");
    f.last.mockRejectedValue(error);
    // Read this local fixture only; every OBS method and cache write is mocked.
    const item = {
      path: import.meta.path,
      sizeBytes: Bun.file(import.meta.path).size,
      mimeType: "application/octet-stream",
      mediaType: "file" as const,
      filename: "fixture.bin",
    };
    const sending = batch
      ? sendMediaBatch("group-media-denied", f.chatMid, [item])
      : sendMedia("group-media-denied", f.chatMid, item, item);
    await expect(sending).rejects.toBe(error);
    expect(f.rawUpload).not.toHaveBeenCalled();
    expect(f.rawBatch).not.toHaveBeenCalled();
    expect(f.encryptedUpload).not.toHaveBeenCalled();
    expect(f.recreate).not.toHaveBeenCalled();
  });

test("a local self-key failure cannot cache plaintext for the next group send", async () => {
  const f = fixture();
  const error = new Error("NoE2EEKey: local self key not found");
  f.encrypt.mockRejectedValue(error);
  for (let attempt = 0; attempt < 2; attempt++)
    await expect(
      sendMessage("group-local-key-failure", f.chatMid, "synthetic fixture"),
    ).rejects.toBe(error);
  expect(f.encrypt).toHaveBeenCalledTimes(2);
  expect(f.sent).not.toHaveBeenCalled();
});

test("preflight missing key followed by structured register retry-plain permits the requested plain send", async () => {
  const f = fixture();
  f.last.mockRejectedValue(f.error(5));
  f.recreate.mockRejectedValue(f.error(98, "registerE2EEGroupSharedKey"));
  await sendMessage("group-register-retry-plain", f.chatMid, "synthetic fixture", { mute: true });
  expect(f.recreate).toHaveBeenCalledTimes(1);
  expect(f.sent).toHaveBeenCalledTimes(1);
  expect(f.sent.mock.calls[0]?.[0]).toMatchObject({
    to: f.chatMid,
    text: "synthetic fixture",
    e2ee: false,
    contentMetadata: { NOTIFICATION_DISABLED: "true" },
  });
  expect(f.encrypt).not.toHaveBeenCalled();
});
