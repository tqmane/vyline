import { afterAll, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.VYLINE_UNSEND_MEDIA_TEST_CHILD !== "1") {
  test("unsend media protection retains originals in an isolated process", async () => {
    const root = await fs.mkdtemp(join(tmpdir(), "vyline-unsend-media-"));
    try {
      const child = Bun.spawn([process.execPath, "test", fileURLToPath(import.meta.url)], {
        env: {
          ...process.env,
          VYLINE_UNSEND_MEDIA_TEST_CHILD: "1",
          VYLINE_UNSEND_MEDIA_TEST_ROOT: root,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
      expect(code).toBe(0);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
} else {
  const root = process.env.VYLINE_UNSEND_MEDIA_TEST_ROOT!;
  process.env.VYLINE_DATA_DIR = join(root, "data");
  process.env.VYLINE_STORAGE_DIR = join(root, "storage");
  process.env.VYLINE_MEDIA_STORAGE_DIR = join(root, "storage", "saved-media");
  process.env.VYLINE_MEDIA_INDEX_PATH = join(root, "storage", "media-index.sqlite");
  process.env.VYLINE_BACKUP_DIR = join(root, "data", "backups");
  process.env.VYLINE_MEDIA_STORAGE_MAX_OBJECT_BYTES = "128";

  const accountId = "unsend-media-account";
  const chatMid = "c-unsend-media";
  const chatStore = await import("../storage/chatStore.js");
  const mediaStorage = await import("../storage/mediaStorage.js");
  const clientManager = await import("../line/clientManager.js");
  const originalBytes = Uint8Array.from({ length: 96 }, (_, index) => (index * 13) & 0xff);
  const decryptedBytes = Uint8Array.from([101, 102, 103, 104]);
  let offline = false;
  let decryptUnavailable = false;
  let obsFetches = 0;
  let encryptedFetches = 0;
  let onObsFetch = () => {};
  const getClientSpy = spyOn(clientManager, "getClient").mockImplementation(
    () =>
      ({
        base: {
          profile: { mid: "u-self" },
          authToken: "test-token",
          request: { systemType: "TEST" },
          fetch: async () => {
            obsFetches++;
            onObsFetch();
            if (offline) throw new Error("fixture network disabled");
            let offset = 0;
            return new Response(
              new ReadableStream<Uint8Array>({
                pull(controller) {
                  if (offset === originalBytes.length) return controller.close();
                  const end = Math.min(offset + 7, originalBytes.length);
                  controller.enqueue(originalBytes.slice(offset, end));
                  offset = end;
                },
              }),
              { headers: { "Content-Type": "video/mp4", "Content-Length": "96" } },
            );
          },
          obs: {
            downloadMediaByE2EEToFile: async (
              _message: unknown,
              path: string,
              maxBytes: number,
              _signal: AbortSignal,
              beforeWrite: (nextTotalBytes: number, pendingBytes: number) => Promise<void>,
            ) => {
              encryptedFetches++;
              onObsFetch();
              if (offline) throw new Error("fixture network disabled");
              if (decryptUnavailable) throw new Error("fixture authenticated decryption failed");
              expect(maxBytes).toBe(128);
              await beforeWrite(decryptedBytes.length, decryptedBytes.length);
              await fs.writeFile(path, decryptedBytes);
              return { size: decryptedBytes.length };
            },
          },
        },
      }) as never,
  );
  const { enqueueUnsendMediaProtection } = await import("./unsendMediaProtection.js");
  const { lineRouter } = await import("../api/line.js");
  const storedMessage = (
    id: string,
    contentType: string,
    contentMetadata: Record<string, string> | null = null,
  ): Parameters<typeof chatStore.upsertMessages>[2][number] => ({
    id,
    chatMid,
    from: "u-sender",
    to: chatMid,
    text: null,
    contentType,
    createdTime: Date.now(),
    isMyMessage: false,
    contentMetadata,
    savedAt: new Date().toISOString(),
  });

  afterAll(async () => {
    getClientSpy.mockRestore();
    await chatStore.closeAccountChatDb(accountId);
    await mediaStorage.closeMediaStorage();
  });

  test("archives image/video originals and E2EE, then serves ranges offline after revoke/reopen", async () => {
    const messages = [
      storedMessage("plain-image", "IMAGE"),
      storedMessage("plain-video", "VIDEO"),
      storedMessage("encrypted-video", "VIDEO", {
        e2eeVersion: "2",
        keyMaterial: "fixture-media-key",
        OID: "encrypted-video",
        SID: "talk",
      }),
    ];
    await chatStore.upsertMessages(accountId, chatMid, messages);
    const completed = messages.map((message) =>
      enqueueUnsendMediaProtection(accountId, chatMid, message),
    );
    expect(enqueueUnsendMediaProtection(accountId, chatMid, messages[0]!)).toBe(completed[0]!);
    await Promise.all(completed);
    expect(obsFetches).toBe(2);
    expect(encryptedFetches).toBe(1);

    for (const message of messages) {
      await chatStore.markMessageRevoked(accountId, chatMid, message.id);
    }
    await chatStore.closeAccountChatDb(accountId);
    await mediaStorage.closeMediaStorage();
    offline = true;
    for (const message of messages) {
      const stored = await chatStore.findStoredMessageById(accountId, message.id);
      expect(stored?.message.revokedSnapshot?.contentType).toBe(message.contentType);
      const response = await lineRouter.request(
        `http://localhost/${accountId}/media/${chatMid}/${message.id}?preview=0`,
        { headers: { Range: "bytes=1-2" } },
      );
      expect(response.status).toBe(206);
      const bytes = message.id === "encrypted-video" ? decryptedBytes : originalBytes;
      expect(response.headers.get("content-range")).toBe(`bytes 1-2/${bytes.length}`);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes.slice(1, 3));
      await enqueueUnsendMediaProtection(accountId, chatMid, stored!.message);
    }
    expect(obsFetches).toBe(2);
    expect(encryptedFetches).toBe(1);
  });

  test("retries failed downloads and recognizes a revoked numeric media snapshot", async () => {
    const message = storedMessage("retry-video", "2");
    await chatStore.upsertMessages(accountId, chatMid, [message]);
    await chatStore.markMessageRevoked(accountId, chatMid, message.id);
    const revoked = (await chatStore.findStoredMessageById(accountId, message.id))!.message;
    offline = true;
    await expect(enqueueUnsendMediaProtection(accountId, chatMid, revoked)).rejects.toThrow(
      "fixture network disabled",
    );
    offline = false;
    await enqueueUnsendMediaProtection(accountId, chatMid, revoked);
    expect(await mediaStorage.statMediaStorage(accountId, chatMid, message.id)).toMatchObject({
      sizeBytes: originalBytes.length,
    });
  });

  test("never archives ciphertext after authenticated decryption fails, and retries later", async () => {
    const message = storedMessage("retry-encrypted", "VIDEO", {
      e2eeVersion: "2",
      keyMaterial: "fixture-media-key",
      OID: "retry-encrypted",
      SID: "talk",
    });
    await chatStore.upsertMessages(accountId, chatMid, [message]);
    const previousObsFetches = obsFetches;
    decryptUnavailable = true;
    await expect(enqueueUnsendMediaProtection(accountId, chatMid, message)).rejects.toThrow(
      "fixture authenticated decryption failed",
    );
    expect(await mediaStorage.statMediaStorage(accountId, chatMid, message.id)).toBeNull();
    expect(obsFetches).toBe(previousObsFetches);
    decryptUnavailable = false;
    await enqueueUnsendMediaProtection(accountId, chatMid, message);
    expect(await mediaStorage.statMediaStorage(accountId, chatMid, message.id)).toMatchObject({
      sizeBytes: decryptedBytes.length,
    });
    expect(obsFetches).toBe(previousObsFetches);
  });

  test("bounds active downloads and pending IDs, while excluding non-media", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let active = 0;
    let peak = 0;
    const statSpy = spyOn(mediaStorage, "statMediaStorage").mockImplementation(async () => {
      active++;
      peak = Math.max(peak, active);
      await gate;
      active--;
      return { path: "fixture", sizeBytes: 1, contentType: "video/mp4", mediaType: "video" };
    });
    const completions: Promise<void>[] = [];
    try {
      for (let index = 0; index < 1_024; index++) {
        completions.push(
          enqueueUnsendMediaProtection(accountId, chatMid, {
            id: `bounded-${index}`,
            contentType: "VIDEO",
          }),
        );
      }
      expect(peak).toBe(2);
      await enqueueUnsendMediaProtection(accountId, chatMid, { id: "text", contentType: "NONE" });
      await expect(
        enqueueUnsendMediaProtection(accountId, chatMid, {
          id: "overflow",
          contentType: "VIDEO",
        }),
      ).rejects.toThrow("queue is full");
    } finally {
      release();
      await Promise.all(completions);
      statSpy.mockRestore();
    }
    expect(peak).toBe(2);
  });

  test("starts saving an unopened received video before its cancellation event", async () => {
    const { processFetchedOperations } = await import("./lineService.js");
    const message = storedMessage("123456789", "VIDEO", {
      e2eeVersion: "2",
      keyMaterial: "fixture-media-key",
      OID: "123456789",
      SID: "talk",
    });
    offline = false;
    const started = new Promise<void>((resolve) => {
      onObsFetch = resolve;
    });
    try {
      await processFetchedOperations(accountId, [
        {
          type: 26,
          message: { ...message, createdTime: BigInt(message.createdTime), isMyMessage: undefined },
        },
      ]);
      await started;
      // Join the already-started background job before removing the remote source.
      await enqueueUnsendMediaProtection(accountId, chatMid, message);
      await processFetchedOperations(accountId, [{ type: 65, param2: message.id }]);
      const saved = await chatStore.findStoredMessageById(accountId, message.id);
      expect(saved?.message.revokedSnapshot?.contentType).toBe("VIDEO");
      expect(saved?.message.revokedSnapshot?.isMyMessage).toBe(false);
      offline = true;
      const response = await lineRouter.request(
        `http://localhost/${accountId}/media/${chatMid}/${message.id}?preview=0`,
      );
      expect(response.status).toBe(200);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(decryptedBytes);
      await enqueueUnsendMediaProtection(accountId, chatMid, saved!.message);
    } finally {
      onObsFetch = () => {};
    }
  });
}
