import { expect, spyOn, test } from "bun:test";
import * as sessionFactory from "./sessionFactory.js";
import { findIncomingCall, rememberIncomingCall } from "./incomingCallRegistry.js";
import {
  endManagedCall,
  endAccountCallMatching,
  listAccountCalls,
  startManagedCall,
} from "./callManager.js";
import { detachFetchOps } from "../service/lineService.js";

// `reserveCallAccount` allows exactly one live call per account. If the entry is
// not released when the account goes away, the account can never call again.

function fakeSession() {
  return {
    state: "idle" as string,
    on() {},
    async start() {
      this.state = "in-call";
    },
    async end() {
      this.state = "ended";
    },
  };
}

test("detaching the account (logout) ends the managed call so the account can call again", async () => {
  const accountId = "detach-ends-call";
  const session = fakeSession();
  const create = spyOn(sessionFactory, "createDirectCallSession").mockResolvedValue({
    session,
    transportKind: "planet",
    wire: { deviceDetails: { device: "IOSIPAD" } },
  } as never);
  const created = await startManagedCall({
    accountId,
    client: {} as never,
    to: `u${"1".repeat(32)}`,
  });
  expect(listAccountCalls(accountId)).toHaveLength(1);
  expect(session.state).toBe("in-call");

  // removeClient() calls detachFetchOps(); the session must not outlive the client.
  detachFetchOps(accountId);

  expect(listAccountCalls(accountId)).toHaveLength(0);
  expect(session.state).toBe("ended");
  // A second call for the same account must be accepted rather than rejected as busy.
  const second = await startManagedCall({
    accountId,
    client: {} as never,
    to: `u${"2".repeat(32)}`,
  });
  expect(second.sessionId).not.toBe(created.sessionId);
  create.mockRestore();
  await endManagedCall(second.sessionId);
}, 20_000);

test("a peer cancel ends the established call instead of leaving it in-call", async () => {
  const accountId = "cancel-ends-active-call";
  const peerMid = `u${"5".repeat(32)}`;
  const session = fakeSession();
  const create = spyOn(sessionFactory, "createDirectCallSession").mockResolvedValue({
    session,
    transportKind: "planet",
    wire: { deviceDetails: { device: "IOSIPAD" } },
  } as never);
  await startManagedCall({ accountId, client: {} as never, to: peerMid });
  expect(listAccountCalls(accountId)[0]?.state).toBe("in-call");

  // CANCEL_CALL(51) carries the peer MID in param2 for an established call.
  await endAccountCallMatching(accountId, [peerMid]);

  expect(session.state).toBe("ended");
  expect(listAccountCalls(accountId)).toHaveLength(0);
  create.mockRestore();
}, 20_000);

test("a peer cancel for an unrelated peer leaves the call alone", async () => {
  const accountId = "cancel-unrelated-peer";
  const peerMid = `u${"6".repeat(32)}`;
  const session = fakeSession();
  const create = spyOn(sessionFactory, "createDirectCallSession").mockResolvedValue({
    session,
    transportKind: "planet",
    wire: { deviceDetails: { device: "IOSIPAD" } },
  } as never);
  await startManagedCall({ accountId, client: {} as never, to: peerMid });

  await endAccountCallMatching(accountId, [`u${"7".repeat(32)}`]);

  expect(listAccountCalls(accountId)).toHaveLength(1);
  expect(session.state).toBe("in-call");
  create.mockRestore();
  await endAccountCallMatching(accountId, [peerMid]);
}, 20_000);

test("a failed outgoing call keeps pending incoming calls", async () => {
  const accountId = "failed-outgoing-preserves-incoming";
  const peerMid = `u${"3".repeat(32)}`;
  const incoming = {
    callMid: "1",
    from: `u${"4".repeat(32)}`,
    to: accountId,
    receivedAt: Date.now(),
    kind: "AUDIO" as const,
    route: {} as never,
    communicationId: "1",
    callerMid: `u${"4".repeat(32)}`,
  };
  rememberIncomingCall(accountId, incoming as never);
  const create = spyOn(sessionFactory, "createDirectCallSession").mockRejectedValue(
    new Error("route failed"),
  );
  try {
    await expect(startManagedCall({ accountId, client: {} as never, to: peerMid })).rejects.toThrow(
      "route failed",
    );
    // The ring for an unrelated caller must survive a failed outgoing attempt.
    expect(findIncomingCall(accountId, "1")).not.toBeNull();
  } finally {
    create.mockRestore();
    detachFetchOps(accountId);
  }
}, 20_000);
