import { describe, expect, it } from "bun:test";
import {
  isReadOperationType,
  isReceiveMessageOperationType,
  isRevokeOperationType,
} from "./talkOperationTypes";

describe("Talk operation type classification", () => {
  it("recognizes revoke operations without confusing contact operations", () => {
    for (const type of ["64", "65", "DESTROY_MESSAGE", "NOTIFIED_DESTROY_MESSAGE"]) {
      expect(isRevokeOperationType(type)).toBe(true);
    }
    for (const type of ["7", "8", "26", "55", ""]) expect(isRevokeOperationType(type)).toBe(false);
  });
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
