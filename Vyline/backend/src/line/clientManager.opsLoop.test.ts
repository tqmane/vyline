import { expect, spyOn, test } from "bun:test";
import * as clientManager from "./clientManager.js";
import * as lineService from "../service/lineService.js";

// The /S4 long poll cannot be aborted, so a loop superseded by a re-login or an
// account removal can still resolve. It must then do nothing: stopFetchOpsLoop
// already cleared the cursor and a replacement loop owns the account.

test("a superseded ops loop neither advances the cursor nor replays operations", async () => {
  const accountId = "superseded-ops-loop";
  let releaseSync!: () => void;
  const parked = new Promise<void>((resolve) => {
    releaseSync = resolve;
  });
  let syncCalls = 0;
  const staleClient = {
    base: {
      authToken: "token",
      talk: {
        sync() {
          syncCalls += 1;
          return parked.then(() => ({
            operationResponse: {
              operations: [{ revision: 105, type: "SEND_MESSAGE", param1: "u-peer" }],
              globalEvents: { lastRevision: 7 },
              individualEvents: { lastRevision: 9 },
            },
          }));
        },
      },
    },
  } as never;
  // The replacement loop stays parked for the whole test, so any dispatch can
  // only come from the superseded loop.
  const replacementClient = {
    base: { authToken: "token", talk: { sync: () => new Promise(() => {}) } },
  } as never;

  const dispatched = spyOn(lineService, "processFetchedOperations").mockResolvedValue(undefined);
  try {
    clientManager.startFetchOpsLoop(staleClient, accountId);
    // The loop is parked inside talk.sync when the account is replaced.
    await Bun.sleep(20);
    expect(syncCalls).toBe(1);

    clientManager.stopFetchOpsLoop(accountId);
    clientManager.startFetchOpsLoop(replacementClient, accountId);
    releaseSync();
    await Bun.sleep(30);

    expect(dispatched).not.toHaveBeenCalled();
  } finally {
    clientManager.stopFetchOpsLoop(accountId);
    dispatched.mockRestore();
  }
});

test("a live ops loop still dispatches operations", async () => {
  const accountId = "live-ops-loop";
  const previous = process.env.VYLINE_OPS_POLL_MS;
  process.env.VYLINE_OPS_POLL_MS = "1";
  const dispatched: string[][] = [];
  const client = {
    base: {
      authToken: "token",
      talk: {
        sync: async () => ({
          operationResponse: {
            operations: [{ revision: 1, type: "SEND_MESSAGE" }],
            globalEvents: { lastRevision: 1 },
            individualEvents: { lastRevision: 1 },
          },
        }),
      },
    },
  } as never;
  const processOps = spyOn(lineService, "processFetchedOperations").mockImplementation(
    async (_accountId, ops) => {
      dispatched.push(ops.map((op) => String(op.type)));
    },
  );
  try {
    clientManager.startFetchOpsLoop(client, accountId);
    await Bun.sleep(60);
    expect(dispatched.length).toBeGreaterThan(0);
  } finally {
    clientManager.stopFetchOpsLoop(accountId);
    processOps.mockRestore();
    if (previous === undefined) Reflect.deleteProperty(process.env, "VYLINE_OPS_POLL_MS");
    else process.env.VYLINE_OPS_POLL_MS = previous;
  }
});
