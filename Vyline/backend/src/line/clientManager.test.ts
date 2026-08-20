import { afterEach, describe, expect, test } from "bun:test";
import { resolveSyncDeviceContext, resolveTalkListenerMode } from "./clientManager.js";

const ORIGINAL = process.env.VYLINE_TALK_LISTEN;
const ORIGINAL_SYNC_APP_STATE = process.env.VYLINE_SYNC_APP_STATE;
const ORIGINAL_SYNC_ACCESS_MODE = process.env.VYLINE_SYNC_ACCESS_MODE;
const ORIGINAL_SYNC_CARRIER_CODE = process.env.VYLINE_SYNC_CARRIER_CODE;

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) Reflect.deleteProperty(process.env, name);
  else process.env[name] = value;
}

function unsetEnv(name: string): void {
  Reflect.deleteProperty(process.env, name);
}

afterEach(() => {
  restoreEnv("VYLINE_TALK_LISTEN", ORIGINAL);
  restoreEnv("VYLINE_SYNC_APP_STATE", ORIGINAL_SYNC_APP_STATE);
  restoreEnv("VYLINE_SYNC_ACCESS_MODE", ORIGINAL_SYNC_ACCESS_MODE);
  restoreEnv("VYLINE_SYNC_CARRIER_CODE", ORIGINAL_SYNC_CARRIER_CODE);
});

describe("resolveSyncDeviceContext", () => {
  test("uses truthful background and wifi defaults without inventing a carrier", () => {
    unsetEnv("VYLINE_SYNC_APP_STATE");
    unsetEnv("VYLINE_SYNC_ACCESS_MODE");
    unsetEnv("VYLINE_SYNC_CARRIER_CODE");
    expect(resolveSyncDeviceContext()).toEqual({ appState: "B", accessMode: "w" });
  });

  test("accepts only the known header values and a numeric carrier code", () => {
    process.env.VYLINE_SYNC_APP_STATE = "F";
    process.env.VYLINE_SYNC_ACCESS_MODE = "m";
    process.env.VYLINE_SYNC_CARRIER_CODE = "46692";
    expect(resolveSyncDeviceContext()).toEqual({
      appState: "F",
      accessMode: "m",
      carrierCode: "46692",
    });

    process.env.VYLINE_SYNC_CARRIER_CODE = "46692\r\nx-evil: 1";
    expect(resolveSyncDeviceContext()).toEqual({ appState: "F", accessMode: "m" });
  });
});

describe("resolveTalkListenerMode", () => {
  test("defaults to non-consuming history polling", () => {
    unsetEnv("VYLINE_TALK_LISTEN");
    expect(resolveTalkListenerMode(undefined)).toBe("history");
  });

  test("requires an explicit sync mode", () => {
    unsetEnv("VYLINE_TALK_LISTEN");
    expect(resolveTalkListenerMode("sync")).toBe("sync");
  });

  test("keeps the legacy disable switch", () => {
    process.env.VYLINE_TALK_LISTEN = "0";
    expect(resolveTalkListenerMode("sync")).toBe("off");
  });
});
