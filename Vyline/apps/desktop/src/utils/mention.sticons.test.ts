import { expect, test } from "bun:test";
import { segmentTextWithMentions } from "./mention";

test("mixed mentions and sticons use exclusive UTF-16 end offsets without dropping following text", () => {
  const text = "ab\ufffcX @A";
  const mentions = [{ mid: "member", S: 5, E: 7 }];
  const explicit = segmentTextWithMentions(
    text,
    [{ productId: "demo-emoji", sticonId: "sparkle", S: 2, E: 3 }],
    mentions,
  );
  expect(
    explicit
      .filter((part) => part.type === "text")
      .map((part) => part.value)
      .join(""),
  ).toBe("abX ");
  expect(
    segmentTextWithMentions(text, [{ productId: "demo-emoji", sticonId: "sparkle" }], mentions),
  ).toEqual(explicit);
});
