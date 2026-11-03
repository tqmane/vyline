import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  linkPreviewService,
  previewPolicyAllowsFetch,
  type LinkPreviewPolicy,
} from "../service/linkPreviewService.js";

/** Mount under /line and /api/line, behind the existing account authorization middleware. */
export function createLinkPreviewRouter(
  options: {
    service?: typeof linkPreviewService;
  } = {},
) {
  const router = new Hono();
  const service = options.service ?? linkPreviewService;
  router.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });
  router.post("/:accountId/link-preview", bodyLimit({ maxSize: 4096 }), async (c) => {
    const accountId = c.req.param("accountId");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "invalid preview request" }, 422);
    }
    if (
      !body ||
      typeof body !== "object" ||
      !("url" in body) ||
      typeof body.url !== "string" ||
      body.url.length > 2048
    )
      return c.json({ ok: false, error: "invalid preview request" }, 422);
    // Consent is browser-local; require it explicitly on each authenticated request.
    const policy = body as LinkPreviewPolicy;
    if (!previewPolicyAllowsFetch(policy)) return c.json({ ok: true, preview: null });
    const preview = await service.fetchLinkPreview(body.url, accountId, policy, c.req.raw.signal);
    return c.json({ ok: true, preview });
  });
  router.get("/:accountId/link-preview/images/:imageId", async (c) => {
    const accountId = c.req.param("accountId");
    if (c.req.header("X-Vyline-Url-Preview") !== "1") return c.notFound();
    const image = service.readLinkPreviewImage(c.req.param("imageId"), accountId, {
      requestUrlPreviews: true,
      linkPreviewMaxUrls: 1,
    });
    if (!image) return c.notFound();
    c.header("Content-Type", image.contentType);
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Content-Security-Policy", "default-src 'none'; sandbox");
    return c.body(new Uint8Array(image.bytes));
  });
  return router;
}

export const linkPreviewRouter = createLinkPreviewRouter();
