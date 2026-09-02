import { describe, expect, it } from "bun:test";
import type { CallSessionInfo } from "@vyline/types";
import {
  activeCallFromSession,
  friendlyCallError,
  pickRecoverableCall,
} from "./callSession";

function session(
  state: CallSessionInfo["state"],
  overrides: Partial<CallSessionInfo> = {},
): CallSessionInfo {
  return {
    sessionId: `session-${state}`,
    accountId: "account-a",
    to: "u123",
    kind: "AUDIO",
    state,
    transport: "planet",
    startedAt: 1,
    ...overrides,
  };
}

describe("call session UI helpers", () => {
  it("restores the first non-terminal call", () => {
    const active = pickRecoverableCall([
      session("failed"),
      session("ended"),
      session("ringing", { sessionId: "live" }),
    ]);
    expect(active?.sessionId).toBe("live");
  });

  it("does not restore terminal calls", () => {
    expect(pickRecoverableCall([session("failed"), session("ended")])).toBeNull();
  });

  it("maps backend call sessions to the frontend shape", () => {
    expect(
      activeCallFromSession(
        session("in-call", { kind: "VIDEO", transport: "andromeda", error: "boom" }),
      ),
    ).toEqual({
      sessionId: "session-in-call",
      to: "u123",
      kind: "video",
      state: "in-call",
      transport: "andromeda",
      error: "boom",
    });
  });

  it("turns thrown backend errors into useful call errors", () => {
    expect(friendlyCallError(new Error("BACKEND_DOWN"))).toBe("バックエンドに接続できません");
    expect(friendlyCallError(new Error("PLANET reply timeout"))).toBe("応答がありませんでした");
  });
});
