import { describe, expect, test } from "bun:test";
import { formatChatListTime } from "@/utils/format";

describe("formatChatListTime", () => {
  const now = new Date(2026, 10, 26, 15, 30, 0).getTime();

  test("returns HH:MM for same-day timestamps", () => {
    const morning = new Date(2026, 10, 26, 9, 5, 0).getTime();
    expect(formatChatListTime(morning, now)).toBe("09:05");
  });

  test("returns 昨日 for yesterday timestamps", () => {
    const yesterday = new Date(2026, 10, 25, 22, 10, 0).getTime();
    expect(formatChatListTime(yesterday, now)).toBe("昨日");
  });

  test("returns M/D for earlier dates in the same year", () => {
    const earlier = new Date(2026, 3, 7, 12, 0, 0).getTime();
    expect(formatChatListTime(earlier, now)).toBe("4/7");
  });

  test("returns YYYY/M/D for dates in previous years", () => {
    const lastYear = new Date(2025, 11, 31, 23, 59, 0).getTime();
    expect(formatChatListTime(lastYear, now)).toBe("2025/12/31");
  });

  test("returns empty string for invalid or non-positive timestamps", () => {
    expect(formatChatListTime(0, now)).toBe("");
    expect(formatChatListTime(-1, now)).toBe("");
    expect(formatChatListTime(Number.NaN, now)).toBe("");
  });
});
