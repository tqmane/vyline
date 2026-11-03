import { Hono } from "hono";
import { deleteRetainedMessage } from "../service/messageRetentionService.js";

export const messageRetentionRouter = new Hono();
messageRetentionRouter.delete("/:accountId/messages/:chatMid/:messageId/local", async c => {
  const { accountId, chatMid, messageId } = c.req.param();
  if (!/^[ucr][a-f\d]{32}$/.test(chatMid) || !/^\d{1,30}$/.test(messageId))
    return c.json({ ok: false, error: "invalid message reference" }, 400);
  try {
    if (!await deleteRetainedMessage(accountId, chatMid, messageId))
      return c.json({ ok: false, error: "取消済みの保存メッセージだけを削除できます" }, 409);
    return c.json({ ok: true });
  } catch {
    return c.json({ ok: false, error: "このメッセージは削除できません" }, 403);
  }
});
