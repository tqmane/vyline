import { describe, expect, test } from "bun:test";
import { CdnNotFoundError, type CachedLineCdnAsset } from "../storage/cdnAssetCache.js";
import { getLineCdnAssetWithRetry } from "./cdn.js";

const stickerUrl =
  "https://stickershop.line-scdn.net/stickershop/v1/sticker/combo-123/android/sticker.png";

const asset: CachedLineCdnAsset = {
  kind: "memory",
  buf: Uint8Array.from([1, 2, 3]),
  contentType: "image/png",
  fromCache: false,
  size: 3,
};

describe("LINE CDN retry", () => {
  test("retries transient sticker 404s so received combination stickers can propagate", async () => {
    let calls = 0;
    const delays: number[] = [];

    const result = await getLineCdnAssetWithRetry(
      stickerUrl,
      async (url) => {
        calls += 1;
        if (calls < 3) throw new CdnNotFoundError(url);
        return asset;
      },
      async (ms) => {
        delays.push(ms);
      },
    );

    expect(result).toBe(asset);
    expect(calls).toBe(3);
    expect(delays).toEqual([250, 750]);
  });

  test("does not retry a permanent miss for unrelated CDN assets", async () => {
    let calls = 0;
    const url = "https://profile.line-scdn.net/profile/example.png";

    await expect(
      getLineCdnAssetWithRetry(
        url,
        async (requestUrl) => {
          calls += 1;
          throw new CdnNotFoundError(requestUrl);
        },
        async () => undefined,
      ),
    ).rejects.toBeInstanceOf(CdnNotFoundError);

    expect(calls).toBe(1);
  });
});
