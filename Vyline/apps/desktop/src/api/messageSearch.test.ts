import { expect, test } from "bun:test";
import { messageSearchClient } from "./messageSearch";

test("search requests keep captured account scope, cancellation and escaped query parameters", async () => {
  const previousFetch = globalThis.fetch;
  const requests: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init: init! });
    return Response.json({ ok: true, hits: [], limit: 100, nextCursor: null });
  }) as typeof fetch;
  try {
    const abort = new AbortController();
    const client = messageSearchClient("fixture-account", "chat/with space");
    await client.search("日本語 😀 &.*", true, "page-2", abort.signal);
    await client.context("id & 1", "before", abort.signal);
    expect(requests[0]!.url).toStartWith(
      "/api/line/fixture-account/message-search/chat%2Fwith%20space?",
    );
    const query = new URL(requests[0]!.url, "http://fixture").searchParams;
    expect(query.get("q")).toBe("日本語 😀 &.*");
    expect(query.get("regex")).toBe("true");
    expect(query.get("cursor")).toBe("page-2");
    expect(requests[1]!.url).toContain("/context?");
    expect(requests[0]!.init.signal).toBeInstanceOf(AbortSignal);
    abort.abort();
    expect(requests[0]!.init.signal!.aborted).toBe(true);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("the client surfaces backend regex/timeout errors and preserves cancellation", async () => {
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = Object.assign(
      async () =>
        Response.json({ ok: false, error: "検索がタイムアウトしました" }, { status: 408 }),
      { preconnect: previousFetch.preconnect },
    );
    await expect(
      messageSearchClient("fixture", "chat").search("q", false, null, new AbortController().signal),
    ).rejects.toThrow("検索がタイムアウトしました");
    const abort = new AbortController();
    globalThis.fetch = Object.assign(
      async () => {
        abort.abort();
        throw new Error("wrapped fetch abort");
      },
      { preconnect: previousFetch.preconnect },
    );
    await expect(
      messageSearchClient("fixture", "chat").search("q", false, null, abort.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  } finally {
    globalThis.fetch = previousFetch;
  }
});
