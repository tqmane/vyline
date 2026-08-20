import { describe, expect, test } from "bun:test";
import { TalkService } from "./mod.js";

describe("TalkService.sync device context", () => {
  test("adds only the supported polling presence headers", async () => {
    let requestArgs: unknown[] = [];
    const client = {
      config: { longTimeout: 60_000 },
      request: {
        request: async (...args: unknown[]) => {
          requestArgs = args;
          return { operationResponse: { operations: [] } };
        },
      },
    };
    const service = new TalkService(client as never);

    await service.sync({
      deviceContext: { appState: "B", accessMode: "w", carrierCode: "46692" },
    });

    expect(requestArgs[4]).toBe("/SYNC4");
    expect(requestArgs[5]).toEqual({ "x-las": "B", "x-lam": "w", "x-lac": "46692" });
  });

  test("drops an invalid carrier value at the protocol boundary", async () => {
    let headers: unknown;
    const client = {
      config: { longTimeout: 60_000 },
      request: {
        request: async (...args: unknown[]) => {
          headers = args[5];
          return {};
        },
      },
    };
    const service = new TalkService(client as never);

    await service.sync({
      deviceContext: {
        appState: "F",
        accessMode: "m",
        carrierCode: "46692\r\nx-line-access: stolen",
      },
    });

    expect(headers).toEqual({ "x-las": "F", "x-lam": "m" });
  });
});
