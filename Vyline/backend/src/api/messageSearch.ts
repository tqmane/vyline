import { Hono } from "hono";
import { messageSearchService, MessageSearchError } from "../service/messageSearch.js";
import type { MessageSearchDirection } from "../storage/messageSearch.js";

/** Mount inside the existing /line router so account authorization stays in index.ts. */
export function createMessageSearchRouter(service = messageSearchService) {
  const router = new Hono();
  router.use("/:accountId/message-search/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });
  router.onError((error, c) => {
    if (error instanceof MessageSearchError)
      return c.json({ ok: false, error: error.message, code: error.code }, error.status);
    if (error instanceof DOMException && error.name === "AbortError")
      return c.json({ ok: false, error: "検索を中断しました", code: "SEARCH_ABORTED" }, 408);
    return c.json(
      { ok: false, error: "ローカル履歴を検索できませんでした", code: "SEARCH_FAILED" },
      500,
    );
  });
  router.get("/:accountId/message-search/:chatMid", async (c) => {
    const regex = c.req.query("regex");
    if (regex !== undefined && regex !== "true" && regex !== "false")
      throw new MessageSearchError("検索モードが不正です", "INVALID_QUERY", 400);
    const cursor = c.req.query("cursor");
    const page = await service.search(
      c.req.param("accountId"),
      c.req.param("chatMid"),
      {
        query: c.req.query("q") ?? "",
        regex: regex === "true",
        ...(cursor ? { cursor } : {}),
      },
      c.req.raw.signal,
    );
    return c.json({ ok: true, ...page });
  });
  router.get("/:accountId/message-search/:chatMid/context", async (c) =>
    c.json({
      ok: true,
      ...(await service.context(
        c.req.param("accountId"),
        c.req.param("chatMid"),
        c.req.query("messageId") ?? "",
        (c.req.query("direction") ?? "around") as MessageSearchDirection,
        c.req.raw.signal,
      )),
    }),
  );
  return router;
}

export const messageSearchRouter = createMessageSearchRouter();
