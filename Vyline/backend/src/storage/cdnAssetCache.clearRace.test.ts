import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const root = await fs.mkdtemp(join(tmpdir(), "vyline-cdn-clear-race-"));
process.env.VYLINE_STORAGE_DIR = join(root, "storage");
Reflect.deleteProperty(process.env, "VYLINE_CDN_CACHE_DIR");
Reflect.deleteProperty(process.env, "VYLINE_ICON_CACHE_DIR");

const { clearCdnCache, getCachedLineCdnAsset, openCachedLineCdnAsset } = await import("./cdnAssetCache.js");
const { cdnRouter } = await import("../api/cdn.js");
const originalFetch = globalThis.fetch;

function streamedResponse(size: number): Response {
  let sent = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= size) {
          controller.close();
          return;
        }
        const bytes = new Uint8Array(Math.min(64 * 1024, size - sent));
        bytes.fill((sent / (64 * 1024)) % 251);
        sent += bytes.byteLength;
        controller.enqueue(bytes);
      },
    }),
    { headers: { "content-length": String(size), "content-type": "image/png" } },
  );
}

beforeEach(async () => {
  globalThis.fetch = originalFetch;
  await clearCdnCache();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});
afterAll(async () => {
  globalThis.fetch = originalFetch;
  await clearCdnCache();
  await fs.rm(root, { recursive: true, force: true });
});

const URL_FIXTURE = "https://static.line-scdn.net/tests/clear-race-large.png";
/** Above the 4 MiB memory budget, so the asset is served from a disk file. */
const DISK_BACKED_BYTES = 5 * 1024 * 1024;

test("a handed-out asset survives clearing the cache and leaves nothing behind", async () => {
  globalThis.fetch = (async () => streamedResponse(DISK_BACKED_BYTES)) as unknown as typeof fetch;

  const asset = await getCachedLineCdnAsset(URL_FIXTURE);
  expect(asset.kind).toBe("file");
  // The reader now owns the bytes, so the cache may drop its own copy at any time.
  const stream = await openCachedLineCdnAsset(asset);
  const shard = asset.kind === "file" ? dirname(asset.path) : "";
  await clearCdnCache();

  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  expect(bytes.byteLength).toBe(DISK_BACKED_BYTES);
  // The hand-out must not accumulate on disk.
  const remaining = await fs.readdir(shard);
  expect(remaining.filter((name) => name.endsWith(".handout"))).toEqual([]);
}, 30_000);

test("the CDN proxy answers a cache-cleared asset with its full bytes", async () => {
  globalThis.fetch = (async () => streamedResponse(DISK_BACKED_BYTES)) as unknown as typeof fetch;
  // Warm the disk cache so the request is served from the file.
  expect((await getCachedLineCdnAsset(URL_FIXTURE)).kind).toBe("file");

  const response = await cdnRouter.request(
    `http://localhost/line?u=${encodeURIComponent(URL_FIXTURE)}`,
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("immutable");

  await clearCdnCache();

  // A 200 with immutable caching must not carry an empty or failed body.
  expect(new Uint8Array(await response.arrayBuffer()).byteLength).toBe(DISK_BACKED_BYTES);
}, 30_000);
