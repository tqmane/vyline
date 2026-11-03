import { afterEach, expect, test } from "bun:test";
import { agentIClient } from "./agentI";

const previousFetch = globalThis.fetch;
const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
afterEach(() => {
  globalThis.fetch = previousFetch;
  if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
});

test("captures account transport, never persists Yahoo credentials, and sends history only explicitly", async () => {
  const data = new Map([
    ["vyline:subdevice-session", "synthetic-account-a"],
    ["vyline:subdevice-installation-id", "11111111-1111-4111-8111-111111111111"],
  ]);
  const writes: string[] = [];
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        writes.push(value);
        data.set(key, value);
      },
    },
  });
  const requests: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (url: unknown, init: RequestInit) => {
    requests.push({ url: String(url), init });
    return Response.json({ ok: true });
  }) as unknown as typeof fetch;
  const client = agentIClient("account/a");
  await client.setCredentials("Y=synthetic-yahoo-secret");
  await client.chat("new question");
  await client.chat("follow up", [{ role: "user", text: "explicit history" }], "authenticated");
  data.set("vyline:subdevice-session", "synthetic-account-b");
  await client.resetSession();
  expect(requests[0]!.url).toBe("/api/beta/agent-i/account%2Fa/credentials");
  expect(JSON.parse(String(requests[0]!.init.body))).toEqual({
    yahooCookie: "Y=synthetic-yahoo-secret",
    consent: true,
  });
  expect(JSON.parse(String(requests[1]!.init.body))).toEqual({
    prompt: "new question",
    history: [],
    authMode: "anonymous",
  });
  expect(JSON.parse(String(requests[2]!.init.body)).history).toEqual([
    { role: "user", text: "explicit history" },
  ]);
  expect(new Headers(requests[3]!.init.headers).get("authorization")).toBe(
    "Bearer synthetic-account-a",
  );
  expect(requests[3]!.init.keepalive).toBe(true);
  expect(requests.every(({ init }) => init.cache === "no-store")).toBe(true);
  expect(writes).toEqual([]);
});

test("does not display proxy or transport errors that echo credentials", async () => {
  Reflect.deleteProperty(globalThis, "localStorage");
  const client = agentIClient("fixture");
  globalThis.fetch = (async () =>
    Response.json(
      { ok: false, error: "Y=synthetic-proxy-secret" },
      { status: 500 },
    )) as unknown as typeof fetch;
  await expect(client.setCredentials("Y=synthetic-proxy-secret")).rejects.toThrow(
    "Agent Iの処理に失敗しました",
  );
  globalThis.fetch = (async () => {
    throw Error("Y=synthetic-transport-secret");
  }) as unknown as typeof fetch;
  await expect(client.setCredentials("Y=synthetic-transport-secret")).rejects.toThrow(
    "Agent Iに接続できませんでした",
  );
});
