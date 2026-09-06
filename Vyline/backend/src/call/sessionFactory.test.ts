import { expect, test } from "bun:test";
import { acquireManagedGroupRoute } from "./sessionFactory.js";

test("group route uses fresh membership state and never turns lookup errors into host creation", async () => {
  const chatMid = "c932e3b8ae8bf6b0fc19b512c40cda944";
  const requests: unknown[] = [];
  let status: unknown = { online: true, chatMid };
  const client = {
    call: {
      async getGroupCall(mid: string) {
        expect(mid).toBe(chatMid);
        if (status instanceof Error) throw status;
        return status;
      },
      async acquireGroupRoute(input: unknown) {
        requests.push(input);
        return { token: "test-only" };
      },
    },
  } as never;
  await acquireManagedGroupRoute(client, chatMid, "AUDIO");
  status = { online: false, chatMid };
  await acquireManagedGroupRoute(client, chatMid, "VIDEO");
  expect(requests).toEqual([
    { chatMid, mediaType: "AUDIO", isInitialHost: false, capabilities: [] },
    { chatMid, mediaType: "VIDEO", isInitialHost: true, capabilities: [] },
  ]);
  for (status of [new Error("offline"), null, {}, { online: true, chatMid: "another-room" }]) {
    await expect(acquireManagedGroupRoute(client, chatMid, "AUDIO")).rejects.toThrow();
  }
  await expect(acquireManagedGroupRoute(client, "u-peer", "AUDIO")).rejects.toThrow();
  expect(requests).toHaveLength(2);
});
