import { expect, test } from "bun:test";
import { previewFromBoxMessage } from "./lineService.js";

test("chat list previews preserve literal dollar signs", () => {
  for (const text of ["$", "$$", "$100", "$\uFFFC"]) {
    expect(previewFromBoxMessage({ text, contentType: "NONE" })).toBe(text);
  }
  expect(previewFromBoxMessage({ text: "\uFFFC", contentType: "NONE" })).toBe("絵文字");
  expect(previewFromBoxMessage({ text: "$", contentMetadata: { ALT_TEXT: "price $" } })).toBe(
    "price $",
  );
});
