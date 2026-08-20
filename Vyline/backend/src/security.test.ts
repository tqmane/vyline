import { describe, expect, test } from "bun:test";
import {
  constantTimeEqual,
  isAllowedOrigin,
  isLoopbackHost,
  isSafeAccountId,
} from "./security";

describe("backend security helpers", () => {
  test("accepts file-safe account identifiers", () => {
    expect(isSafeAccountId("account-1")).toBe(true);
    expect(isSafeAccountId("利用者_01")).toBe(true);
  });

  test("rejects traversal and control characters", () => {
    expect(isSafeAccountId("../tokens")).toBe(false);
    expect(isSafeAccountId("a/b")).toBe(false);
    expect(isSafeAccountId("a\\b")).toBe(false);
    expect(isSafeAccountId("a\0b")).toBe(false);
  });

  test("compares secrets without accepting prefixes", () => {
    expect(constantTimeEqual("same-secret", "same-secret")).toBe(true);
    expect(constantTimeEqual("same-secret", "same-secret-extra")).toBe(false);
    expect(constantTimeEqual("same-secret", "other-secret")).toBe(false);
  });

  test("recognizes loopback binds and same-origin requests", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
    expect(isAllowedOrigin("https://vyline.example", "https://vyline.example/api/auth")).toBe(
      true,
    );
  });
});
