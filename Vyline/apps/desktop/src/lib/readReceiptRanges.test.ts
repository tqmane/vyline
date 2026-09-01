import { describe, expect, it } from "bun:test";
import {
  maxMessageId,
  mergeReadByAt,
  mergeMemberReadRanges,
  mergeMemberReadWatermarks,
  readersForMessageId,
  readTimesForMessageId,
} from "./readReceiptRanges.js";

describe("group read receipt ranges", () => {
  it("keeps gaps instead of treating the largest end id as one watermark", () => {
    const ranges = [
      { mid: "u-reader", startExclusive: "10", endInclusive: "20" },
      { mid: "u-reader", startExclusive: "30", endInclusive: "40" },
    ];

    expect(readersForMessageId(ranges, "15")).toEqual(["u-reader"]);
    expect(readersForMessageId(ranges, "25")).toEqual([]);
    expect(readersForMessageId(ranges, "35")).toEqual(["u-reader"]);
  });

  it("monotonically merges overlapping, adjacent, and partial poll results", () => {
    expect(
      mergeMemberReadRanges(
        [
          { mid: "u-a", startExclusive: "0", endInclusive: "100" },
          { mid: "u-b", startExclusive: "20", endInclusive: "30" },
        ],
        [
          { mid: "u-a", startExclusive: "100", endInclusive: "150" },
          { mid: "u-b", startExclusive: "50", endInclusive: "60" },
        ],
      ),
    ).toEqual([
      { mid: "u-a", startExclusive: "0", endInclusive: "150" },
      { mid: "u-b", startExclusive: "20", endInclusive: "30" },
      { mid: "u-b", startExclusive: "50", endInclusive: "60" },
    ]);
  });

  it("splits cumulative ranges so older messages keep their first read time", () => {
    const first = mergeMemberReadRanges(undefined, [
      { mid: "u-reader", startExclusive: "0", endInclusive: "100", readAt: 10_000 },
    ]);
    const second = mergeMemberReadRanges(first, [
      { mid: "u-reader", startExclusive: "0", endInclusive: "200", readAt: 11_000 },
    ]);

    expect(second).toEqual([
      { mid: "u-reader", startExclusive: "0", endInclusive: "100", readAt: 10_000 },
      { mid: "u-reader", startExclusive: "100", endInclusive: "200", readAt: 11_000 },
    ]);
    expect(readTimesForMessageId(second, "100")).toEqual({ "u-reader": 10_000 });
    expect(readTimesForMessageId(second, "200")).toEqual({ "u-reader": 11_000 });
    expect(mergeReadByAt({ "u-reader": 10_000 }, { "u-reader": 12_000 })).toEqual({
      "u-reader": 10_000,
    });
  });

  it("keeps the greatest legacy watermark and direct-chat watermark", () => {
    expect(
      mergeMemberReadWatermarks(
        [{ mid: "u-a", upTo: "100" }],
        [
          { mid: "u-a", upTo: "90" },
          { mid: "u-b", upTo: "80" },
        ],
      ),
    ).toEqual([
      { mid: "u-a", upTo: "100" },
      { mid: "u-b", upTo: "80" },
    ]);
    expect(maxMessageId("100", "90")).toBe("100");
    expect(maxMessageId(undefined, "120")).toBe("120");
  });
});
