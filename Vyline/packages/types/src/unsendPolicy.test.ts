import { describe, expect, test } from "bun:test";
import {
  PREMIUM_UNSEND_WINDOW_MS,
  STANDARD_UNSEND_WINDOW_MS,
  canUnsendMessage,
} from "./unsendPolicy.js";

describe("canUnsendMessage", () => {
  const now = 10_000_000_000;

  test("standard accounts can unsend for twenty-four hours", () => {
    expect(STANDARD_UNSEND_WINDOW_MS).toBe(86_400_000);
    expect(canUnsendMessage(now - 23 * 60 * 60 * 1000, false, now)).toBe(true);
    expect(canUnsendMessage(now - STANDARD_UNSEND_WINDOW_MS, false, now)).toBe(true);
    expect(canUnsendMessage(now - STANDARD_UNSEND_WINDOW_MS - 1, false, now)).toBe(false);
  });

  test("premium accounts are limited to seven days", () => {
    expect(canUnsendMessage(now - PREMIUM_UNSEND_WINDOW_MS, true, now)).toBe(true);
    expect(canUnsendMessage(now - PREMIUM_UNSEND_WINDOW_MS - 1, true, now)).toBe(false);
  });

  test("fails closed when the timestamp is unavailable or invalid", () => {
    expect(canUnsendMessage(0, false, now)).toBe(false);
    expect(canUnsendMessage(Number.NaN, true, now)).toBe(false);
    expect(canUnsendMessage(Number.POSITIVE_INFINITY, false, now)).toBe(false);
    expect(canUnsendMessage(now + 1, false, now)).toBe(false);
  });
});
