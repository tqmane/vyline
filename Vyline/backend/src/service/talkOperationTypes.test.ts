import { describe, expect, it } from "bun:test";
import { isReadOperationType, isReceiveMessageOperationType, groupMembershipKind } from "./talkOperationTypes";

describe("Talk operation type classification", () => {
  it("keeps SEND_MESSAGE (25) out of receive and read paths", () => {
    expect(isReceiveMessageOperationType("25")).toBe(false);
    expect(isReadOperationType("25")).toBe(false);
  });

  it("recognizes the protocol receive-message code", () => {
    expect(isReceiveMessageOperationType("26")).toBe(true);
  });

  it("recognizes read notifications and watermarks", () => {
    expect(isReadOperationType("55")).toBe(true);
    expect(isReadOperationType("28")).toBe(true);
    expect(isReadOperationType("91")).toBe(true);
  });
});

it("classifies real chat membership opcodes without treating unrelated events as invitations", () => {
  for (const code of ["123", "124", "12", "13", "NOTIFIED_INVITE_INTO_CHAT"]) expect(groupMembershipKind(code)).toBe("invited");
  for (const code of ["129", "130", "16", "17"]) expect(groupMembershipKind(code)).toBe("joined");
  expect(groupMembershipKind("128")).toBe("left");
  expect(groupMembershipKind("133")).toBe("kicked");
  for (const code of ["33", "34", "35", "122", "126"]) expect(groupMembershipKind(code)).toBeUndefined();
});
