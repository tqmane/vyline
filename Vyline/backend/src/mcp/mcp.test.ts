import { afterAll, expect, spyOn, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

const previousDir = process.env.VYLINE_DATA_DIR;
const previousTeam = process.env.VYLINE_CF_ACCESS_TEAM_DOMAIN;
const previousAud = process.env.VYLINE_CF_ACCESS_AUD;
const previousEnabled = process.env.VYLINE_MCP_ENABLED;
const previousAllowLocal = process.env.VYLINE_MCP_ALLOW_LOCAL;

const directory = await mkdtemp(join(tmpdir(), "vyline-mcp-"));
process.env.VYLINE_DATA_DIR = directory;
const TEAM_DOMAIN = "https://example-team.cloudflareaccess.com";
const TEST_AUD = "test-aud-tag-0001";

const { createToken, revokeToken } = await import("../storage/apiTokenStore.js");
const manager = await import("../line/clientManager.js");
const tokenStore = await import("../storage/tokenStore.js");
const { clearCfAccessJwksCache, verifyCfAccessJwt } = await import("./cfAccessJwt.js");
const { mcpRouter } = await import("./router.js");
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = await import(
  "@modelcontextprotocol/sdk/client/streamableHttp.js"
);

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const exportedPublicJwk = publicKey.export({ format: "jwk" });
const testJwk = {
  ...exportedPublicJwk,
  kid: "test-key-1",
  alg: "RS256",
  use: "sig",
};

function base64Url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

async function signJwt(
  payload: Record<string, unknown>,
  headerOverrides: Record<string, unknown> = {},
): Promise<string> {
  const header = { alg: "RS256", typ: "JWT", kid: "test-key-1", ...headerOverrides };
  const body = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    privateKey.export({ type: "pkcs8", format: "der" }),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(body));
  return `${body}.${base64Url(Buffer.from(sig))}`;
}

const savedSessionsSpy = spyOn(tokenStore, "listSavedSessions").mockResolvedValue([
  { accountId: "acct-main", savedAt: "2026-01-01T00:00:00Z", displayName: "Main", hasToken: true },
]);
const onlineAccountsSpy = spyOn(manager, "listAccounts").mockReturnValue(["acct-second"]);

afterAll(async () => {
  savedSessionsSpy.mockRestore();
  onlineAccountsSpy.mockRestore();
  clearCfAccessJwksCache();
  if (previousDir === undefined) Reflect.deleteProperty(process.env, "VYLINE_DATA_DIR");
  else process.env.VYLINE_DATA_DIR = previousDir;
  if (previousTeam === undefined) Reflect.deleteProperty(process.env, "VYLINE_CF_ACCESS_TEAM_DOMAIN");
  else process.env.VYLINE_CF_ACCESS_TEAM_DOMAIN = previousTeam;
  if (previousAud === undefined) Reflect.deleteProperty(process.env, "VYLINE_CF_ACCESS_AUD");
  else process.env.VYLINE_CF_ACCESS_AUD = previousAud;
  if (previousEnabled === undefined) Reflect.deleteProperty(process.env, "VYLINE_MCP_ENABLED");
  else process.env.VYLINE_MCP_ENABLED = previousEnabled;
  if (previousAllowLocal === undefined) Reflect.deleteProperty(process.env, "VYLINE_MCP_ALLOW_LOCAL");
  else process.env.VYLINE_MCP_ALLOW_LOCAL = previousAllowLocal;
  await rm(directory, { recursive: true, force: true });
});

test("verifyCfAccessJwt accepts valid RS256 token and rejects tampered, expired, or wrong aud/iss tokens", async () => {
  clearCfAccessJwksCache();
  const mockFetch = (async () =>
    Response.json({ keys: [testJwk] })) as unknown as typeof fetch;
  const nowSec = Math.floor(Date.now() / 1000);
  const config = { teamDomain: TEAM_DOMAIN, audiences: [TEST_AUD] };

  const valid = await signJwt({
    iss: TEAM_DOMAIN,
    aud: [TEST_AUD],
    email: "user@example.test",
    sub: "sub-1",
    iat: nowSec - 10,
    exp: nowSec + 300,
  });
  const identity = await verifyCfAccessJwt(valid, config, mockFetch, nowSec);
  expect(identity).toEqual({ email: "user@example.test", sub: "sub-1" });

  const tampered = `${valid.slice(0, -4)}AAAA`;
  expect(await verifyCfAccessJwt(tampered, config, mockFetch, nowSec)).toBeNull();

  const expired = await signJwt({
    iss: TEAM_DOMAIN,
    aud: [TEST_AUD],
    exp: nowSec - 120,
  });
  expect(await verifyCfAccessJwt(expired, config, mockFetch, nowSec)).toBeNull();

  const wrongAud = await signJwt({
    iss: TEAM_DOMAIN,
    aud: ["other-aud"],
    exp: nowSec + 300,
  });
  expect(await verifyCfAccessJwt(wrongAud, config, mockFetch, nowSec)).toBeNull();

  const wrongIss = await signJwt({
    iss: "https://attacker.cloudflareaccess.com",
    aud: [TEST_AUD],
    exp: nowSec + 300,
  });
  expect(await verifyCfAccessJwt(wrongIss, config, mockFetch, nowSec)).toBeNull();
});

test("standard /mcp authenticates via Cloudflare Access JWT and exposes all accounts dynamically", async () => {
  clearCfAccessJwksCache();
  process.env.VYLINE_CF_ACCESS_TEAM_DOMAIN = TEAM_DOMAIN;
  process.env.VYLINE_CF_ACCESS_AUD = TEST_AUD;
  process.env.VYLINE_MCP_ENABLED = "true";
  process.env.VYLINE_MCP_ALLOW_LOCAL = "true";

  const nowSec = Math.floor(Date.now() / 1000);
  const cfJwt = await signJwt({
    iss: TEAM_DOMAIN,
    aud: [TEST_AUD],
    email: "user@example.test",
    sub: "sub-1",
    exp: nowSec + 600,
  });

  const app = new Hono();
  app.route("/mcp", mcpRouter);

  const realFetch = globalThis.fetch;
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === `${TEAM_DOMAIN}/cdn-cgi/access/certs`) {
      return Promise.resolve(Response.json({ keys: [testJwk] }));
    }
    return realFetch(input, init);
  }) as typeof fetch);

  const host = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (r) => app.fetch(r) });
  try {
    // Unauthenticated remote request returns 401 with WWW-Authenticate for OAuth/MCP discovery.
    const unauth = await realFetch(`http://127.0.0.1:${host.port}/mcp`, { method: "POST" });
    expect(unauth.status).toBe(401);
    expect(unauth.headers.get("www-authenticate")).toContain("Bearer");

    // CORS preflight succeeds cleanly for standard browser MCP clients.
    const preflight = await realFetch(`http://127.0.0.1:${host.port}/mcp`, {
      method: "OPTIONS",
      headers: { origin: "https://inspector.example.test" },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-headers")).toContain("Mcp-Session-Id");

    // Standard Streamable HTTP MCP client connects using CF Access JWT + opaque OAuth Bearer token.
    const client = new Client({ name: "std-mcp-test", version: "1" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${host.port}/mcp`),
      {
        requestInit: {
          headers: {
            authorization: "Bearer opaque-cf-oauth-token",
            "cf-access-jwt-assertion": cfJwt,
          },
        },
      },
    );
    await client.connect(transport as Transport);
    try {
      const listed = await client.listTools();
      expect(listed.tools.some((tool) => tool.name === "list_accounts")).toBe(true);
      const accountsRes = await client.callTool({ name: "list_accounts", arguments: {} });
      const parsed = JSON.parse(
        (accountsRes.content as Array<{ text: string }>)[0]!.text,
      ) as { data: { accounts: Array<{ accountId: string }>; scopes: string[] } };
      expect(parsed.data.accounts.map((entry) => entry.accountId)).toEqual([
        "acct-main",
        "acct-second",
      ]);
      expect(parsed.data.scopes).toEqual(["read", "write", "admin"]);
    } finally {
      await client.close();
    }
  } finally {
    fetchSpy.mockRestore();
    host.stop(true);
  }
});

test("standard /mcp also supports API Bearer tokens and local direct-loopback connections", async () => {
  Reflect.deleteProperty(process.env, "VYLINE_CF_ACCESS_TEAM_DOMAIN");
  Reflect.deleteProperty(process.env, "VYLINE_CF_ACCESS_AUD");
  process.env.VYLINE_MCP_ENABLED = "true";
  process.env.VYLINE_MCP_ALLOW_LOCAL = "true";

  const created = await createToken("mcp-wildcard", ["*"], ["read", "write"]);
  const app = new Hono();
  app.route("/mcp", mcpRouter);

  const host = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (r) => app.fetch(r) });
  try {
    // Wildcard API token dynamically expands to all accounts.
    const bearerClient = new Client({ name: "bearer-mcp-test", version: "1" });
    const bearerTransport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${host.port}/mcp`),
      { requestInit: { headers: { authorization: `Bearer ${created.token}` } } },
    );
    await bearerClient.connect(bearerTransport as Transport);
    try {
      const accountsRes = await bearerClient.callTool({ name: "list_accounts", arguments: {} });
      const parsed = JSON.parse(
        (accountsRes.content as Array<{ text: string }>)[0]!.text,
      ) as { data: { accounts: Array<{ accountId: string }> } };
      expect(parsed.data.accounts.map((entry) => entry.accountId)).toEqual([
        "acct-main",
        "acct-second",
      ]);
    } finally {
      await bearerClient.close();
    }

    // Direct loopback marker allows passwordless local MCP client connections.
    const loopbackRes = await app.request("/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "x-vyline-direct-loopback": "1",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "local", version: "1.0" },
        },
      }),
    });
    expect(loopbackRes.status).toBe(200);
  } finally {
    await revokeToken(created.token!);
    host.stop(true);
  }
});
