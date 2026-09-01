import { describe, expect, it } from "bun:test";
import type { Message } from "@vyline/types";
import {
  attachGroupReadReceipts,
  memberReadIntervals,
  memberReadWatermarks,
  mergeMessageReadRanges,
  normalizeMessageReadRanges,
  readersForMessageId,
  readTimesForMessageId,
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

  it("keeps the first read time per received message when a cumulative range grows", () => {
    const first = mergeMessageReadRanges(
      [],
      [
        {
          chatId: "c-group",
          ranges: {
            "u-reader": [
              {
                startMessageId: "0",
                endMessageId: "100",
                startTime: 10_000,
                endTime: 10_000,
              },
            ],
          },
        },
      ],
    );
    const second = mergeMessageReadRanges(first, [
      {
        chatId: "c-group",
        ranges: {
          "u-reader": [
            {
              startMessageId: "0",
              endMessageId: "200",
              startTime: 11_000,
              endTime: 11_000,
            },
          ],
        },
      },
    ]);
    const intervals = memberReadIntervals(second, "c-group");

    expect(intervals).toEqual([
      { mid: "u-reader", startExclusive: 0n, endInclusive: 100n, readAt: 10_000 },
      { mid: "u-reader", startExclusive: 100n, endInclusive: 200n, readAt: 11_000 },
    ]);
    expect(readTimesForMessageId(intervals, "100")).toEqual({ "u-reader": 10_000 });
    expect(readTimesForMessageId(intervals, "200")).toEqual({ "u-reader": 11_000 });

    const messages = [
      {
        id: "100",
        from: "u-sender",
        createdTime: 1_000,
        isMyMessage: false,
      },
      {
        id: "200",
        from: "u-sender",
        createdTime: 2_000,
        isMyMessage: false,
      },
      {
        id: "150",
        from: "u-self",
        createdTime: 1_500,
        isMyMessage: true,
      },
    ] as unknown as Message[];
    attachGroupReadReceipts(messages, intervals);

    expect(messages[0]?.readByAt).toEqual({ "u-reader": 10_000 });
    expect(messages[1]?.readByAt).toEqual({ "u-reader": 11_000 });
    expect(messages[2]?.readByAt).toEqual({ "u-reader": 11_000 });

    attachGroupReadReceipts(messages, [
      { mid: "u-reader", startExclusive: 0n, endInclusive: 300n, readAt: 12_000 },
    ]);
    expect(messages[0]?.readByAt).toEqual({ "u-reader": 10_000 });
    expect(messages[1]?.readByAt).toEqual({ "u-reader": 11_000 });
  });

  it("never counts the message sender as a reader", () => {
    const message = {
      id: "100",
      from: "u-sender",
      createdTime: 1_000,
      isMyMessage: false,
    } as unknown as Message;

    attachGroupReadReceipts(
      [message],
      [
        { mid: "u-sender", startExclusive: 0n, endInclusive: 100n, readAt: 9_000 },
        { mid: "u-reader", startExclusive: 0n, endInclusive: 100n, readAt: 10_000 },
      ],
    );

    expect(message.readBy).toEqual(["u-reader"]);
    expect(message.readByAt).toEqual({ "u-reader": 10_000 });
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
