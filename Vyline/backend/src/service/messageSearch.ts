import type { Message } from "@vyline/types";
import { accountFile } from "../storage/accountDirs.js";
import { getStoredMessagesByIds, warmAccountCache } from "../storage/chatStore.js";
import { storedMessageToMessage, type StoredMessage } from "../storage/chatStoreCore.js";
import { MessageSearchError, validateMessageSearch } from "../storage/messageSearch.js";
import type {
  MessageSearchDirection,
  MessageSearchInput,
  MessageSearchPage,
} from "../storage/messageSearch.js";
import type { MessageSearchWork } from "./messageSearchWorker.js";

export { MessageSearchError };
export type MessageSearchContext = { messages: Message[]; hasOlder: boolean; hasNewer: boolean };
let activeWorkers = 0;

function runWorker<T>(work: MessageSearchWork, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(new DOMException("検索を中断しました", "AbortError"));
  if (activeWorkers >= 4)
    return Promise.reject(
      new MessageSearchError(
        "検索が混み合っています。少し待って再実行してください",
        "SEARCH_BUSY",
        429,
      ),
    );
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./messageSearchWorker.ts", import.meta.url).href);
    activeWorkers++;
    let settled = false;
    let failure: unknown;
    let value: T | undefined;
    const finish = (error: unknown, result?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      failure = error;
      value = result;
      worker.terminate();
    };
    const abort = () => finish(new DOMException("検索を中断しました", "AbortError"));
    const timer = setTimeout(
      () =>
        finish(
          new MessageSearchError(
            "検索がタイムアウトしました。検索語や正規表現を絞ってください",
            "SEARCH_TIMEOUT",
            408,
          ),
        ),
      2_000,
    );
    signal?.addEventListener("abort", abort, { once: true });
    worker.addEventListener("message", ({ data }) => {
      if (data.ok) finish(null, data.result as T);
      else finish(new MessageSearchError(data.error.message, data.error.code, data.error.status));
    });
    worker.addEventListener("error", () =>
      finish(new MessageSearchError("検索を実行できませんでした", "SEARCH_FAILED", 500)),
    );
    worker.addEventListener("close", () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      activeWorkers--;
      if (!settled)
        reject(new MessageSearchError("検索を実行できませんでした", "SEARCH_FAILED", 500));
      else if (failure) reject(failure);
      else resolve(value!);
    });
    worker.postMessage(work);
  });
}

export function createMessageSearchService(dependencies: {
  prepareDatabase: (accountId: string) => Promise<string>;
  loadMessages: (accountId: string, chatMid: string, ids: string[]) => Promise<StoredMessage[]>;
}) {
  return {
    async search(
      accountId: string,
      chatMid: string,
      input: MessageSearchInput,
      signal?: AbortSignal,
    ): Promise<MessageSearchPage> {
      validateMessageSearch(input);
      const filename = await dependencies.prepareDatabase(accountId);
      return runWorker({ kind: "search", filename, chatMid, input }, signal);
    },
    async context(
      accountId: string,
      chatMid: string,
      messageId: string,
      direction: MessageSearchDirection,
      signal?: AbortSignal,
    ): Promise<MessageSearchContext> {
      if (
        !messageId ||
        messageId.length > 512 ||
        !["around", "before", "after"].includes(direction)
      )
        throw new MessageSearchError("履歴の指定が不正です", "INVALID_CONTEXT", 400);
      const filename = await dependencies.prepareDatabase(accountId);
      const result = await runWorker<{ ids: string[]; hasOlder: boolean; hasNewer: boolean }>(
        { kind: "context", filename, chatMid, messageId, direction },
        signal,
      );
      if (signal?.aborted) throw new DOMException("検索を中断しました", "AbortError");
      const messages = await dependencies.loadMessages(accountId, chatMid, result.ids);
      const byId = new Map(
        messages.map((message) => [message.id, storedMessageToMessage(message)]),
      );
      return {
        messages: result.ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])),
        hasOlder: result.hasOlder,
        hasNewer: result.hasNewer,
      };
    },
  };
}

export const messageSearchService = createMessageSearchService({
  prepareDatabase: async (accountId) => {
    await warmAccountCache(accountId);
    return accountFile(accountId, "chatdb.sqlite");
  },
  loadMessages: getStoredMessagesByIds,
});
