import { describe, expect, it } from "bun:test";
import {
  combinationStickerMetadataUrl,
  parseCombinationStickerMetadata,
} from "./combinationStickers.js";

describe("combination sticker receive metadata", () => {
  it("uses the Desktop-compatible metadata endpoint", () => {
    expect(combinationStickerMetadataUrl("combo-id")).toBe(
      "https://stickershop.line-scdn.net/combination-sticker/meta/combo-id",
    );
  });

  it("accepts the metadata shape returned for received combination stickers", () => {
    const parsed = parseCombinationStickerMetadata({
      version: 1,
      canvasWidth: 760.42041015625,
      canvasHeight: 452.75848388671875,
      stickerLayouts: [
        {
          layoutInfo: { width: 426, height: 426, rotation: 0, x: 0, y: 0 },
          stickerInfo: { stickerId: 52002737, productId: 11537, stickerVersion: 1 },
        },
        {
          layoutInfo: { width: 426, height: 426, rotation: 0, x: 334, y: 27 },
          stickerInfo: { stickerId: 52002738, productId: 11537, stickerVersion: 1 },
        },
      ],
    });

    expect(parsed?.canvasWidth).toBeCloseTo(760.42041015625);
    expect(parsed?.stickerLayouts.map((item) => item.stickerInfo.stickerId)).toEqual([
      "52002737",
      "52002738",
    ]);
  });
});
