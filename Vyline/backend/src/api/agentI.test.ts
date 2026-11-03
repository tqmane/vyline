import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const previousLanAccess = process.env.VYLINE_LAN_ACCESS;
const previousDataDir = process.env.VYLINE_DATA_DIR;
const previousFetch = globalThis.fetch;
const testDataDir = await mkdtemp(join(tmpdir(), "vyline-agent-i-lan-"));
process.env.VYLINE_DATA_DIR = testDataDir;

const { agentIRouter } = await import("./agentI.js");
const { completePairing, createPairing } = await import("../storage/subdeviceStore.js");
const { resetAgentISession } = await import("../service/agentIService.js");

afterEach(() => {
  if (previousLanAccess === undefined) Reflect.deleteProperty(process.env, "VYLINE_LAN_ACCESS");
  else process.env.VYLINE_LAN_ACCESS = previousLanAccess;
  globalThis.fetch = previousFetch;
  resetAgentISession("credential-fixture");
});

afterAll(async () => {
  if (previousDataDir === undefined) Reflect.deleteProperty(process.env, "VYLINE_DATA_DIR");
  else process.env.VYLINE_DATA_DIR = previousDataDir;
  await rm(testDataDir, { recursive: true, force: true });
});

describe("Agent I LAN authentication", () => {
  test("rejects unauthenticated remote requests when LAN access is enabled", async () => {
    process.env.VYLINE_LAN_ACCESS = "true";

    const response = await agentIRouter.request("/u-test/history", {
      headers: { "x-vyline-local-request": "0" },
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      ok: false,
      error: "subdevice authentication required",
    });
  });

  test("keeps trusted local requests available when LAN access is enabled", async () => {
    process.env.VYLINE_LAN_ACCESS = "true";

    const response = await agentIRouter.request("/u-test/history", {
      headers: { "x-vyline-local-request": "1" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, history: [] });
  });

  test("allows only the account used when the subdevice was paired", async () => {
    process.env.VYLINE_LAN_ACCESS = "true";
    const installationId = crypto.randomUUID();
    const pairing = await createPairing("account-a");
    const completed = await completePairing(pairing.token, "Test tablet", "web", installationId);
    expect(completed).not.toBeNull();

    const headers = {
      authorization: `Bearer ${completed!.sessionToken}`,
      "x-vyline-installation-id": installationId,
      "x-vyline-local-request": "0",
    };

    const allowed = await agentIRouter.request("/account-a/history", { headers });
    expect(allowed.status).toBe(200);

    const denied = await agentIRouter.request("/account-b/history", { headers });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ ok: false, error: "subdevice account mismatch" });
    for (const method of ["GET", "PUT", "DELETE"]) {
      const result = await agentIRouter.request("/account-b/credentials", { method, headers });
      expect(result.status).toBe(403);
    }
    expect((await agentIRouter.request("/account-a/credentials", { headers })).status).toBe(200);
  });

  test("does not expose upstream Agent I error details", async () => {
    process.env.VYLINE_LAN_ACCESS = "false";
    globalThis.fetch = (async () =>
      new Response("upstream-secret-detail", { status: 503 })) as unknown as typeof fetch;

    const response = await agentIRouter.request("/security-error-account/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "test" }),
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ ok: false, error: "upstream service unavailable" });
  });
});

describe("Agent I credential routes", () => {
  const headers = { "Content-Type": "application/json", "x-vyline-local-request": "1" };
  const register = (body: unknown) =>
    agentIRouter.request("/credential-fixture/credentials", {
      method: "PUT",
      headers,
      body: JSON.stringify(body),
    });

  test("requires explicit consent and never returns the registered cookie", async () => {
    globalThis.fetch = (() => {
      throw Error("network forbidden");
    }) as unknown as typeof fetch;
    expect((await register({ yahooCookie: "Y=synthetic-route-secret" })).status).toBe(400);
    expect(
      (await register({ yahooCookie: "Y=synthetic-route-secret", consent: false })).status,
    ).toBe(400);
    const saved = await register({ yahooCookie: "Y=synthetic-route-secret", consent: true });
    expect(saved.status).toBe(200);
    expect(saved.headers.get("cache-control")).toBe("no-store");
    const status = await saved.json();
    expect(status).toEqual({
      ok: true,
      yahooCookieConfigured: true,
      expiresAt: expect.any(Number),
    });
    const read = await agentIRouter.request("/credential-fixture/credentials", { headers });
    expect(await read.json()).toEqual(status);
    expect(JSON.stringify(status)).not.toContain("synthetic-route-secret");
    const deleted = await agentIRouter.request("/credential-fixture/credentials", {
      method: "DELETE",
      headers,
    });
    expect(deleted.status).toBe(200);
    const cleared = await agentIRouter.request("/credential-fixture/credentials", { headers });
    expect(await cleared.json()).toEqual({
      ok: true,
      yahooCookieConfigured: false,
      expiresAt: null,
    });
  });

  test("rejects invalid cookies, JSON, request size and auth mode locally", async () => {
    globalThis.fetch = (() => {
      throw Error("network forbidden");
    }) as unknown as typeof fetch;
    for (const yahooCookie of ["Y=secret\r\nInjected=yes", 123, "", `Y=${"x".repeat(16_384)}`]) {
      const response = await register({ yahooCookie, consent: true });
      expect(response.status).toBe(400);
      expect(await response.text()).not.toContain("Injected");
    }
    expect(
      (
        await agentIRouter.request("/credential-fixture/credentials", {
          method: "PUT",
          headers,
          body: "{",
        })
      ).status,
    ).toBe(400);
    expect(
      (await register({ yahooCookie: `Y=${"x".repeat(100_000)}`, consent: true })).status,
    ).toBe(413);
    const mode = await agentIRouter.request("/credential-fixture/chat", {
      method: "POST",
      headers,
      body: JSON.stringify({ prompt: "test", authMode: "unknown" }),
    });
    expect(mode.status).toBe(400);
  });

  test("clears an upstream-rejected cookie and returns a safe actionable error", async () => {
    await register({ yahooCookie: "Y=synthetic-rejected-secret", consent: true });
    globalThis.fetch = (async () =>
      new Response("Y=synthetic-rejected-secret", { status: 401 })) as unknown as typeof fetch;
    const response = await agentIRouter.request("/credential-fixture/chat", {
      method: "POST",
      headers,
      body: JSON.stringify({ prompt: "test", authMode: "authenticated" }),
    });
    expect(response.status).toBe(401);
    const error = await response.text();
    expect(error).toContain("Yahoo");
    expect(error).not.toContain("synthetic-rejected-secret");
    const status = await agentIRouter.request("/credential-fixture/credentials", { headers });
    expect((await status.json()).yahooCookieConfigured).toBe(false);
  });

  test("does not log transport errors that may echo credentials or prompts", async () => {
    await register({ yahooCookie: "Y=synthetic-log-secret", consent: true });
    globalThis.fetch = (async () => {
      throw Error("Y=synthetic-log-secret private prompt");
    }) as unknown as typeof fetch;
    const response = await agentIRouter.request("/credential-fixture/chat", {
      method: "POST",
      headers,
      body: JSON.stringify({ prompt: "private prompt", authMode: "authenticated" }),
    });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ ok: false, error: "upstream service unavailable" });
  });
});
