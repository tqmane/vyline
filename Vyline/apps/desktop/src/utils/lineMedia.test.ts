import { describe, expect, test } from "bun:test";
import { lineCdnProxy } from "./lineMedia";

describe("lineCdnProxy", () => {
  test("versions proxied URLs so old immutable fallback responses are invalidated", () => {
    const proxied = lineCdnProxy(
      "https://stickershop.line-scdn.net/stickershop/v1/sticker/combo-123/android/sticker.png",
    );

    expect(proxied).toContain("/api/cdn/line?u=");
    expect(proxied).toContain("&v=2");
  });
});
