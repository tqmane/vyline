import { describe, expect, test } from "bun:test";
import { isNewerServerMessageId } from "./lineService.js";

describe("history polling message IDs", () => {
  test("compares server IDs without losing bigint precision", () => {
    expect(isNewerServerMessageId("9223372036854775808", "9223372036854775807")).toBe(true);
    expect(isNewerServerMessageId("9223372036854775806", "9223372036854775807")).toBe(false);
  });

  test("rejects optimistic and malformed IDs", () => {
    expect(isNewerServerMessageId("pending_1", "1")).toBe(false);
    expect(isNewerServerMessageId("2", "not-a-message")).toBe(false);
  });
});
