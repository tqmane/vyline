import { describe, expect, test } from "bun:test";
import {
  computePreviewBox,
  getCachedImageDimensions,
  loadDownscaledPreview,
  rememberImageDimensions,
} from "@/lib/imagePreviewCache";

describe("imagePreviewCache", () => {
  test("computePreviewBox scales down proportionally within max bounds without upscaling small images", () => {
    expect(computePreviewBox(1920, 1080)).toEqual({ width: 240, height: 135 });
    expect(computePreviewBox(1080, 1920)).toEqual({ width: 203, height: 360 });
    expect(computePreviewBox(500, 500)).toEqual({ width: 240, height: 240 });
    expect(computePreviewBox(120, 90)).toEqual({ width: 120, height: 90 });
    expect(computePreviewBox(0, 0)).toEqual({ width: 240, height: 180 });
  });

  test("rememberImageDimensions caches valid dimensions and ignores invalid ones", () => {
    const key = `/api/line/acc/media/chat/msg-${Date.now()}`;
    rememberImageDimensions(key, 800, 600);
    expect(getCachedImageDimensions(key)).toEqual({ width: 800, height: 600 });

    rememberImageDimensions(`${key}-invalid`, 0, 100);
    expect(getCachedImageDimensions(`${key}-invalid`)).toBeUndefined();
  });

  test("loadDownscaledPreview falls back to null for blob/data/gif URLs and non-bitmap runtimes", async () => {
    expect(await loadDownscaledPreview("blob:https://example.test/123")).toBeNull();
    expect(await loadDownscaledPreview("data:image/png;base64,AAAA")).toBeNull();
    expect(await loadDownscaledPreview("/api/media/sample.gif")).toBeNull();
    expect(await loadDownscaledPreview("/api/line/acc/media/chat/msg-fallback")).toBeNull();
  });
});
