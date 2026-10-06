import { expect, test } from "bun:test";
import { removeClient, runSendRpc } from "./clientManager.js";

test("a timed-out send keeps the account queue until the underlying work settles", async () => {
  let releaseFirst!: () => void;
  const firstWork = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const firstResult = runSendRpc("queue-timeout", () => firstWork, { timeoutMs: 5 }).catch(
    (error) => error,
  );
  await Bun.sleep(15);
  expect(await firstResult).toBeInstanceOf(Error);

  let secondStarted = false;
  const second = runSendRpc("queue-timeout", async () => {
    secondStarted = true;
    return "second";
  });
  await Bun.sleep(10);
  expect(secondStarted).toBe(false);

  releaseFirst();
  expect(await second).toBe("second");
  expect(secondStarted).toBe(true);
});

test("abort-on-timeout waits for upload cleanup before rejecting", async () => {
  let cleaned = false;
  const result = runSendRpc(
    "queue-abort",
    async (signal) => {
      if (!signal) throw new Error("missing abort signal");
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            setTimeout(() => {
              cleaned = true;
              reject(signal.reason);
            }, 10);
          },
          { once: true },
        );
      });
    },
    { timeoutMs: 5, abortOnTimeout: true },
  );

  await expect(result).rejects.toThrow("send timed out");
  expect(cleaned).toBe(true);
});

test("a queued send cannot run after its account session is removed", async () => {
  let release!: () => void;
  let started!: () => void;
  const work = new Promise<void>((resolve) => { release = resolve; });
  const ready = new Promise<void>((resolve) => { started = resolve; });
  const first = runSendRpc("retired-queue", () => { started(); return work; });
  await ready;
  let sent = false;
  const queued = runSendRpc("retired-queue", async () => { sent = true; }).catch((error) => error);
  removeClient("retired-queue");
  release();
  await first;
  const error = await queued;
  expect(error).toBeInstanceOf(Error);
  expect(error.message).toContain("session");
  expect(sent).toBe(false);
  expect(await runSendRpc("retired-queue", async () => "fresh")).toBe("fresh");
});
