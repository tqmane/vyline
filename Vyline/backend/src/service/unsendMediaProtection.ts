import type { StoredMessage } from "../storage/chatStore.js";
import { childLogger } from "../logger.js";
import { statMediaStorage, writeMediaStorage } from "../storage/mediaStorage.js";

const log = childLogger("unsend-media-protection");
const mediaTypes = new Set(["IMAGE", "VIDEO", "AUDIO", "FILE", "1", "2", "3", "14"]);
// ponytail: retain at most 1,024 IDs in memory with two downloads; use a disk queue
// if backlogs must survive restarts. A rejected item can retry on the next sync.
const MAX_PENDING = 1_024;
const WORKERS = 2;
type Job = {
  key: string;
  accountId: string;
  chatMid: string;
  messageId: string;
  resolve: () => void;
  reject: (error: unknown) => void;
};
const queue: Job[] = [];
const pending = new Map<string, Promise<void>>();
let active = 0;

async function preserveMedia({ accountId, chatMid, messageId }: Job): Promise<void> {
  if (await statMediaStorage(accountId, chatMid, messageId)) return;
  // Resolve only after lineService has initialized; its receive paths enqueue us.
  const { fetchPlainMessageMediaToStorage, fetchMessageMedia } = await import("./lineService.js");
  if (await fetchPlainMessageMediaToStorage(accountId, chatMid, messageId)) return;
  const fetched = await fetchMessageMedia(accountId, chatMid, messageId, false);
  if ("bytes" in fetched) {
    await writeMediaStorage(accountId, chatMid, messageId, fetched.bytes, fetched.contentType);
  }
}

function drain(): void {
  while (active < WORKERS && queue.length > 0) {
    const job = queue.shift()!;
    active++;
    void preserveMedia(job)
      .finally(() => {
        pending.delete(job.key);
        active--;
        drain();
      })
      .then(job.resolve, (error) => {
        log.warn(
          { accountId: job.accountId, chatMid: job.chatMid, messageId: job.messageId, err: error },
          "unsend media protection failed; retry on next sync",
        );
        job.reject(error);
      });
  }
}

/** Enqueue after storing the original message. Never await this inside a Talk RPC. */
export function enqueueUnsendMediaProtection(
  accountId: string,
  chatMid: string,
  message: Pick<StoredMessage, "id" | "contentType" | "revokedSnapshot">,
): Promise<void> {
  const source = message.revokedSnapshot ?? message;
  if (!mediaTypes.has(String(source.contentType).toUpperCase())) return Promise.resolve();
  const messageId = message.id;
  const key = JSON.stringify([accountId, chatMid, messageId]);
  const existing = pending.get(key);
  if (existing) return existing;
  if (pending.size >= MAX_PENDING) {
    const error = new Error("unsend media protection queue is full; retry on next sync");
    log.warn({ accountId, chatMid, messageId }, error.message);
    return Promise.reject(error);
  }
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const completion = new Promise<void>((resolveJob, rejectJob) => {
    resolve = resolveJob;
    reject = rejectJob;
  });
  pending.set(key, completion);
  queue.push({ key, accountId, chatMid, messageId, resolve, reject });
  drain();
  return completion;
}
