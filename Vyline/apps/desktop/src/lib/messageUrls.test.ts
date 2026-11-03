import { describe, expect, test } from "bun:test";
import { previewUrlsForText, canRequestUrlPreviews, maskMessageUrls } from "./messageUrls";

describe("message preview URLs", () => {
  test("URL masks also cover www links and preserve surrounding text", () => {
    expect(maskMessageUrls("Hello (https://site.org/a). www.site.org！")).toBe(
      "Hello ([URL]). [URL]！",
    );
  });
  test("reuses linkification punctuation, supports www and deduplicates canonical URLs", () => {
    expect(
      previewUrlsForText("(https://site.org/a). www.site.org！ https://site.org/a#heading", 3),
    ).toEqual(["https://site.org/a", "https://www.site.org/"]);
  });
  test("zero and invalid limits never request previews; at most three URLs", () => {
    const text = "https://one.org https://two.org https://three.org https://four.org";
    for (const limit of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
      expect(previewUrlsForText(text, limit)).toEqual([]);
    expect(previewUrlsForText(text)).toEqual(["https://one.org/"]);
    expect(previewUrlsForText(text, 9)).toHaveLength(3);
  });
  test("does not send credentials, secret queries, auth paths or nonstandard ports", () => {
    for (const url of [
      "https://user:pass@site.org",
      "https://site.org/?access_token=x",
      "https://site.org/?X-Amz-Credential=x",
      "https://site.org/?api-key=x",
      "https://site.org/?clientSecret=x",
      "https://site.org/oauth/callback",
      "https://site.org/#token=x",
      "https://site.org:8443/a",
      "http://127.1/a",
      "https://[::1]/",
    ])
      expect(previewUrlsForText(url, 3)).toEqual([]);
    expect(previewUrlsForText("https://site.org/?page=2")).toEqual(["https://site.org/?page=2"]);
  });
  test("requires explicit consent and stops under every URL privacy mask", () => {
    expect(canRequestUrlPreviews({})).toBe(false);
    expect(canRequestUrlPreviews({ requestUrlPreviews: true, linkPreviewMaxUrls: 1 })).toBe(true);
    for (const patch of [
      { requestUrlPreviews: false },
      { linkPreviewMaxUrls: 0 },
      { streamerMode: true },
    ]) {
      expect(
        canRequestUrlPreviews({ requestUrlPreviews: true, linkPreviewMaxUrls: 1, ...patch }),
      ).toBe(false);
    }
  });
});
