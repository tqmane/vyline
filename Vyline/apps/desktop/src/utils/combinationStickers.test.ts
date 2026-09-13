import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  combinationStickerMetadataUrl,
  getCombinationStickerPreview,
  parseCombinationStickerMetadata,
  setCombinationStickerPreview,
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

describe("combination sticker preview cache", () => {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  let values: Map<string, string>;
  let quota: number;
  const key = "vyline:combinationStickerPreviews:account";
  const preview = (size: number) => `data:image/png;base64,${"a".repeat(size)}`;

  beforeEach(() => {
    values = new Map();
    quota = Number.POSITIVE_INFINITY;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (name: string) => values.get(name) ?? null,
        removeItem: (name: string) => values.delete(name),
        setItem: (name: string, value: string) => {
          if (value.length * 2 > quota) throw new DOMException("full", "QuotaExceededError");
          values.set(name, value);
        },
      },
    });
  });

  afterEach(() => {
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });

  it("bounds persisted bytes while retaining the latest preview", () => {
    const data = preview(180_000);
    for (const id of ["old", "middle", "new"]) {
      setCombinationStickerPreview("account", id, data);
    }
    expect((values.get(key)?.length ?? 0) * 2).toBeLessThanOrEqual(1024 * 1024);
    expect(getCombinationStickerPreview("account", "old")).toBeNull();
    expect(getCombinationStickerPreview("account", "new")).toBe(data);
  });

  it("does not evict useful previews for a single image exceeding the budget", () => {
    setCombinationStickerPreview("account", "small", preview(100));
    setCombinationStickerPreview("account", "huge", preview(1024 * 1024));
    expect(getCombinationStickerPreview("account", "small")).toBe(preview(100));
    expect(getCombinationStickerPreview("account", "huge") == null).toBe(true);
  });

  it("recovers from a smaller remaining quota, including replacing an existing preview", () => {
    setCombinationStickerPreview("account", "replace", preview(100));
    setCombinationStickerPreview("account", "old", preview(100));
    quota = 500;
    setCombinationStickerPreview("account", "replace", preview(180));
    expect(getCombinationStickerPreview("account", "old")).toBeNull();
    expect(getCombinationStickerPreview("account", "replace")).toBe(preview(180));
    quota = 0;
    expect(() =>
      setCombinationStickerPreview("account", "unavailable", preview(100)),
    ).not.toThrow();
  });

  it("ignores malformed persisted entries and keeps accounts separate", () => {
    values.set(key, JSON.stringify({ bad: 42, valid: preview(5) }));
    expect(getCombinationStickerPreview("account", "bad")).toBeNull();
    expect(getCombinationStickerPreview("account", "toString")).toBeNull();
    expect(getCombinationStickerPreview("other", "valid")).toBeNull();
    expect(getCombinationStickerPreview("account", "valid")).toBe(preview(5));
  });
});
