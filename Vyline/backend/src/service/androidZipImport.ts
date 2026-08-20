/** Secure importer for the full PrtivateLEIN `LEINs_backup_*.zip` format. */

import {
  BlobReader,
  Uint8ArrayWriter,
  ZipReader,
  type FileEntry,
} from "@zip.js/zip.js";
import { randomBytes } from "node:crypto";
import { open, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { childLogger } from "../logger.js";
import { importChatDb } from "../storage/chatStore.js";
import { writeMediaCache } from "../storage/mediaCache.js";
import { readAndroidLineDatabase } from "./androidDbImport.js";

const log = childLogger("android-zip-import");
const DATABASE_ENTRY = "databases/naver_line";
const MEDIA_ENTRY = /^chats\/([ucr][0-9a-f]{32})\/messages\/(\d{1,20})(\.original|\.thumb)?$/i;
const IGNORED_MEDIA_SIDECAR =
  /^chats\/[ucr][0-9a-f]{32}\/messages\/\d{1,20}-(?:hash|hmac)$/i;

const MAX_ENTRIES = 20_000;
const MAX_DATABASE_BYTES = 512 * 1024 * 1024;
const MAX_MEDIA_ENTRY_BYTES = 256 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_COMPRESSION_RATIO = 200;

interface MediaCandidate {
  entry: FileEntry;
  key: string;
  variant: "original" | "base" | "thumb";
  priority: number;
}

interface MediaSet {
  content?: MediaCandidate;
  preview?: MediaCandidate;
}

export interface AndroidZipImportResult {
  importedChats: number;
  importedMessages: number;
  skippedChats: number;
  skippedMessages: number;
  sourceChats: number;
  sourceMessages: number;
  sourceMediaEntries: number;
  importedMedia: number;
  importedMediaPreviews: number;
  previewOnlyMedia: number;
  skippedMedia: number;
}

function numberFromEnv(name: string, fallback: number, hardMax: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.trunc(value), hardMax);
}

function assertSafeEntry(entry: FileEntry): void {
  if (
    entry.encrypted ||
    !Number.isSafeInteger(entry.compressedSize) ||
    !Number.isSafeInteger(entry.uncompressedSize) ||
    entry.compressedSize < 0 ||
    entry.uncompressedSize < 0
  ) {
    throw new Error("encrypted or malformed ZIP entry");
  }
  if (
    entry.uncompressedSize > 1024 * 1024 &&
    (entry.compressedSize === 0 || entry.uncompressedSize / entry.compressedSize > MAX_COMPRESSION_RATIO)
  ) {
    throw new Error("suspicious ZIP compression ratio");
  }
  if (
    entry.filename.includes("\0") ||
    entry.filename.includes("\\") ||
    entry.filename.startsWith("/") ||
    entry.filename.split("/").includes("..")
  ) {
    throw new Error("unsafe ZIP entry name");
  }
}

const extractionOptions = {
  checkCrc32: true,
  checkOverlappingEntry: true,
  strictness: "strict" as const,
  useWebWorkers: false,
};

async function extractEntryToFile(entry: FileEntry, path: string, maxBytes: number): Promise<void> {
  if (entry.uncompressedSize <= 0 || entry.uncompressedSize > maxBytes) {
    throw new Error("database ZIP entry exceeds its size limit");
  }
  const handle = await open(path, "wx", 0o600);
  let written = 0;
  let completed = false;
  const writable = new WritableStream<Uint8Array>({
    async write(chunk) {
      written += chunk.byteLength;
      if (written > maxBytes) throw new Error("expanded ZIP entry exceeds its size limit");
      await handle.write(chunk);
    },
    async close() {
      await handle.sync();
      await handle.close();
    },
    async abort() {
      await handle.close().catch(() => undefined);
    },
  });
  try {
    await entry.getData(writable, extractionOptions);
    if (written !== entry.uncompressedSize) throw new Error("expanded ZIP entry size mismatch");
    completed = true;
  } finally {
    await handle.close().catch(() => undefined);
    if (!completed) await unlink(path).catch(() => undefined);
  }
}

function hasPrefix(bytes: Uint8Array, values: number[]): boolean {
  return values.every((value, index) => bytes[index] === value);
}

export function sniffRestoredMediaType(bytes: Uint8Array, expectedType: string): string | null {
  if (bytes.byteLength < 12) return expectedType === "14" ? "application/octet-stream" : null;
  if (hasPrefix(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (new TextDecoder().decode(bytes.subarray(0, 6)) === "GIF87a" ||
      new TextDecoder().decode(bytes.subarray(0, 6)) === "GIF89a") return "image/gif";
  if (
    new TextDecoder().decode(bytes.subarray(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.subarray(8, 12)) === "WEBP"
  ) return "image/webp";
  if (new TextDecoder().decode(bytes.subarray(0, 4)) === "OggS") return "audio/ogg";
  if (new TextDecoder().decode(bytes.subarray(0, 3)) === "ID3") return "audio/mpeg";
  if (new TextDecoder().decode(bytes.subarray(0, 4)) === "%PDF") return "application/pdf";
  if (new TextDecoder().decode(bytes.subarray(4, 8)) === "ftyp") {
    return expectedType === "3" ? "audio/mp4" : "video/mp4";
  }
  if (hasPrefix(bytes, [0x50, 0x4b, 0x03, 0x04])) return "application/zip";
  return expectedType === "14" ? "application/octet-stream" : null;
}

function messageTypeForMime(mime: string): string | null {
  if (mime.startsWith("image/")) return "1";
  if (mime.startsWith("video/")) return "2";
  if (mime.startsWith("audio/")) return "3";
  if (mime === "application/pdf" || mime === "application/zip" || mime === "application/octet-stream") {
    return "14";
  }
  return null;
}

export async function importAndroidLineZip(
  accountId: string,
  zipPath: string,
  myMid: string,
): Promise<AndroidZipImportResult> {
  const reader = new ZipReader(new BlobReader(Bun.file(zipPath)), {
    strictness: "strict",
    filenameValidation: "strict",
    checkCrc32: true,
    useWebWorkers: false,
  });
  let databaseEntry: FileEntry | null = null;
  const media = new Map<string, MediaSet>();
  const seenFiles = new Set<string>();
  let entryCount = 0;
  let totalUncompressed = 0;
  try {
    for await (const entry of reader.getEntriesGenerator({
      strictness: "strict",
      filenameValidation: "strict",
    })) {
      if (++entryCount > MAX_ENTRIES) throw new Error("ZIP contains too many entries");
      if (entry.directory) continue;
      assertSafeEntry(entry);
      if (seenFiles.has(entry.filename)) throw new Error("ZIP contains duplicate file entries");
      seenFiles.add(entry.filename);
      totalUncompressed += entry.uncompressedSize;
      if (!Number.isSafeInteger(totalUncompressed) || totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES) {
        throw new Error("ZIP expanded size exceeds the archive limit");
      }
      if (entry.filename === DATABASE_ENTRY) {
        if (databaseEntry) throw new Error("ZIP contains duplicate Android databases");
        if (entry.uncompressedSize > MAX_DATABASE_BYTES) throw new Error("Android database is too large");
        databaseEntry = entry;
        continue;
      }
      const match = MEDIA_ENTRY.exec(entry.filename);
      if (match) {
        const maxMediaBytes = numberFromEnv(
          "VYLINE_ANDROID_ZIP_MAX_MEDIA_BYTES",
          MAX_MEDIA_ENTRY_BYTES,
          MAX_MEDIA_ENTRY_BYTES,
        );
        if (entry.uncompressedSize <= 0 || entry.uncompressedSize > maxMediaBytes) continue;
        const key = `${match[1]}/${match[2]}`;
        const suffix = match[3] ?? "";
        const candidate: MediaCandidate = {
          entry,
          key,
          variant: suffix === ".original" ? "original" : suffix === ".thumb" ? "thumb" : "base",
          priority: suffix === ".original" ? 3 : suffix === ".thumb" ? 1 : 2,
        };
        const set = media.get(key) ?? {};
        if (candidate.variant === "thumb") {
          set.preview = candidate;
        } else if (!set.content || candidate.priority > set.content.priority) {
          set.content = candidate;
        }
        media.set(key, set);
        continue;
      }
      if (IGNORED_MEDIA_SIDECAR.test(entry.filename)) continue;
      // Other fixed LEINs data (settings and auxiliary databases) is intentionally ignored.
    }

    if (!databaseEntry) throw new Error("ZIP does not contain databases/naver_line");
    const databasePath = join(
      dirname(zipPath),
      `${randomBytes(24).toString("hex")}.naver_line.sqlite`,
    );
    await extractEntryToFile(databaseEntry, databasePath, MAX_DATABASE_BYTES);
    try {
      const data = readAndroidLineDatabase(databasePath, myMid, {
        maxChats: Number(process.env.VYLINE_ANDROID_DB_MAX_CHATS ?? 50_000),
        maxMessages: Number(process.env.VYLINE_ANDROID_DB_MAX_MESSAGES ?? 250_000),
      });
      let importedMedia = 0;
      let importedMediaPreviews = 0;
      let previewOnlyMedia = 0;
      let skippedMedia = 0;
      const skippedMediaReasons = {
        noDatabaseRow: 0,
        noImportedMessage: 0,
        unsupportedOrInvalid: 0,
      };
      for (const [key, candidates] of media) {
        const ref = data.mediaRefs[key];
        if (!ref) {
          skippedMedia++;
          skippedMediaReasons.noDatabaseRow++;
          continue;
        }
        const message = data.messages[ref.chatMid]?.[ref.messageId];
        if (!message) {
          skippedMedia++;
          skippedMediaReasons.noImportedMessage++;
          continue;
        }
        let restored = false;
        let restoredContent = false;
        if (candidates.content) {
          try {
            const bytes = await candidates.content.entry.getData(
              new Uint8ArrayWriter(
                Math.min(candidates.content.entry.uncompressedSize, 1024 * 1024),
              ),
              extractionOptions,
            );
            const mime = sniffRestoredMediaType(bytes, message.contentType);
            if (mime) {
              const mappedType = messageTypeForMime(mime);
              if (mappedType) message.contentType = mappedType;
              restoredContent = await writeMediaCache(
                accountId,
                ref.chatMid,
                ref.messageId,
                bytes,
                mime,
                "content",
              );
              restored ||= restoredContent;
            }
          } catch {
            // A valid preview can still be recovered below.
          }
        }
        if (candidates.preview) {
          try {
            const bytes = await candidates.preview.entry.getData(
              new Uint8ArrayWriter(
                Math.min(candidates.preview.entry.uncompressedSize, 1024 * 1024),
              ),
              extractionOptions,
            );
            const mime = sniffRestoredMediaType(bytes, "1");
            if (mime?.startsWith("image/") &&
                await writeMediaCache(
                  accountId,
                  ref.chatMid,
                  ref.messageId,
                  bytes,
                  mime,
                  "preview",
                )) {
              importedMediaPreviews++;
              restored = true;
            }
          } catch {
            // Counted as unsupported only when neither representation succeeds.
          }
        }
        if (restored) {
          importedMedia++;
          if (!restoredContent) previewOnlyMedia++;
        } else {
          skippedMedia++;
          skippedMediaReasons.unsupportedOrInvalid++;
        }
      }

      const imported = await importChatDb(accountId, data);
      log.info(
        {
          accountId,
          chats: imported.chats,
          messages: imported.messages,
          importedMedia,
          importedMediaPreviews,
          previewOnlyMedia,
          skippedMedia,
          skippedMediaReasons,
        },
        "LEINs Android ZIP imported",
      );
      return {
        importedChats: imported.chats,
        importedMessages: imported.messages,
        skippedChats: data.skippedChats,
        skippedMessages: data.skippedMessages,
        sourceChats: data.sourceChats,
        sourceMessages: data.sourceMessages,
        sourceMediaEntries: media.size,
        importedMedia,
        importedMediaPreviews,
        previewOnlyMedia,
        skippedMedia,
      };
    } finally {
      await unlink(databasePath).catch(() => undefined);
    }
  } finally {
    await reader.close().catch(() => undefined);
  }
}
