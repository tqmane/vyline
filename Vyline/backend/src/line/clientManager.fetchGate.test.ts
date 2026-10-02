import { expect, test } from "bun:test";
import { runTalkFetchUrgent } from "./clientManager.js";

// The gate exists so overlapping history RPCs for one account never overlap
// (Desktop 参照: push は止めず /S4 を直列化する). It must stay registered until the
// last queued entry has finished, not merely the last running one.

test("the fetch gate keeps queued history RPCs serialized", async () => {
  const order: string[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const first = runTalkFetchUrgent("fetch-gate", async () => {
    order.push("first:start");
    await firstGate;
    order.push("first:end");
  });
  const second = runTalkFetchUrgent("fetch-gate", async () => {
    order.push("second:start");
    await Bun.sleep(20);
    order.push("second:end");
  });

  // Let `first` start and `second` queue behind it.
  await Bun.sleep(0);
  releaseFirst();
  await first;

  // Arrives in the window where `first` has finished but `second` is still queued.
  const third = runTalkFetchUrgent("fetch-gate", async () => {
    order.push("third:start");
  });
  await Promise.all([second, third]);

  expect(order).toEqual([
    "first:start",
    "first:end",
    "second:start",
    "second:end",
    "third:start",
  ]);
});

test("the gate is released once the queue drains", async () => {
  let ran = 0;
  for (let index = 0; index < 3; index++) {
    await runTalkFetchUrgent("fetch-gate-drain", async () => {
      ran += 1;
    });
  }
  expect(ran).toBe(3);
});

test("a failing entry does not wedge the gate", async () => {
  await expect(
    runTalkFetchUrgent("fetch-gate-error", async () => {
      throw new Error("boom");
    }),
  ).rejects.toThrow("boom");
  expect(
    await runTalkFetchUrgent("fetch-gate-error", async () => "recovered"),
  ).toBe("recovered");
});
