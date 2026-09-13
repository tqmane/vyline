import { expect, test } from "bun:test";
import { segmentTextWithMentions } from "./mention";
import { segmentTextWithSticon, textWithoutSticons, type SticonResource } from "./lineSticon";

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

test("missing sticon ranges prefer object placeholders over literal currency", () => {
  const text = "$100 \ufffc @A";
  const resources = [{ productId: "demo-emoji", sticonId: "sparkle" }];
  const plainText = (parts: ReturnType<typeof segmentTextWithSticon>) =>
    parts
      .filter((part) => part.type === "text")
      .map((part) => part.value)
      .join("");
  expect(plainText(segmentTextWithSticon(text, resources))).toBe("$100  @A");
  const mentioned = segmentTextWithMentions(text, resources, [{ mid: "member", S: 7, E: 9 }]);
  expect(plainText(mentioned.filter((part) => part.type !== "mention"))).toBe("$100  ");
  expect(segmentTextWithSticon("$", resources)[0]?.type).toBe("sticon");
});

test("invalid explicit sticon ranges never fall back onto a literal dollar", () => {
  const text = "cost $100";
  const invalid = { productId: "demo-emoji", sticonId: "sparkle", S: 0, E: 99 };
  expect(textWithoutSticons(text, [invalid])).toBe(text);
  expect(segmentTextWithSticon(text, [null] as unknown as SticonResource[])).toEqual([
    { type: "text", value: text },
  ]);
  expect(textWithoutSticons(text, "oops" as unknown as SticonResource[])).toBe(text);
  expect(textWithoutSticons("$\ufffc", [{ ...invalid, S: 1, E: 2 }])).toBe("$");
});
