import { describe, expect, test } from "bun:test";
import { safeExternalHref } from "./safeUrl";

describe("safeExternalHref", () => {
  test("allows ordinary web links", () => {
    expect(safeExternalHref("https://example.com/path?q=1")).toBe("https://example.com/path?q=1");
  });

  test("rejects script and data URLs", () => {
    expect(safeExternalHref("javascript:alert(1)")).toBeUndefined();
    expect(safeExternalHref("data:text/html,<script>alert(1)</script>")).toBeUndefined();
  });

  test("allows explicit LINE deep links only when requested", () => {
    expect(safeExternalHref("line://ti/p/example")).toBeUndefined();
    expect(safeExternalHref("line://ti/p/example", { allowDeepLinks: true })).toBe(
      "line://ti/p/example",
    );
  });

  test("rejects credential-bearing links", () => {
    expect(safeExternalHref("https://user:password@example.com/")).toBeUndefined();
  });
});
