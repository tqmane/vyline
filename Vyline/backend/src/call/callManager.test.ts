import { expect, spyOn, test } from "bun:test";
import * as sessionFactory from "./sessionFactory.js";
import {
  callWebSocketHandler,
  endManagedCall,
  listAccountCalls,
  startManagedCall,
  type CallWsData,
} from "./callManager.js";

test("closing the last call WebSocket ends the orphaned session", async () => {
  let endCalls = 0;
  const session = {
    state: "connecting",
    on() {},
    async start() {},
    async end() {
      endCalls++;
      this.state = "ended";
    },
  };
  const create = spyOn(sessionFactory, "createDirectCallSession").mockResolvedValue({
    session,
    transportKind: "planet",
    wire: { deviceDetails: { device: "IOSIPAD" } },
  } as never);
  const accountId = "call-ws-disconnect-test";
  const created = await startManagedCall({ accountId, client: {} as never, to: "u-peer" });
  const ws = {
    data: { accountId, sessionId: created.sessionId } satisfies CallWsData,
    send() {},
    close() {},
  } as never;

  try {
    callWebSocketHandler.close(ws);
    await Bun.sleep(0);
    expect(endCalls).toBe(0);

    callWebSocketHandler.open(ws);
    callWebSocketHandler.close(ws);
    await Promise.all([endManagedCall(created.sessionId), endManagedCall(created.sessionId)]);

    expect(endCalls).toBe(1);
    expect(listAccountCalls(accountId)).toHaveLength(0);
  } finally {
    create.mockRestore();
    await endManagedCall(created.sessionId);
  }
});
