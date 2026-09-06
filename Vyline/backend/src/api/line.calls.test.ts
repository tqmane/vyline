import { expect, spyOn, test } from "bun:test";
import { lineRouter } from "./line.js";
import * as manager from "../call/callManager.js";

test("call HTTP controls cannot read or end another account's session", async () => {
  const sessionId = "00000000-0000-4000-8000-000000000001";
  const snapshot = spyOn(manager, "getCallSnapshot").mockReturnValue({
    accountId: "owner",
    sessionId,
  } as never);
  const end = spyOn(manager, "endManagedCall").mockResolvedValue();
  try {
    expect((await lineRouter.request(`/other/call/status?sessionId=${sessionId}`)).status).toBe(
      404,
    );
    expect(
      (
        await lineRouter.request("/other/call/end", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId }),
        })
      ).status,
    ).toBe(404);
    expect(end).not.toHaveBeenCalled();
    expect((await lineRouter.request(`/owner/call/status?sessionId=${sessionId}`)).status).toBe(
      200,
    );
  } finally {
    snapshot.mockRestore();
    end.mockRestore();
  }
});

test("call start rejects malformed targets and media types before contacting LINE", async () => {
  for (const body of [
    null,
    {},
    { to: 4 },
    { to: "u-peer" },
    { to: "c932e3b8ae8bf6b0fc19b512c40cda944", callType: "invalid" },
  ]) {
    const response = await lineRouter.request("/test/call/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(400);
  }
});
