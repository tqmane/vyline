import { Hono } from "hono";
import { SocialError, type SocialService } from "../service/socialService.js";

/** Mount under the existing authenticated line router, before its catch-all. */
export function createSocialRouter(service: SocialService) {
  const router = new Hono();
  router.onError((error, c) => c.json({ ok: false, error: error.message, code: (error as { code?: string }).code }, error instanceof SocialError ? error.status : error.name === "NotLoggedInError" ? 401 : 502));
  router.get("/:accountId/social/profile/:mid", async c => c.json({ ok: true, ...await service.profile(c.req.param("accountId"), c.req.param("mid")) }));
  router.get("/:accountId/social/blocked", async c => c.json({ ok: true, ...await service.blocked(c.req.param("accountId")) }));
  router.post("/:accountId/social/friends/:mid", async c => {
    await service.friend(c.req.param("accountId"), c.req.param("mid"), true);
    return c.json({ ok: true });
  });
  router.delete("/:accountId/social/friends/:mid", async c => {
    await service.friend(c.req.param("accountId"), c.req.param("mid"), false);
    return c.json({ ok: true });
  });
  router.on(["POST", "DELETE"], "/:accountId/social/blocked/:mid", async c => {
    await service.block(c.req.param("accountId"), c.req.param("mid"), c.req.method === "POST");
    return c.json({ ok: true });
  });
  router.post("/:accountId/social/chats", async c => {
    const input: unknown = await c.req.json().catch(() => null);
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new SocialError("作成内容が正しくありません");
    const chat = await service.create(c.req.param("accountId"), input);
    return c.json({ ok: true, chat });
  });
  return router;
}
