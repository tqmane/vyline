/**
 * api/cdn.ts — LINE CDN（スタンプ / sticon）プロキシ + ディスクキャッシュ
 *
 * GET /cdn/line?u=<encoded https url>
 */

import { Hono } from "hono";
import {
  CdnNotFoundError,
  getCachedLineCdnAsset,
  isAllowedLineCdnUrl,
  type CachedLineCdnAsset,
} from "../storage/cdnAssetCache.js";
import { childLogger } from "../logger.js";

const log = childLogger("bff:cdn");
const STICKER_404_RETRY_DELAYS_MS = [250, 750, 1_500] as const;

type CdnAssetLoader = (url: string) => Promise<CachedLineCdnAsset>;
type Sleep = (ms: number) => Promise<unknown>;

function isStickerAssetUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      url.hostname === "stickershop.line-scdn.net" &&
      url.pathname.startsWith("/stickershop/v1/sticker/")
    );
  } catch {
    return false;
  }
}

/**
 * Newly-created combination stickers can reach Talk before the rendered asset
 * has propagated to stickershop. Retry only that sticker asset family; other
 * CDN 404s stay fail-fast.
 */
export async function getLineCdnAssetWithRetry(
  url: string,
  load: CdnAssetLoader = getCachedLineCdnAsset,
  sleep: Sleep = (ms) => Bun.sleep(ms),
): Promise<CachedLineCdnAsset> {
  const delays = isStickerAssetUrl(url) ? STICKER_404_RETRY_DELAYS_MS : [];

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await load(url);
    } catch (err) {
      if (!(err instanceof CdnNotFoundError) || attempt >= delays.length) throw err;
      await sleep(delays[attempt]!);
    }
  }
}

export const cdnRouter = new Hono();

cdnRouter.get("/line", async (c) => {
  const raw = c.req.query("u") ?? c.req.query("url") ?? "";
  let url: string;
  try {
    url = decodeURIComponent(raw);
  } catch {
    return c.json({ ok: false, error: "bad url" }, 400);
  }
  if (!url || !isAllowedLineCdnUrl(url)) {
    return c.json({ ok: false, error: "url not allowed" }, 400);
  }

  try {
    const asset = await getLineCdnAssetWithRetry(url);
    const body = asset.kind === "memory" ? Buffer.from(asset.buf) : Bun.file(asset.path);
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": asset.contentType,
        "Cache-Control": "public, max-age=604800, immutable",
        "X-Vyline-Cdn-Cache": asset.fromCache ? "HIT" : "MISS",
      },
    });
  } catch (err) {
    log.debug({ err, url }, "cdn proxy failed");
    if (err instanceof CdnNotFoundError) {
      // Do not turn a transient 404 into a week-long cached transparent image.
      // A later render/navigation can retry once the generated sticker exists.
      return new Response(null, {
        status: 404,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": "1",
          "X-Vyline-Cdn-Cache": "MISS-404",
        },
      });
    }
    return c.json({ ok: false, error: "upstream service unavailable" }, 502);
  }
});
