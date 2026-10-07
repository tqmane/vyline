import { afterAll, afterEach, expect, mock, spyOn, test } from "bun:test";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import * as fs from "node:fs/promises";

if (!process.env.VYLINE_ISOLATED_MEDIA_CACHE_TEST) {
  test("video and image cache compatibility in an isolated process", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, VYLINE_ISOLATED_MEDIA_CACHE_TEST: "1" },
      stdout: "pipe", stderr: "pipe",
    });
    const [code, out, err] = await Promise.all([child.exited,
      new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code) throw new Error(out + err);
    expect(code).toBe(0);
  });
} else {
const root = await mkdtemp(join(tmpdir(), "vyline-line-video-cache-"));
process.env.VYLINE_DATA_DIR = join(root, "data");
process.env.VYLINE_STORAGE_DIR = join(root, "storage");
process.env.VYLINE_MEDIA_STORAGE_DIR = join(root, "storage", "saved-media");
process.env.VYLINE_MEDIA_INDEX_PATH = join(root, "storage", "media-index.sqlite");

const chatStore = await import("../storage/chatStore.js");
const mediaStorage = await import("../storage/mediaStorage.js");
const lineService = await import("../service/lineService.js");
const { lineRouter } = await import("./lineMediaCompat.js");
const { Hono } = await import("hono");
const { cors } = await import("hono/cors");

const accountId = "legacy-video-cache";
const chatMid = "c-video-cache";

afterEach(() => mock.restore());
afterAll(async () => {
  await chatStore.closeAccountChatDb(accountId);
  await mediaStorage.closeMediaStorage();
  await rm(root, { recursive: true, force: true });
});

test("cached media keeps nonzero Range bounds through CORS and real HTTP", async () => {
  const id = "range-http-fixture";
  const bytes = Buffer.alloc(400000);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 29 + (i >>> 8)) % 251;
  await mediaStorage.writeMediaStorage(accountId, chatMid, id, bytes, "video/mp4");
  const app = new Hono();
  app.use("*", cors());
  app.route("/", lineRouter);
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch });
  try {
    const response = await fetch(new URL(`/${accountId}/media/${chatMid}/${id}?preview=0`, server.url), {
      headers: { Range: "bytes=327680-" }, signal: AbortSignal.timeout(5000),
    });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 327680-399999/400000");
    const length = response.headers.get("content-length");
    if (length !== null) expect(length).toBe("72320");
    else expect(response.headers.get("transfer-encoding")).toBe("chunked");
    expect(Buffer.from(await response.arrayBuffer()).equals(bytes.subarray(327680))).toBe(true);
  } finally { server.stop(true); }
});

test("original video request evicts a legacy preview image cached under the media key", async () => {
  const messageId = "m-video-cache";
  await chatStore.upsertMessages(accountId, chatMid, [
    {
      id: messageId,
      chatMid,
      from: "u-peer",
      to: "u-self",
      text: null,
      contentType: "VIDEO",
      createdTime: Date.now(),
      isMyMessage: false,
      contentMetadata: {},
      savedAt: new Date().toISOString(),
    },
  ]);

  // This is the state left by older builds: thumbnail bytes occupy the original key.
  await mediaStorage.writeMediaStorage(
    accountId,
    chatMid,
    messageId,
    new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    "image/jpeg",
  );
  expect((await mediaStorage.statMediaStorage(accountId, chatMid, messageId))?.mediaType).toBe("image");

  spyOn(lineService, "fetchPlainMessageMediaToStorage").mockResolvedValue(null);
  const fetchMedia = spyOn(lineService, "fetchMessageMedia").mockResolvedValue({
    bytes: new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]),
    contentType: "video/mp4",
  });

  const response = await lineRouter.request(
    `http://localhost/${accountId}/media/${chatMid}/${messageId}?preview=0`,
  );

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("video/mp4");
  expect(fetchMedia).toHaveBeenCalledTimes(1);
  expect(await mediaStorage.statMediaStorage(accountId, chatMid, messageId)).toMatchObject({
    mediaType: "video",
    contentType: "video/mp4",
    sizeBytes: 8,
  });
});

test("preview request keeps the legacy thumbnail until an original video is requested", async () => {
  const messageId = "m-video-preview";
  await chatStore.upsertMessages(accountId, chatMid, [
    {
      id: messageId,
      chatMid,
      from: "u-peer",
      to: "u-self",
      text: null,
      contentType: "VIDEO",
      createdTime: Date.now(),
      isMyMessage: false,
      contentMetadata: {},
      savedAt: new Date().toISOString(),
    },
  ]);
  const thumbnail = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  await mediaStorage.writeMediaStorage(accountId, chatMid, messageId, thumbnail, "image/jpeg");

  const fetchMedia = spyOn(lineService, "fetchMessageMedia");
  const response = await lineRouter.request(
    `http://localhost/${accountId}/media/${chatMid}/${messageId}?preview=1`,
  );

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/jpeg");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(thumbnail);
  expect(fetchMedia).not.toHaveBeenCalled();
  expect((await mediaStorage.statMediaStorage(accountId, chatMid, messageId))?.mediaType).toBe("image");
});

test("an original image request replaces a legacy thumbnail once and reuses the verified original", async () => {
  const id = "legacy-image";
  await chatStore.upsertMessages(accountId, chatMid, [{ id, chatMid, from: "u-peer", to: "u-self",
    text: null, contentType: "IMAGE", createdTime: Date.now(), isMyMessage: false,
    contentMetadata: {}, savedAt: new Date().toISOString() }]);
  const thumbnail = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  await mediaStorage.writeMediaStorage(accountId, chatMid, id, thumbnail, "image/jpeg");
  const index = new Database(process.env.VYLINE_MEDIA_INDEX_PATH!);
  // Simulate an entry written before provenance was recorded, on either schema.
  if (index.query("SELECT name FROM pragma_table_info('media_index') WHERE name='original_verified'").get())
    index.query("UPDATE media_index SET original_verified=0 WHERE message_id=?").run(id);
  index.close();
  spyOn(lineService, "fetchPlainMessageMediaToStorage").mockResolvedValue(null);
  const original = new Uint8Array([0xff, 0xd8, 0, 1, 2, 3, 0xff, 0xd9]);
  const fetch = spyOn(lineService, "fetchMessageMedia").mockResolvedValue({ bytes: original, contentType: "image/jpeg" });
  const url = `http://localhost/${accountId}/media/${chatMid}/${id}?preview=0`;
  const first = await lineRouter.request(url);
  expect(new Uint8Array(await first.arrayBuffer())).toEqual(original);
  const second = await lineRouter.request(url);
  expect(new Uint8Array(await second.arrayBuffer())).toEqual(original);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("a failed legacy-image refresh keeps the stored bytes available for preview", async () => {
  const id = "legacy-image-failure";
  await chatStore.upsertMessages(accountId, chatMid, [{ id, chatMid, from: "u-peer", to: "u-self",
    text: null, contentType: "IMAGE", createdTime: Date.now(), isMyMessage: false,
    contentMetadata: {}, savedAt: new Date().toISOString() }]);
  const thumbnail = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  await mediaStorage.writeMediaStorage(accountId, chatMid, id, thumbnail, "image/jpeg");
  const index = new Database(process.env.VYLINE_MEDIA_INDEX_PATH!);
  if (index.query("SELECT name FROM pragma_table_info('media_index') WHERE name='original_verified'").get())
    index.query("UPDATE media_index SET original_verified=0 WHERE message_id=?").run(id);
  index.close();
  spyOn(lineService, "fetchPlainMessageMediaToStorage").mockResolvedValue(null);
  spyOn(lineService, "fetchMessageMedia").mockRejectedValue(new Error("unavailable"));
  const url = `http://localhost/${accountId}/media/${chatMid}/${id}`;
  expect((await lineRouter.request(`${url}?preview=0`)).status).toBe(422);
  const preview = await lineRouter.request(`${url}?preview=1`);
  expect(new Uint8Array(await preview.arrayBuffer())).toEqual(thumbnail);
});

test("the streaming writer replaces an unverified image instead of reusing its old preview", async () => {
  const id = "legacy-stream-image";
  await chatStore.upsertMessages(accountId, chatMid, [{ id, chatMid, from: "u-peer", to: "u-self",
    text: null, contentType: "IMAGE", createdTime: Date.now(), isMyMessage: false,
    contentMetadata: {}, savedAt: new Date().toISOString() }]);
  await mediaStorage.writeMediaStorage(accountId, chatMid, id, new Uint8Array([1, 2]), "image/jpeg");
  const index = new Database(process.env.VYLINE_MEDIA_INDEX_PATH!);
  index.query("UPDATE media_index SET original_verified=0 WHERE message_id=?").run(id);
  index.close();
  const bytes = new Uint8Array([3, 4, 5, 6]);
  const fetch = spyOn(lineService, "fetchPlainMessageMediaToStorage").mockImplementation(() =>
    mediaStorage.writeMediaStorageStream(accountId, chatMid, id,
      new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }), "image/jpeg", bytes.length));
  const url = `http://localhost/${accountId}/media/${chatMid}/${id}?preview=0`;
  expect(new Uint8Array(await (await lineRouter.request(url)).arrayBuffer())).toEqual(bytes);
  expect(new Uint8Array(await (await lineRouter.request(url)).arrayBuffer())).toEqual(bytes);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect((await mediaStorage.readMediaStorage(accountId, chatMid, id))?.buf).toEqual(bytes);
});

test("an imported upload original stays available without upstream access", async () => {
  const id = "uploaded-original";
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const source = join(root, "upload.jpg");
  await writeFile(source, bytes);
  await chatStore.upsertMessages(accountId, chatMid, [{ id, chatMid, from: "u-self", to: "u-peer",
    text: null, contentType: "IMAGE", createdTime: Date.now(), isMyMessage: true,
    contentMetadata: {}, savedAt: new Date().toISOString() }]);
  await mediaStorage.importMediaStorageFile(accountId, chatMid, id, source, "image/jpeg", true);
  const fetch = spyOn(lineService, "fetchPlainMessageMediaToStorage").mockRejectedValue(new Error("404"));
  const response = await lineRouter.request(`http://localhost/${accountId}/media/${chatMid}/${id}?preview=0`);
  expect(response.status).toBe(200);
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  expect(fetch).not.toHaveBeenCalled();
});

for (const writer of ["stream", "produced"] as const) {
  test(`${writer} replacement preserves the old image if index commit fails`, async () => {
    const id = `rollback-${writer}`;
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await mediaStorage.writeMediaStorage(accountId, chatMid, id, bytes, "image/jpeg");
    const previous = await mediaStorage.statMediaStorage(accountId, chatMid, id);
    const index = new Database(process.env.VYLINE_MEDIA_INDEX_PATH!);
    index.query("UPDATE media_index SET original_verified=0 WHERE message_id=?").run(id);
    index.exec(`CREATE TRIGGER reject_${writer} BEFORE UPDATE ON media_index WHEN NEW.message_id='${id}' BEGIN SELECT RAISE(FAIL, 'fixture index failure'); END`);
    const replacement = new Uint8Array([5, 6, 7, 8]);
    try {
      const writing = writer === "stream"
        ? mediaStorage.writeMediaStorageStream(accountId, chatMid, id,
          new ReadableStream({ start(c) { c.enqueue(replacement); c.close(); } }), "image/jpeg", replacement.length)
        : mediaStorage.writeMediaStorageProducedFile(accountId, chatMid, id, "image/jpeg", async (path, guard) => {
          await guard.beforeWrite(replacement.length, replacement.length);
          await writeFile(path, replacement);
          return replacement.length;
        });
      await expect(writing).rejects.toThrow("fixture index failure");
      expect(new Uint8Array(await readFile(previous!.path))).toEqual(bytes);
    } finally { index.exec(`DROP TRIGGER reject_${writer}`); index.close(); }
  });
  test(`${writer} rename failure preserves the old index and backup entry`, async () => {
    const id = `rename-${writer}`;
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await mediaStorage.writeMediaStorage(accountId, chatMid, id, bytes, "image/jpeg");
    const previous = await mediaStorage.statMediaStorage(accountId, chatMid, id);
    const index = new Database(process.env.VYLINE_MEDIA_INDEX_PATH!);
    index.query("UPDATE media_index SET original_verified=0 WHERE message_id=?").run(id);
    const rename = fs.rename;
    const injection = spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (String(from).endsWith(".partial") && String(to).endsWith(".jpg")) throw new Error("fixture promotion failure");
      await rename(from, to);
    });
    try {
      const replacement = new Uint8Array([5, 6, 7, 8]);
      const writing = writer === "stream"
        ? mediaStorage.writeMediaStorageStream(accountId, chatMid, id,
          new ReadableStream({ start(c) { c.enqueue(replacement); c.close(); } }), "image/jpeg", replacement.length)
        : mediaStorage.writeMediaStorageProducedFile(accountId, chatMid, id, "image/jpeg", async (path, guard) => {
          await guard.beforeWrite(replacement.length, replacement.length);
          await writeFile(path, replacement);
          return replacement.length;
        });
      await expect(writing).rejects.toThrow("fixture promotion failure");
      expect(new Uint8Array(await readFile(previous!.path))).toEqual(bytes);
      expect(index.query("SELECT message_id FROM media_index WHERE message_id=?").get(id)).not.toBeNull();
      const entries = [];
      for await (const entry of mediaStorage.iterateAccountMediaStorage(accountId)) entries.push(entry.messageId);
      expect(entries).toContain(id);
    } finally { injection.mockRestore(); index.close(); }
  });
}
}
