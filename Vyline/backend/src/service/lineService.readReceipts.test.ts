import { describe, expect, it } from "bun:test";
import type { Message } from "@vyline/types";
import {
  attachGroupReadReceipts,
  memberReadIntervals,
  memberReadWatermarks,
  mergeMessageReadRanges,
  normalizeMessageReadRanges,
  readersForMessageId,
} from "./lineService";

describe("attachGroupReadReceipts", () => {
  it("preserves readers from earlier polls while adding new readers", () => {
    const message = {
      id: "100",
      isMyMessage: true,
      readBy: ["u-old"],
      readCount: 1,
    } as unknown as Message;

    attachGroupReadReceipts(
      [message],
      [
        { mid: "u-new", startExclusive: 0n, endInclusive: 100n },
        { mid: "u-old", startExclusive: 0n, endInclusive: 100n },
      ],
    );

    expect(message.readBy).toEqual(["u-old", "u-new"]);
    expect(message.readCount).toBe(2);
  });

  it("reads the actual TMessageReadRange map shape with one entry per member", () => {
    const marks = memberReadWatermarks(
      [
        {
          chatId: "c-group",
          ranges: {
            "u-reader": [{ startMessageId: "1", endMessageId: "123" }],
          },
        },
      ],
      "c-group",
      "u-self",
    );

    expect(marks).toEqual([{ mid: "u-reader", upTo: 123n }]);
  });

  it("unwraps the thrift success wrapper returned by the raw request client", () => {
    expect(
      normalizeMessageReadRanges({
        success: [{ chatId: "c-group", ranges: {} }],
      }),
    ).toEqual([{ chatId: "c-group", ranges: {} }]);
  });

  it("honors disjoint member ranges instead of filling the gap to the largest id", () => {
    const intervals = memberReadIntervals(
      [
        {
          chatId: "c-group",
          ranges: {
            "u-reader": [
              { startMessageId: "10", endMessageId: "20" },
              { startMessageId: "30", endMessageId: "40" },
            ],
          },
        },
      ],
      "c-group",
      "u-self",
    );

    expect(readersForMessageId(intervals, "15")).toEqual(["u-reader"]);
    expect(readersForMessageId(intervals, "25")).toEqual([]);
    expect(readersForMessageId(intervals, "35")).toEqual(["u-reader"]);

    const messages = ["15", "25", "35"].map(
      (id) => ({ id, isMyMessage: true }) as unknown as Message,
    );
    attachGroupReadReceipts(messages, intervals);
    expect(messages[0]?.readBy).toEqual(["u-reader"]);
    expect(messages[1]?.readBy).toBeUndefined();
    expect(messages[2]?.readBy).toEqual(["u-reader"]);
  });

  it("does not apply another chat's first range as a fallback", () => {
    expect(
      memberReadIntervals(
        [
          {
            chatId: "c-other",
            ranges: {
              "u-reader": [{ startMessageId: "0", endMessageId: "100" }],
            },
          },
        ],
        "c-target",
        "u-self",
      ),
    ).toEqual([]);
  });

  it("normalizes numeric thrift fields from nested result wrappers", () => {
    expect(
      normalizeMessageReadRanges({
        0: [
          {
            1: "c-group",
            2: {
              "u-reader": [{ 1: "10", 2: "20" }],
            },
          },
        ],
      }),
    ).toEqual([
      {
        chatId: "c-group",
        ranges: {
          "u-reader": [{ 1: "10", 2: "20" }],
        },
      },
    ]);
  });

  it("monotonically unions partial and empty read-range responses", () => {
    const previous = [
      {
        chatId: "c-group",
        ranges: {
          "u-a": [{ startMessageId: "0", endMessageId: "100" }],
          "u-b": [{ startMessageId: "20", endMessageId: "30" }],
        },
      },
    ];
    const merged = mergeMessageReadRanges(previous, [
      {
        chatId: "c-group",
        ranges: {
          "u-a": [{ startMessageId: "100", endMessageId: "150" }],
        },
      },
    ]);

    expect(memberReadIntervals(merged, "c-group", "u-self")).toEqual([
      { mid: "u-a", startExclusive: 0n, endInclusive: 150n },
      { mid: "u-b", startExclusive: 20n, endInclusive: 30n },
    ]);
    expect(memberReadIntervals(mergeMessageReadRanges(merged, []), "c-group", "u-self")).toEqual(
      memberReadIntervals(merged, "c-group", "u-self"),
    );
  });
});
