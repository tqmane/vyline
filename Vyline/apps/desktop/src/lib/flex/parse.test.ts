import { describe, expect, test } from "bun:test";
import { parseFlexContainer, parseRichMarkup } from "./parse";

// Android 26.13.0: o62/j.f (root), .b (bubble), .c (carousel); synthetic content only.
const bubble = {
  type: "bubble",
  size: "giga",
  styles: { body: { backgroundColor: "#C9A542" } },
  body: { type: "box", layout: "vertical", contents: [{ type: "text", text: "合成キャンペーン" }] },
};
const carousel = { type: "carousel", contents: [bubble, { ...bubble, size: "mega" }] };
// Android k88/t -> tc8/c RichMessage serializer, independently of Flex.
const rich = {
  canvas: { width: 1040, height: 520, initialScene: "scene1" },
  expireAt: null,
  images: { image1: { x: 0, y: 0, w: 1040, h: 520 } },
  actions: { open: { type: "uri", params: { linkUri: "https://example.com/fixture" } } },
  scenes: {
    scene1: {
      draws: [{ x: 0, y: 0, w: 1040, h: 520, image: "image1" }],
      listeners: [{ type: "touch", action: "open", params: [0, 0, 1040, 520] }],
    },
  },
};

describe("Android Flex metadata contract", () => {
  test("preserves complete bubble/carousel payloads and nested components", () => {
    expect(parseFlexContainer({ FLEX_JSON: JSON.stringify(carousel) })).toEqual(carousel);
    expect(parseFlexContainer({ FLEX_JSON: bubble })).toEqual(bubble);
    expect(parseFlexContainer({ flex_json: JSON.stringify(JSON.stringify(bubble)) })).toEqual(
      bubble,
    );
    expect(parseFlexContainer(null, JSON.stringify(carousel))).toEqual(carousel);
  });
  test("rejects non-container roots and a missing carousel contents array", () => {
    for (const value of [
      [],
      {},
      { type: "unknown" },
      { type: "box", contents: [] },
      { type: "flex", contents: carousel },
      { type: "carousel", contents: {} },
    ])
      expect(parseFlexContainer({ FLEX_JSON: value })).toBeNull();
  });
  test("accepts Android's optional bubble sections and empty carousel without inventing component restrictions", () => {
    expect(parseFlexContainer({ FLEX_JSON: { type: "bubble" } })).toEqual({ type: "bubble" });
    expect(parseFlexContainer({ FLEX_JSON: { type: "carousel", contents: [] } })).toEqual({
      type: "carousel",
      contents: [],
    });
    expect(parseFlexContainer({ FLEX_JSON: { type: "carousel", contents: [null] } })).toBeNull();
  });
  test("carousel children do not require their own type, as o62/j.c calls the bubble parser directly", () => {
    const { type: _type, ...child } = bubble;
    expect(
      parseFlexContainer({ FLEX_JSON: { type: "carousel", contents: [child] } }),
    ).toMatchObject({ type: "carousel", contents: [child] });
  });
});

describe("Android Rich metadata contract", () => {
  test("keeps canvas/scenes/image map distinct from Flex", () => {
    expect(parseRichMarkup({ MARKUP_JSON: JSON.stringify(rich) })).toEqual(rich);
    expect(parseRichMarkup({ markupJson: JSON.stringify(JSON.stringify(rich)) })).toEqual(rich);
    expect(parseRichMarkup({ MARKUP_JSON: bubble })).toBeNull();
    expect(parseFlexContainer({ FLEX_JSON: rich })).toBeNull();
  });
  test("rejects missing or wrongly typed canvas/scenes objects", () => {
    for (const value of [
      {},
      [],
      { ...rich, canvas: null },
      { ...rich, scenes: [] },
    ])
      expect(parseRichMarkup({ MARKUP_JSON: value })).toBeNull();
  });
  test("keeps partial and string geometry for the existing renderer's defaults and Number conversion", () => {
    for (const canvas of [{}, { ...rich.canvas, width: "1040" }]) {
      const markup = { ...rich, canvas };
      expect(parseRichMarkup({ MARKUP_JSON: markup })).toEqual(markup);
    }
  });
});
