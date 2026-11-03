import { afterAll, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (process.env.VYLINE_MEDIA_SAVE_TEST_CHILD !== "1") {
  test("media autosave ON/OFF and temporary streaming run in an isolated process", async () => {
    const root = await fs.mkdtemp(join(tmpdir(), "vyline-media-save-"));
    try {
      const child = Bun.spawn([process.execPath, "test", import.meta.path], {
        env: {
          ...process.env,
          VYLINE_MEDIA_SAVE_TEST_CHILD: "1",
          VYLINE_MEDIA_SAVE_TEST_ROOT: root,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out, err, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      if (code) throw new Error(out + err);
      console.info((out + err).match(/\d+ pass\s+\d+ fail\s+\d+ expect\(\) calls/)?.[0]);
      expect(code).toBe(0);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
} else {
  const root = process.env.VYLINE_MEDIA_SAVE_TEST_ROOT!;
  process.env.VYLINE_DATA_DIR = join(root, "data");
  process.env.VYLINE_STORAGE_DIR = join(root, "storage");
  process.env.VYLINE_MEDIA_STORAGE_DIR = join(root, "storage/saved-media");
  process.env.VYLINE_MEDIA_INDEX_PATH = join(root, "storage/media-index.sqlite");
  process.env.VYLINE_MEDIA_STORAGE_MAX_OBJECT_BYTES = "128";
  const chatStore = await import("../storage/chatStore.js");
  const mediaStorage = await import("../storage/mediaStorage.js");
  const settings = await import("./accountSettingsService.js");
  const temporary = await import("./mediaSaveTemporary.js");
  const manager = await import("../line/clientManager.js");
  const accountA = "media-account-a";
  const accountB = "media-account-b";
  const chat = "c-media-fixture";
  const midA = `u${"1".repeat(32)}`;
  const midB = `u${"2".repeat(32)}`;
  let pulls = 0;
  let e2eeDownloads = 0;
  let objectBytes = Uint8Array.from({ length: 96 }, (_, i) => i);
  const originalBytes = objectBytes;
  const decrypted = new Uint8Array([9, 8, 7, 6]);
  const clients = new Map<string, object>();
  for (const [account, mid] of [
    [accountA, midA],
    [accountB, midB],
    ["unknown-mid", ""],
  ])
    clients.set(account!, {
      base: {
        profile: { mid },
        authToken: "synthetic-fixture-token",
        request: { systemType: "TEST" },
        fetch: async () => {
          let offset = 0;
          const response = new Response(
            new ReadableStream<Uint8Array>({
              pull(controller) {
                pulls++;
                if (offset >= objectBytes.length) {
                  controller.close();
                  return;
                }
                controller.enqueue(objectBytes.slice(offset, offset + 7));
                offset += 7;
              },
            }),
            {
              headers: {
                "content-type": "video/mp4",
                "content-length": String(objectBytes.length),
              },
            },
          );
          response.arrayBuffer = async () => {
            throw new Error("must stream, never buffer the original");
          };
          return response;
        },
        obs: {
          downloadMediaByE2EEToFile: async (
            _message: unknown,
            path: string,
            _max: number,
            _signal: AbortSignal,
            beforeWrite: (total: number, bytes: number) => Promise<void>,
          ) => {
            e2eeDownloads++;
            await beforeWrite(decrypted.length, decrypted.length);
            await fs.writeFile(path, decrypted);
            return { size: decrypted.length };
          },
        },
      },
    });
  const clientSpy = spyOn(manager, "getClient").mockImplementation(
    (account) => clients.get(account) as never,
  );
  const { lineRouter } = await import("../api/line.js");
  const { accountSettingsRouter } = await import("../api/accountSettings.js");
  async function message(account: string, id: string, encrypted = false, isMyMessage = false) {
    await chatStore.upsertMessages(account, chat, [
      {
        id,
        chatMid: chat,
        to: chat,
        from: "u-fixture",
        text: null,
        contentType: "VIDEO",
        createdTime: Date.now(),
        isMyMessage,
        savedAt: new Date().toISOString(),
        contentMetadata: encrypted
          ? { e2eeVersion: "2", keyMaterial: "synthetic-key-material", OID: id, SID: "talk" }
          : {},
      },
    ]);
  }
  const request = (account: string, id: string, range?: string, preview = "0") =>
    lineRouter.request(
      `http://localhost/${account}/media/${chat}/${id}?preview=${preview}`,
      range ? { headers: { Range: range } } : {},
    );
  const tempDirs = async () => fs.readdir(join(root, "data/tmp/media-display")).catch(() => []);
  afterAll(async () => {
    clientSpy.mockRestore();
    for (const account of clients.keys()) await chatStore.closeAccountChatDb(account);
    await mediaStorage.closeMediaStorage();
  });

  test("default ON stores original media with streaming and keeps Range bounds", async () => {
    await message(accountB, "default-on");
    const response = await request(accountB, "default-on", "bytes=11-26");
    expect(response.status).toBe(206);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(objectBytes.slice(11, 27));
    expect(await mediaStorage.statMediaStorage(accountB, chat, "default-on")).toMatchObject({
      sizeBytes: 96,
    });
  });
  test("OFF uses a streamed temporary original, supports Range and leaves no saved file", async () => {
    const saved = await accountSettingsRouter.request(`/${midA}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ storage: { autoDownload: false, mediaAutoSave: false } }),
    });
    expect(saved.status).toBe(200);
    await message(accountA, "off-video");
    const response = await request(accountA, "off-video", "bytes=11-26");
    expect(response.status).toBe(206);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-range")).toBe("bytes 11-26/96");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(objectBytes.slice(11, 27));
    expect(await mediaStorage.statMediaStorage(accountA, chat, "off-video")).toBeNull();
    expect(await tempDirs()).toEqual([]);
    expect(pulls).toBeGreaterThan(1);
  });
  test("explicit browser download uses the same original URL and still works with OFF", async () => {
    await message(accountA, "manual-download");
    const response = await request(accountA, "manual-download");
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(objectBytes);
    expect(await mediaStorage.statMediaStorage(accountA, chat, "manual-download")).toBeNull();
    expect(await tempDirs()).toEqual([]);
  });
  test("OFF survives a fresh backend process", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "-e",
        `const { loadAccountSettings } = await import('./accountSettingsService.ts'); if ((await loadAccountSettings('${midA}')).storage.mediaAutoSave !== false) process.exit(1);`,
      ],
      {
        cwd: import.meta.dir,
        env: { ...process.env },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(await child.exited).toBe(0);
  });
  test("E2EE preview and original use the authenticated file producer without permanent writes", async () => {
    for (const preview of ["1", "0"]) {
      const id = `encrypted-off-${preview}`;
      await message(accountA, id, true);
      const response = await request(accountA, id, "bytes=1-2", preview);
      expect(response.status).toBe(206);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(decrypted.slice(1, 3));
      expect(await mediaStorage.statMediaStorage(accountA, chat, id)).toBeNull();
      expect(await tempDirs()).toEqual([]);
    }
    expect(e2eeDownloads).toBe(2);
  });
  test("OFF reuses existing originals and does not delete them", async () => {
    await mediaStorage.writeMediaStorage(accountA, chat, "existing", objectBytes, "video/mp4");
    const before = pulls;
    expect(new Uint8Array(await (await request(accountA, "existing")).arrayBuffer())).toEqual(
      objectBytes,
    );
    expect(pulls).toBe(before);
    expect(await mediaStorage.statMediaStorage(accountA, chat, "existing")).not.toBeNull();
  });
  test("re-enabling one MID persists again while another account retains its default", async () => {
    await settings.saveAccountSettings(midA, {
      storage: { autoDownload: false, mediaAutoSave: true },
    });
    await message(accountA, "enabled-again");
    await (await request(accountA, "enabled-again")).arrayBuffer();
    expect(await mediaStorage.statMediaStorage(accountA, chat, "enabled-again")).not.toBeNull();
    expect((await settings.loadAccountSettings(midB)).storage.mediaAutoSave).toBe(true);
    await settings.saveAccountSettings(midA, {
      storage: { autoDownload: false, mediaAutoSave: false },
    });
  });
  test("a legacy owner without MID keeps the existing default ON", async () => {
    await message("unknown-mid", "no-owner");
    const response = await request("unknown-mid", "no-owner");
    expect(response.status).toBe(200);
    await response.arrayBuffer();
    expect(await mediaStorage.statMediaStorage("unknown-mid", chat, "no-owner")).not.toBeNull();
    expect(await tempDirs()).toEqual([]);
  });
  test("invalid Range and cancelled readers clean temporary files", async () => {
    await message(accountA, "bad-range");
    const invalid = await request(accountA, "bad-range", "bytes=999-");
    expect(invalid.status).toBe(416);
    expect(await tempDirs()).toEqual([]);
    await message(accountA, "cancelled");
    const response = await request(accountA, "cancelled");
    await response.body!.cancel();
    expect(await tempDirs()).toEqual([]);
    await message(accountA, "aborted-before-response");
    const controller = new AbortController();
    controller.abort();
    const aborted = await lineRouter.request(
      `http://localhost/${accountA}/media/${chat}/aborted-before-response?preview=0`,
      { signal: controller.signal },
    );
    expect(aborted.status).toBe(499);
    expect(await tempDirs()).toEqual([]);
  });
  test("temporary object-size limits stay active and failed production is removed", async () => {
    await message(accountA, "oversized");
    objectBytes = new Uint8Array(129);
    try {
      const response = await request(accountA, "oversized");
      expect(response.status).toBe(413);
      expect(await tempDirs()).toEqual([]);
      expect(await mediaStorage.statMediaStorage(accountA, chat, "oversized")).toBeNull();
    } finally {
      objectBytes = originalBytes;
    }
  });
  test("temporary streams reject unknown-length overflow, short bodies and invalid progress", async () => {
    for (const response of [
      new Response(new Uint8Array(129)),
      new Response(decrypted, { headers: { "content-length": "8" } }),
    ]) {
      await expect(
        temporary.streamTemporaryMessageMedia(
          accountA,
          chat,
          "invalid",
          "video/mp4",
          5000,
          async () => response,
        ),
      ).rejects.toThrow();
      expect(await tempDirs()).toEqual([]);
    }
    await expect(
      temporary.produceTemporaryMessageMedia(accountA, "video/mp4", 5000, async (_path, guard) => {
        await guard.beforeWrite(4, 3);
        return 4;
      }),
    ).rejects.toThrow("progress");
    expect(await tempDirs()).toEqual([]);
  });
  test("temporary media work is capped and a released response makes room again", async () => {
    const create = () =>
      temporary.produceTemporaryMessageMedia(accountA, "video/mp4", 5000, async (path, guard) => {
        await guard.beforeWrite(decrypted.length, decrypted.length);
        await fs.writeFile(path, decrypted);
        return decrypted.length;
      });
    const media = await Promise.all(Array.from({ length: 4 }, create));
    try {
      await expect(create()).rejects.toBeInstanceOf(mediaStorage.MediaStorageBusyError);
    } finally {
      await Promise.all(media.map((item) => item.cleanup()));
    }
    const next = await create();
    await next.cleanup();
    expect(await tempDirs()).toEqual([]);
  });
  test("expired crash leftovers are swept without removing unrelated files", async () => {
    const expired = join(root, "data/tmp/media-display/display-1111111111111111-oldfixture");
    const unrelated = join(root, "data/tmp/media-display/unrelated");
    await fs.mkdir(expired);
    await fs.writeFile(join(expired, "body"), decrypted);
    await fs.mkdir(unrelated);
    const old = new Date(Date.now() - 2 * 60 * 60_000);
    await fs.utimes(expired, old, old);
    const actualNow = Date.now;
    const clock = spyOn(Date, "now").mockImplementation(() => actualNow() + 60_001);
    try {
      const media = await temporary.produceTemporaryMessageMedia(
        accountA,
        "video/mp4",
        5000,
        async (path, guard) => {
          await guard.beforeWrite(4, 4);
          await fs.writeFile(path, decrypted);
          return 4;
        },
      );
      await media.cleanup();
      expect(
        await fs.access(expired).then(
          () => true,
          () => false,
        ),
      ).toBe(false);
      expect(await tempDirs()).toEqual(["unrelated"]);
    } finally {
      clock.mockRestore();
      await fs.rm(unrelated, { recursive: true, force: true });
    }
  });
  test("failed authenticated producers and storage capacity errors do not leave plaintext", async () => {
    await expect(
      temporary.produceTemporaryMessageMedia(accountA, "video/mp4", 5000, async (path, guard) => {
        await guard.beforeWrite(4, 4);
        await fs.writeFile(path, decrypted);
        throw new Error("bad authentication tag");
      }),
    ).rejects.toThrow("authentication");
    expect(await tempDirs()).toEqual([]);
    const capacitySpy = spyOn(mediaStorage, "mediaCapacityReservation").mockImplementation(() => ({
      bytes: 0,
      increase: async () => {
        throw new mediaStorage.MediaStorageCapacityError();
      },
      consume: () => {},
      release: () => {},
    }));
    try {
      await expect(
        temporary.produceTemporaryMessageMedia(
          accountA,
          "video/mp4",
          5000,
          async (_path, guard) => {
            await guard.beforeWrite(4, 4);
            return 4;
          },
        ),
      ).rejects.toBeInstanceOf(mediaStorage.MediaStorageCapacityError);
      expect(await tempDirs()).toEqual([]);
    } finally {
      capacitySpy.mockRestore();
    }
  });
  test("revoked media uses only its received snapshot within the requested chat and preserves restore/delete", async () => {
    const lineService = await import("./lineService.js");
    const fetchMedia = spyOn(lineService, "fetchMessageMedia");
    const source = manager.getClient(accountA)!.base.obs;
    const originalDownload = source.downloadMediaByE2EEToFile;
    const observed: Array<Parameters<typeof originalDownload>[0]> = [];
    const download = spyOn(source, "downloadMediaByE2EEToFile").mockImplementation(
      (original, ...args) => {
        observed.push(original);
        return originalDownload(original, ...args);
      },
    );
    try {
      for (const encrypted of [false, true]) {
        const id = `received-revoked-${encrypted}`;
        await chatStore.upsertMessages(accountA, "c-other", [
          {
            id,
            chatMid: "c-other",
            to: "c-other",
            from: "u-other",
            contentType: "IMAGE",
            contentMetadata: { OID: "wrong-chat-object" },
            text: null,
            createdTime: Date.now(),
            isMyMessage: false,
            savedAt: new Date().toISOString(),
          },
        ]);
        await message(accountA, id, encrypted, encrypted);
        await chatStore.markMessageRevoked(accountA, chat, id);
        const saved = (await chatStore.getStoredMessagesByIds(accountA, chat, [id]))[0]!;
        expect(saved.contentType).toBe("UNSENT");
        expect(saved.revokedSnapshot?.contentType).toBe("VIDEO");
        fetchMedia.mockClear();
        const response = await request(accountA, id, "bytes=1-2");
        expect(response.status).toBe(206);
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(
          (encrypted ? decrypted : objectBytes).slice(1, 3),
        );
        if (encrypted) {
          expect(observed.at(-1)?.contentType).toBe("VIDEO");
          expect(observed.at(-1)?.contentMetadata).toEqual({
            e2eeVersion: "2",
            keyMaterial: "synthetic-key-material",
            OID: id,
            SID: "talk",
          });
        } else expect(fetchMedia).not.toHaveBeenCalled();
        expect((await chatStore.getStoredMessagesByIds(accountA, chat, [id]))[0]).toEqual(saved);
        if (encrypted) {
          await chatStore.restoreRevokedMessage(accountA, chat, id);
          expect(
            (await chatStore.getStoredMessagesByIds(accountA, chat, [id]))[0]?.contentType,
          ).toBe("VIDEO");
          await chatStore.markMessageRevoked(accountA, chat, id);
        }
        expect(await chatStore.deleteLocalRevokedMessage(accountA, chat, id)).toBe(true);
        await expect(
          lineService.fetchMessageMedia(accountA, chat, id, false, false),
        ).rejects.toThrow("deleted locally");
      }
      await chatStore.upsertMessages(accountA, chat, [
        {
          id: "unreceived-revoke",
          chatMid: chat,
          to: chat,
          from: "u-fixture",
          contentType: "UNSENT",
          contentMetadata: {},
          text: null,
          createdTime: Date.now(),
          isMyMessage: false,
          savedAt: new Date().toISOString(),
        },
      ]);
      await expect(
        lineService.fetchMessageMedia(accountA, chat, "unreceived-revoke", false, false),
      ).rejects.toThrow("saved revoked media");
      expect(await tempDirs()).toEqual([]);
    } finally {
      fetchMedia.mockRestore();
      download.mockRestore();
    }
  });
}
