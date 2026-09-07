import { expect, test } from "bun:test";
import { recordingClient } from "./recordings";

test("recording requests bind owner credentials and use the mounted collection URL", async () => {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const previousFetch = globalThis.fetch;
  const data = new Map<string, string>([["vyline:subdevice-session", "synthetic-owner-a"]]);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
    },
  });
  const requests: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init: init! });
    return Response.json({ ok: true, items: [], nextCursor: null, recording: { bytes: 3 } });
  }) as typeof fetch;
  try {
    const client = recordingClient("owner-a");
    data.set("vyline:subdevice-session", "synthetic-owner-b");
    await client.list();
    await client.append("id", 0, new Blob(["abc"]));
    expect(requests[0]!.url).toBe("/api/line/owner-a/recordings");
    expect(requests[1]!.url).toBe("/api/line/owner-a/recordings/id/chunks");
    for (const request of requests) {
      expect(new Headers(request.init.headers).get("authorization")).toBe(
        "Bearer synthetic-owner-a",
      );
      expect(request.init.credentials).toBe("omit");
    }
  } finally {
    globalThis.fetch = previousFetch;
    if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
