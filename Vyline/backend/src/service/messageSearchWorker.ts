import { Database } from "bun:sqlite";
import {
  messageContextIds,
  searchMessageRows,
  MessageSearchError,
} from "../storage/messageSearch.js";
import type { MessageSearchDirection, MessageSearchInput } from "../storage/messageSearch.js";

export type MessageSearchWork = { filename: string; chatMid: string } & (
  | { kind: "search"; input: MessageSearchInput }
  | { kind: "context"; messageId: string; direction: MessageSearchDirection }
);

self.onmessage = ({ data }: MessageEvent<MessageSearchWork>) => {
  let db: Database | undefined;
  try {
    db = new Database(data.filename, { readonly: true });
    const result =
      data.kind === "search"
        ? searchMessageRows(db, data.chatMid, data.input)
        : messageContextIds(db, data.chatMid, data.messageId, data.direction);
    self.postMessage({ ok: true, result });
  } catch (error) {
    self.postMessage({
      ok: false,
      error:
        error instanceof MessageSearchError
          ? { message: error.message, code: error.code, status: error.status }
          : { message: "ローカル履歴を検索できませんでした", code: "SEARCH_FAILED", status: 500 },
    });
  } finally {
    db?.close();
  }
};
