import type { Message } from "@vyline/types";
import { captureBackendFetch } from "./client";

export type SearchHit = { id: string; text: string; createdTime: number; highlight: string };
export type SearchPage = { hits: SearchHit[]; nextCursor: string | null; limit: number };
export type SearchContext = { messages: Message[]; hasOlder: boolean; hasNewer: boolean };
export type SearchDirection = "around" | "before" | "after";
export type MessageSearchClient = {
  search(
    query: string,
    regex: boolean,
    cursor: string | null,
    signal: AbortSignal,
  ): Promise<SearchPage>;
  context(
    messageId: string,
    direction: SearchDirection,
    signal: AbortSignal,
  ): Promise<SearchContext>;
};

export function messageSearchClient(accountId: string, chatMid: string): MessageSearchClient {
  const fetch = captureBackendFetch();
  const base = `/line/${encodeURIComponent(accountId)}/message-search/${encodeURIComponent(chatMid)}`;
  async function request<T>(path: string, signal: AbortSignal): Promise<T> {
    try {
      const response = await fetch(base + path, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
      });
      const data = await response.json();
      if (!response.ok || data.ok !== true)
        throw new Error(typeof data.error === "string" ? data.error : "履歴を検索できませんでした");
      return data as T;
    } catch (error) {
      if (signal.aborted) throw new DOMException("検索を中断しました", "AbortError");
      throw error;
    }
  }
  return {
    search: (query, regex, cursor, signal) => {
      const params = new URLSearchParams({ q: query, regex: String(regex) });
      if (cursor) params.set("cursor", cursor);
      return request<SearchPage>(`?${params}`, signal);
    },
    context: (messageId, direction, signal) =>
      request<SearchContext>(`/context?${new URLSearchParams({ messageId, direction })}`, signal),
  };
}
