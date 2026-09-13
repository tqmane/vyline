import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as lineService from "../service/lineService.js";
import * as messageLog from "../storage/messageLog.js";
import { lineRouter } from "./line.js";

afterEach(() => mock.restore());

describe("message API numeric queries", () => {
  test("normalizes all history limits before they reach storage or RPC", async () => {
    const fetch = spyOn(lineService, "fetchMessages").mockResolvedValue([]);
    const delta = spyOn(lineService, "fetchMessagesSince").mockResolvedValue([]);
    const logs = spyOn(messageLog, "readRecentMessageLog").mockResolvedValue([]);
    const cases = [
      {
        path: "/account/messages/c-test?",
        fallback: 30,
        max: 100,
        probe: false,
        calls: fetch.mock.calls,
        argument: 2,
      },
      {
        path: "/account/messages/c-test?local=1&",
        fallback: 30,
        max: 10_000,
        probe: true,
        calls: fetch.mock.calls,
        argument: 2,
      },
      {
        path: "/account/messages/c-test/delta?after=123&",
        fallback: 25,
        max: 50,
        probe: false,
        calls: delta.mock.calls,
        argument: 3,
      },
      {
        path: "/account/export/c-test?",
        fallback: 200,
        max: 500,
        probe: false,
        calls: fetch.mock.calls,
        argument: 2,
      },
      {
        path: "/account/log?",
        fallback: 200,
        max: 2000,
        probe: false,
        calls: logs.mock.calls,
        argument: 1,
      },
    ];
    for (const route of cases) {
      const inputs: Array<[string | undefined, number]> = [
        [undefined, route.fallback],
        ["", route.fallback],
        [" ", route.fallback],
        ["oops", route.fallback],
        ["NaN", route.fallback],
        ["Infinity", route.fallback],
        ["-Infinity", route.fallback],
        ["-5", 1],
        ["0", 1],
        ["2.9", 2],
        ["1000000", route.max],
      ];
      for (const [raw, expected] of inputs) {
        const response = await lineRouter.request(
          `${route.path}${raw == null ? "" : `limit=${encodeURIComponent(raw)}`}`,
        );
        expect(response.status).toBe(200);
        expect(route.calls.at(-1)?.[route.argument]).toBe(expected + Number(route.probe));
      }
    }
  });

  test("drops unsafe pagination timestamps before the service converts them to BigInt", async () => {
    const fetch = spyOn(lineService, "fetchMessages").mockResolvedValue([]);
    for (const raw of ["not-a-date", "Infinity", "1.5", "-1", "9007199254740992"]) {
      const response = await lineRouter.request(
        `/account/messages/c-test?beforeMessageId=123&beforeDeliveredTime=${raw}`,
      );
      expect(response.status).toBe(200);
      expect(fetch.mock.calls.at(-1)?.[3]).toEqual({ beforeMessageId: "123" });
    }
    await lineRouter.request(
      "/account/messages/c-test?beforeMessageId=123&beforeDeliveredTime=1720000000000",
    );
    expect(fetch.mock.calls.at(-1)?.[3]).toEqual({
      beforeMessageId: "123",
      beforeDeliveredTime: 1720000000000,
    });
  });
});
