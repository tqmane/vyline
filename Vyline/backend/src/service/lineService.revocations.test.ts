import { afterEach, expect, mock, spyOn, test } from "bun:test";
import * as manager from "../line/clientManager.js";
import * as storage from "../storage/chatStore.js";
import { detachFetchOps, pollTalkEvents, processFetchedOperations } from "./lineService.js";

const undo: Array<() => void> = [];
afterEach(() => { for (const restore of undo.splice(0)) restore(); mock.restore(); });

test("a received message and revoke are committed before either event is visible", async () => {
  const account = "revoke-commit-order";
  const client = { base: { profile: { mid: "u-self" } } } as never;
  undo.push(() => detachFetchOps(account));
  spyOn(manager, "getClient").mockReturnValue(client);
  spyOn(storage, "isMessageDeletedLocally").mockResolvedValue(false);
  const save = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>();
  spyOn(storage, "upsertMessages").mockImplementation(async () => {
    entered.resolve(); await save.promise;
  });
  const revoke = Promise.withResolvers<void>();
  const revoking = Promise.withResolvers<void>();
  spyOn(storage, "markMessageRevoked").mockImplementation(async () => {
    revoking.resolve(); await revoke.promise;
  });
  const pending = processFetchedOperations(account, [
    { type: 26, message: { id: "100", from: "u-peer", to: "u-self", text: "saved", contentType: "NONE", createdTime: 1000 } },
    { type: 8, param1: "100", param2: "u-peer" },
  ]);
  await entered.promise;
  const beforeSave = pollTalkEvents(account, 0).events;
  save.resolve();
  await revoking.promise;
  const beforeRevoke = pollTalkEvents(account, 0).events;
  revoke.resolve();
  await pending;
  expect(beforeSave).toEqual([]);
  expect(beforeRevoke.map(event => event.kind)).toEqual(["message"]);
  expect(pollTalkEvents(account, 0).events.map(event => event.kind)).toEqual(["message", "revoke"]);
});

test("a revoke awaiting storage never publishes into a replaced session", async () => {
  const account = "revoke-retired-session";
  const original = { base: { profile: { mid: "u-self" } } } as never;
  let current = original;
  undo.push(() => detachFetchOps(account));
  spyOn(manager, "getClient").mockImplementation(() => current);
  const entered = Promise.withResolvers<void>();
  const saved = Promise.withResolvers<void>();
  spyOn(storage, "markMessageRevoked").mockImplementation(async () => {
    entered.resolve(); await saved.promise;
  });
  const pending = processFetchedOperations(account, [{ type: 8, param1: "100", param2: "u-peer" }]);
  await entered.promise;
  current = { base: { profile: { mid: "u-replacement" } } } as never;
  saved.resolve();
  await pending;
  expect(pollTalkEvents(account, 0).events).toEqual([]);
});
