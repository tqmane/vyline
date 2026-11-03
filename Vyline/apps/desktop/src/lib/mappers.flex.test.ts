import { expect, test } from "bun:test";
import type { Message as LineMessage } from "@vyline/types";
import { mapMessage } from "./mappers";

const bubble = {
  type: "bubble",
  body: {
    type: "box",
    layout: "vertical",
    contents: [{ type: "text", text: "合成ゴールドカード" }],
  },
};
const rich = {
  canvas: { width: 1040, height: 520, initialScene: "scene1" },
  expireAt: null,
  scenes: { scene1: {} },
};
function message(
  contentType: string | number,
  metadata: Record<string, unknown>,
  text: string | null = null,
) {
  // The protocol enum may arrive as its numeric wire value before BFF normalization.
  return {
    id: "fixture-flex-1",
    from: "fixture-sender",
    to: "fixture-chat",
    contentType,
    contentMetadata: metadata,
    text,
    createdTime: 1234,
    isMyMessage: false,
  } as LineMessage;
}

test("symbolic, string numeric and numeric Flex/Rich values map to their own metadata models", () => {
  for (const type of ["FLEX", "22", 22]) {
    const value = mapMessage(
      message(type, { FLEX_JSON: JSON.stringify(bubble), ALT_TEXT: "合成カード" }),
      "fixture-chat",
      "fixture-account",
    );
    expect(value.kind).toBe("flex");
    expect(value.flexJson).toEqual(bubble);
    expect(value.altText).toBe("合成カード");
    expect(value.richMarkup).toBeUndefined();
  }
  for (const type of ["RICH", "17", 17]) {
    const value = mapMessage(
      message(type, {
        MARKUP_JSON: JSON.stringify(rich),
        DOWNLOAD_URL: "https://example.com/rich",
        ALT_TEXT: "合成イメージマップ",
      }),
      "fixture-chat",
      "fixture-account",
    );
    expect(value.kind).toBe("rich");
    expect(value.richMarkup).toEqual(rich);
    expect(value.flexJson).toBeUndefined();
    expect(value.richImageUrl).toBe("https://example.com/rich");
  }
});

test("invalid Flex and Rich data remain absent while fallback metadata is preserved", () => {
  const value = mapMessage(
    message("FLEX", { FLEX_JSON: JSON.stringify({ type: "unsupported" }), ALT_TEXT: "代替表示" }),
    "fixture-chat",
    "fixture-account",
  );
  expect(value.flexJson).toBeNull();
  expect(value.text).toBe("代替表示");
  expect(value.altText).toBe("代替表示");
  expect(
    mapMessage(
      message("RICH", { MARKUP_JSON: JSON.stringify(bubble) }),
      "fixture-chat",
      "fixture-account",
    ).richMarkup,
  ).toBeNull();
});

test("existing JSON text fallback still maps a bubble and hides its JSON", () => {
  const value = mapMessage(
    message("NONE", {}, JSON.stringify(bubble)),
    "fixture-chat",
    "fixture-account",
  );
  expect(value.kind).toBe("flex");
  expect(value.flexJson).toEqual(bubble);
  expect(value.text).toBeUndefined();
});
