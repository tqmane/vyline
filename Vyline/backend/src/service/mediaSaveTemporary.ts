import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, open, readdir, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  MEDIA_STORAGE_MAX_OBJECT_BYTES,
  MediaStorageBusyError,
  MediaStorageCapacityError,
  MediaStorageObjectLimitError,
  mediaCapacityReservation,
  type MediaStorageProducedFileGuard,
  type MediaStorageStat,
} from "../storage/mediaStorage.js";
import { VYLINE_DATA_DIR } from "../storage/vylineStorageInfo.js";

const ROOT = resolve(VYLINE_DATA_DIR, "tmp", "media-display");
const STALE_MS = 60 * 60_000;
const active = new Set<string>();
let workCount = 0;
let lastSweep = 0;

export type TemporaryMessageMedia = MediaStorageStat & { cleanup(): Promise<void> };

async function removeWorkDir(directory: string) {
  const child = relative(ROOT, resolve(directory));
  if (!child || child.startsWith("..") || isAbsolute(child))
    throw new Error("temporary media path escaped its root");
  await rm(directory, { recursive: true, force: true });
}

/** Crash leftovers expire after one hour; sweep only this private tree on the next media fetch. */
async function sweep() {
  if (Date.now() - lastSweep < 60_000) return;
  lastSweep = Date.now();
  for (const entry of await readdir(ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^display-[a-f\d]{16}-[A-Za-z0-9]+$/.test(entry.name)) continue;
    const directory = join(ROOT, entry.name);
    if (active.has(directory)) continue;
    try {
      if (Date.now() - (await lstat(directory)).mtimeMs > STALE_MS) await removeWorkDir(directory);
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT"))
        throw error;
    }
  }
}

export async function produceTemporaryMessageMedia(
  accountId: string,
  contentType: string,
  timeoutMs: number,
  produce: (
    path: string,
    guard: MediaStorageProducedFileGuard,
    signal: AbortSignal,
  ) => Promise<number>,
): Promise<TemporaryMessageMedia> {
  if (workCount >= 4) throw new MediaStorageBusyError();
  workCount++;
  let directory: string | undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await mkdir(ROOT, { recursive: true, mode: 0o700 });
    await sweep();
    const owner = createHash("sha256").update(accountId).digest("hex").slice(0, 16);
    directory = await mkdtemp(join(ROOT, `display-${owner}-`));
    active.add(directory);
    const path = join(directory, "body");
    const reservation = mediaCapacityReservation(directory);
    let guarded = 0;
    let pending = 0;
    const guard: MediaStorageProducedFileGuard = {
      maxBytes: MEDIA_STORAGE_MAX_OBJECT_BYTES,
      async beforeWrite(total, bytes) {
        reservation.consume(pending);
        pending = 0;
        if (controller.signal.aborted) throw new Error("media download aborted");
        if (
          !Number.isSafeInteger(total) ||
          !Number.isSafeInteger(bytes) ||
          bytes < 0 ||
          total !== guarded + bytes
        )
          throw new Error("temporary media progress is invalid");
        if (total > MEDIA_STORAGE_MAX_OBJECT_BYTES) throw new MediaStorageObjectLimitError();
        if (reservation.bytes < bytes) {
          const window = Math.max(
            bytes,
            Math.min(4 * 1024 * 1024, MEDIA_STORAGE_MAX_OBJECT_BYTES - guarded),
          );
          const shortage = bytes - reservation.bytes;
          try {
            await reservation.increase(window - reservation.bytes);
          } catch (error) {
            if (!(error instanceof MediaStorageCapacityError) || window === bytes) throw error;
            await reservation.increase(shortage);
          }
        }
        guarded = total;
        pending = bytes;
      },
    };
    let size: number;
    try {
      size = await produce(path, guard, controller.signal);
      if (controller.signal.aborted) throw new Error("media download aborted");
      const info = await lstat(path);
      if (!info.isFile() || size < 1 || size !== info.size || size !== guarded)
        throw new Error("temporary media size is invalid");
    } finally {
      reservation.release();
    }
    const ownedDirectory = directory;
    let cleanupTask: Promise<void> | undefined;
    const mime = contentType.split(";", 1)[0]!.trim().toLowerCase();
    return {
      path,
      sizeBytes: size,
      contentType,
      originalVerified: true,
      mediaType: mime.startsWith("image/")
        ? "image"
        : mime.startsWith("video/")
          ? "video"
          : mime.startsWith("audio/")
            ? "audio"
            : "file",
      cleanup() {
        cleanupTask ??= removeWorkDir(ownedDirectory).finally(() => {
          active.delete(ownedDirectory);
          workCount--;
        });
        return cleanupTask;
      },
    };
  } catch (error) {
    controller.abort();
    try {
      if (directory) await removeWorkDir(directory);
    } finally {
      if (directory) active.delete(directory);
      workCount--;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Same producer contract as permanent media, with backpressure and no saved-media/index write. */
export async function streamTemporaryMessageMedia(
  accountId: string,
  _chatMid: string,
  _messageId: string,
  fallbackMime: string,
  timeoutMs: number,
  load: (signal: AbortSignal) => Promise<Response>,
): Promise<TemporaryMessageMedia> {
  let contentType = fallbackMime;
  const media = await produceTemporaryMessageMedia(
    accountId,
    fallbackMime,
    timeoutMs,
    async (path, guard, signal) => {
      const response = await load(signal);
      if (!response.ok || !response.body) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error(`media download failed: HTTP ${response.status}`);
      }
      contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim() || fallbackMime;
      const raw = response.headers.get("content-length");
      const expected = raw === null ? undefined : /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
      if (
        expected !== undefined &&
        (!Number.isSafeInteger(expected) || expected < 0 || expected > guard.maxBytes)
      ) {
        await response.body.cancel().catch(() => undefined);
        if (expected > guard.maxBytes) throw new MediaStorageObjectLimitError();
        throw new Error("invalid media Content-Length");
      }
      const reader = response.body.getReader();
      let handle: Awaited<ReturnType<typeof open>> | undefined;
      let done = false;
      let size = 0;
      try {
        handle = await open(path, "wx", 0o600);
        for (;;) {
          const result = await reader.read();
          if (result.done) {
            done = true;
            break;
          }
          if (!result.value?.byteLength) continue;
          const next = size + result.value.byteLength;
          if (expected !== undefined && next > expected)
            throw new Error("media Content-Length mismatch");
          await guard.beforeWrite(next, result.value.byteLength);
          let offset = 0;
          while (offset < result.value.byteLength) {
            const { bytesWritten } = await handle.write(
              result.value,
              offset,
              result.value.byteLength - offset,
              null,
            );
            if (bytesWritten < 1) throw new Error("media write made no progress");
            offset += bytesWritten;
          }
          size = next;
        }
        if (expected !== undefined && size !== expected)
          throw new Error("media Content-Length mismatch");
        return size;
      } finally {
        if (!done) await reader.cancel().catch(() => undefined);
        reader.releaseLock();
        await handle?.close();
      }
    },
  );
  media.contentType = contentType;
  return media;
}

export async function temporaryMediaResponse(
  response: Response,
  media: TemporaryMessageMedia,
): Promise<Response> {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.delete("X-Vyline-Media-Cache");
  if (!response.body) {
    await media.cleanup();
    return new Response(null, { status: response.status, headers });
  }
  const reader = response.body.getReader();
  return new Response(
    new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await reader.read();
          if (next.done) {
            reader.releaseLock();
            await media.cleanup();
            controller.close();
          } else controller.enqueue(next.value);
        } catch (error) {
          await media.cleanup();
          controller.error(error);
        }
      },
      async cancel(reason) {
        try {
          await reader.cancel(reason);
        } finally {
          reader.releaseLock();
          await media.cleanup();
        }
      },
    }),
    { status: response.status, headers },
  );
}
