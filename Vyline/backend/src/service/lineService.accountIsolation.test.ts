import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as clientManager from "../line/clientManager.js";
import { ensureGroupE2EEKey, sendMessage } from "./lineService.js";

afterEach(() => mock.restore());

function missingGroupKeyClient(label: string, calls: string[]) {
  return {
    base: {
      talk: {
        getLastE2EEGroupSharedKey: async () => {
          calls.push(label);
          throw new Error("NOT_FOUND: there is no valid group key");
        },
      },
    },
  } as never;
}

describe("group E2EE account isolation", () => {
  test("a missing-key result from one account does not suppress lookup for another account", async () => {
    const calls: string[] = [];
    const chatMid = `c${crypto.randomUUID().replaceAll("-", "")}`;

    await ensureGroupE2EEKey(missingGroupKeyClient("account-a", calls), "account-a", chatMid);
    await ensureGroupE2EEKey(missingGroupKeyClient("account-b", calls), "account-b", chatMid);

    expect(calls).toEqual(["account-a", "account-b"]);
  });

  test("one account's retry-plain result does not force another account to skip E2EE setup", async () => {
    const chatMid = `c${crypto.randomUUID().replaceAll("-", "")}`;
    const lookupCalls: string[] = [];
    await ensureGroupE2EEKey(
      {
        base: {
          talk: {
            getLastE2EEGroupSharedKey: async () => {
              lookupCalls.push("account-a");
              throw new Error("E2EE_RETRY_PLAIN: member settings off");
            },
          },
        },
      } as never,
      "account-a",
      chatMid,
    );

    const sent: Array<Record<string, unknown>> = [];
    const accountB = {
      base: {
        profile: { mid: "u11111111111111111111111111111111" },
        talk: {
          getLastE2EEGroupSharedKey: async () => {
            lookupCalls.push("account-b");
            throw new Error("E2EE_RETRY_PLAIN: member settings off");
          },
          sendMessage: async (request: Record<string, unknown>) => {
            sent.push(request);
            return null;
          },
        },
      },
    } as never;
    spyOn(clientManager, "getClient").mockReturnValue(accountB);

    await sendMessage("account-b", chatMid, "hello");

    expect(lookupCalls.filter((value) => value === "account-b").length).toBeGreaterThan(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: chatMid, text: "hello", e2ee: false });
    expect(sent[0]).not.toHaveProperty("chunks");
  });
});
