import { expect, test } from "bun:test";
import { lineAvatarUrl } from "./lineMedia";

test("avatar paths normalize without rewriting proxy URLs or upload previews", () => {
  expect(lineAvatarUrl("profile-hash")).toBe("/api/cdn/line?u=https%3A%2F%2Fprofile.line-scdn.net%2Fprofile-hash");
  for (const url of ["/api/cdn/line?u=encoded-profile", "blob:http://localhost:5186/local-preview", "data:image/png;base64,eA==", "http://localhost:5186/share-cafe.png"]) {
    expect(lineAvatarUrl(url)).toBe(url);
  }
  expect(lineAvatarUrl(" ")).toBeUndefined();
});

test("profile covers use the same-origin image proxy", () => {
  const cover = "https://obs.line-apps.com/r/myhome/c/cover-object";
  expect(lineAvatarUrl(cover)).toBe(`/api/cdn/line?u=${encodeURIComponent(cover)}`);
  expect(lineAvatarUrl("https://obs.line-apps.com/r/talk/m/private")).toBe("https://obs.line-apps.com/r/talk/m/private");
});
