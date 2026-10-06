import { describe, expect, it } from "bun:test";
import { findFirstUnreadMessage, isNearScrollBottom, resolveUnreadBoundary } from "./chatScroll";

const message = (id: string, createdAt: number, read: boolean, authorId = "peer") => ({
  id,
  createdAt,
  read,
  authorId,
});

describe("findFirstUnreadMessage", () => {
  it("returns the oldest unread message from the other person", () => {
    const result = findFirstUnreadMessage([
      message("30", 30, false),
      message("10", 10, true),
      message("20", 20, false),
    ]);

    expect(result?.id).toBe("20");
  });

  it("ignores unread messages sent by me", () => {
    const result = findFirstUnreadMessage([message("10", 10, false, "me")]);

    expect(result).toBeUndefined();
  });

  it("returns undefined when all messages are read", () => {
    const result = findFirstUnreadMessage([message("10", 10, true), message("20", 20, true)]);
    expect(result).toBeUndefined();
  });

  it("uses BigInt id as tie-breaker when createdAt is equal", () => {
    const result = findFirstUnreadMessage([message("20", 100, false), message("10", 100, false)]);
    expect(result?.id).toBe("10");
  });
});

describe("isNearScrollBottom", () => {
  it("treats exact and fractional bottom positions as bottom", () => {
    expect(isNearScrollBottom({ scrollTop: 600, scrollHeight: 1000, clientHeight: 400 })).toBe(
      true,
    );
    expect(isNearScrollBottom({ scrollTop: 599.4, scrollHeight: 1000, clientHeight: 400 })).toBe(
      true,
    );
  });

  it("returns false when the user is meaningfully above the bottom", () => {
    expect(isNearScrollBottom({ scrollTop: 560, scrollHeight: 1000, clientHeight: 400 })).toBe(
      false,
    );
  });

  it("supports a custom threshold and clamps negative thresholds", () => {
    const metrics = { scrollTop: 590, scrollHeight: 1000, clientHeight: 400 };
    expect(isNearScrollBottom(metrics, 12)).toBe(true);
    expect(isNearScrollBottom(metrics, -1)).toBe(false);
  });
});

describe("the conversation's opening unread boundary", () => {
  const pending = { count: 2, throughId: "40", messageId: null };
  it("counts received messages through the opening cursor and excludes self and new arrivals", () => {
    const boundary = resolveUnreadBoundary(pending, [message("50", 50, false),
      message("40", 40, false, "me"), message("30", 30, false),
      message("20", 20, false), message("10", 10, true)]);
    expect(boundary.messageId).toBe("20");
    expect(resolveUnreadBoundary(boundary, [message("60", 60, false)])).toBe(boundary);
  });
  it("waits for sufficient history and survives immediate read marking and prepends", () => {
    expect(resolveUnreadBoundary(pending, [message("30", 30, false)])).toBe(pending);
    expect(resolveUnreadBoundary(pending, [message("10", 10, true),
      message("20", 20, true), message("30", 30, true)]).messageId).toBe("20");
  });
  it("anchors the first loaded window when the opening cursor is unavailable", () => {
    const empty = { ...pending, throughId: null };
    expect(resolveUnreadBoundary(empty, [])).toBe(empty);
    const first = resolveUnreadBoundary(empty, [message("30", 30, false)]);
    expect(first.throughId).toBe("30");
    expect(resolveUnreadBoundary(first, [message("40", 40, false), message("30", 30, true),
      message("20", 20, true)]).messageId).toBe("20");
  });
  it("does not invent a boundary for zero unread or an unlocatable nonnumeric cursor", () => {
    const read = { count: 0, throughId: "40", messageId: null };
    expect(resolveUnreadBoundary(read, [message("20", 20, false)])).toBe(read);
    const unknown = { ...pending, throughId: "unknown-message" };
    expect(resolveUnreadBoundary(unknown, [message("20", 20, false)])).toBe(unknown);
  });
});
