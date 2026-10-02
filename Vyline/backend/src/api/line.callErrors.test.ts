import { expect, spyOn, test } from "bun:test";
import { lineRouter } from "./line.js";
import * as service from "../service/lineService.js";

// Busy/stale call conditions are ordinary user actions (double-tap 応答, 発信
// while already in a call, answering a ring the peer already cancelled). They
// must reach the user as their own message and a 4xx, not as a server fault.

const start = (body: unknown) =>
  lineRouter.request("/owner/call/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const answer = (body: unknown) =>
  lineRouter.request("/owner/call/answer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

test("starting a call while one is active answers 409 with the caller's message", async () => {
  const startCall = spyOn(service, "startDirectCall").mockRejectedValue(
    service.callConflict("すでに通話中です"),
  );
  try {
    const response = await start({ to: `u${"a".repeat(32)}` });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ ok: false, error: "すでに通話中です" });
  } finally {
    startCall.mockRestore();
  }
});

test("starting a call while one is still connecting answers 409 too", async () => {
  const startCall = spyOn(service, "startDirectCall").mockRejectedValue(
    service.callConflict("通話の接続処理中です"),
  );
  try {
    const response = await start({ to: `u${"b".repeat(32)}` });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ ok: false, error: "通話の接続処理中です" });
  } finally {
    startCall.mockRestore();
  }
});

test("answering a ring that already ended answers 410 with the caller's message", async () => {
  const answerCall = spyOn(service, "answerDirectCall").mockRejectedValue(
    service.callConflict("着信が見つからないか、すでに終了しています", 410),
  );
  try {
    const response = await answer({ callMid: "1" });
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: "着信が見つからないか、すでに終了しています",
    });
  } finally {
    answerCall.mockRestore();
  }
});

test("a genuinely unexpected call failure is still a 500", async () => {
  const startCall = spyOn(service, "startDirectCall").mockRejectedValue(new Error("boom"));
  try {
    const response = await start({ to: `u${"c".repeat(32)}` });
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ ok: false, error: "internal server error" });
  } finally {
    startCall.mockRestore();
  }
});

test("a malformed answer body is a 400 rather than an unhandled parse failure", async () => {
  const answerCall = spyOn(service, "answerDirectCall");
  try {
    const response = await lineRouter.request("/owner/call/answer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, error: "callMid required" });
    expect(answerCall).not.toHaveBeenCalled();
  } finally {
    answerCall.mockRestore();
  }
});
