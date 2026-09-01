import { describe, expect, it } from "bun:test";
import { mediaDownloadName } from "./mediaDownloadName.js";

describe("mediaDownloadName", () => {
  it("uses the local message date and sanitizes the message id", () => {
    const createdAt = new Date(2026, 8, 1, 14, 5, 9).getTime();

    expect(mediaDownloadName(createdAt, "message/id:*?", ".JPG")).toBe(
      "vyline_20260901_140509_message_id.jpg",
    );
  });

  it("truncates long ids and sanitizes the extension", () => {
    const createdAt = new Date(2026, 0, 2, 3, 4, 5).getTime();

    expect(mediaDownloadName(createdAt, "1234567890abcdefghijkl", "m.p4")).toBe(
      "vyline_20260102_030405_1234567890abcdef.mp4",
    );
  });
});
