import { expect, spyOn, test } from "bun:test";
import type { VylineClient } from "@vyline/protocol";
import { downloadAlbumMedia, listAlbumPhotos, listAlbums } from "./albumService.js";
import * as manager from "../line/clientManager.js";

function fixture(statuses = [200]) {
  const requests: Array<{ url: string; headers: Headers }> = [];
  const calls: Array<{ op: string; input: unknown }> = [];
  const client = { base: {
    album: { list: async (input: unknown) => { calls.push({ op: "list", input }); return { result: { albums: [] } }; }, photos: async (input: unknown) => { calls.push({ op: "photos", input }); return { result: { photos: [], hasMore: false } }; } },
    channelTokens: { get: async (channel: string, input: unknown) => { calls.push({ op: channel, input }); return "fixture-token"; }, reissue: async (channel: string, input: unknown) => { calls.push({ op: `reissue:${channel}`, input }); return "fixture-fresh"; } },
    request: { getHeader: () => ({ "X-Line-Application": "fixture-app" }) },
    fetch: async (url: string, init: RequestInit) => { requests.push({ url, headers: new Headers(init.headers) }); return new Response("fixture", { status: statuses.shift() ?? 200, headers: { "content-type": "image/jpeg" } }); },
  } } as unknown as VylineClient;
  return { client, calls, requests };
}

test("album and photo read service retains chat/album context and cursor; invalid sizes never reach protocol", async () => {
  const f = fixture();
  await listAlbums(f.client, { chatId: "c-fixture", cursor: "catalog-next" });
  await listAlbumPhotos(f.client, "9000000123", { chatId: "c-fixture", cursor: "photos-next", pageSize: "40" });
  expect(f.calls).toEqual([
    { op: "list", input: { chatId: "c-fixture", cursor: "catalog-next" } },
    { op: "photos", input: { chatId: "c-fixture", albumId: "9000000123", cursor: "photos-next", pageSize: 40 } },
  ]);
  expect(() => listAlbums(f.client, { chatId: "" })).toThrow();
  expect(() => listAlbumPhotos(f.client, "123", { chatId: "c-fixture", pageSize: "NaN" })).toThrow();
  expect(f.calls).toHaveLength(2);
});

test("image thumbnails, originals and VIDEO use Android OBS resource sid, never the notification photoId", async () => {
  const f = fixture();
  for (const [sid, full] of [["a", false], ["o", true], ["v", true]] as const)
    await downloadAlbumMedia(f.client, "123", { chatId: "c-fixture", oid: "object/one", sid, full });
  expect(f.requests.map(request => request.url)).toEqual([
    "https://obs-jp.line-apps.com/r/album/a/object%2Fone/m1200",
    "https://obs-jp.line-apps.com/r/album/o/object%2Fone",
    "https://obs-jp.line-apps.com/r/album/v/object%2Fone",
  ]);
  for (const request of f.requests) {
    expect(request.headers.get("X-Line-Mid")).toBe("c-fixture");
    expect(request.headers.get("X-Line-Album")).toBe("123");
    expect(request.headers.get("X-Line-ChannelToken")).toBe("fixture-token");
  }
});

test("media 401 refreshes only the album channel once; errors and untrusted sid are rejected", async () => {
  const f = fixture([401, 200]);
  await downloadAlbumMedia(f.client, "123", { chatId: "c-fixture", oid: "object", mediaType: "video" });
  expect(f.calls.map(call => call.op)).toEqual(["1375220249", "reissue:1375220249"]);
  expect(f.requests[1]?.headers.get("X-Line-ChannelToken")).toBe("fixture-fresh");
  const invalid = fixture();
  await expect(downloadAlbumMedia(invalid.client, "123", { chatId: "c-fixture", oid: "x", sid: "../other" })).rejects.toThrow();
  expect(invalid.calls).toEqual([]);
  const denied = fixture([403]);
  await expect(downloadAlbumMedia(denied.client, "123", { chatId: "c-fixture", oid: "x" })).rejects.toThrow("HTTP 403");
});

test("album media BFF forwards a validated Range and preserves 206/416 and byte-range headers", async () => {
  const f = fixture();
  const observed = { range: null as string | null };
  let fetches = 0;
  const fetch = spyOn(f.client.base, "fetch").mockImplementation(async (_input, init) => {
    fetches++;
    observed.range = new Headers(init?.headers).get("Range");
    return fetches === 1
      ? new Response("partial", { status: 206, headers: { "Content-Type": "video/mp4", "Content-Range": "bytes 3-9/20", "Accept-Ranges": "bytes", "Content-Length": "7" } })
      : new Response(null, { status: 416, headers: { "Content-Range": "bytes */20", "Accept-Ranges": "bytes", "Content-Length": "0" } });
  });
  const client = spyOn(manager, "getContentClient").mockResolvedValue(f.client);
  try {
    const { lineRouter } = await import("../api/line.js");
    const path = "/fixture/albums/123/media/object?chatId=c-fixture&mediaType=video&sid=v&full=1";
    const response = await lineRouter.request(path, { headers: { Range: "bytes=3-9" } });
    expect(response.status).toBe(206); expect(observed.range).toBe("bytes=3-9");
    expect(response.headers.get("Content-Range")).toBe("bytes 3-9/20");
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(response.headers.get("Content-Length")).toBe("7");
    expect(await response.text()).toBe("partial");
    const invalid = await lineRouter.request(path, { headers: { Range: "bytes=0-1,4-5" } });
    expect(invalid.status).toBe(416); expect(fetches).toBe(1);
    const unsatisfied = await lineRouter.request(path, { headers: { Range: "bytes=30-" } });
    expect(unsatisfied.status).toBe(416);
    expect(unsatisfied.headers.get("Content-Range")).toBe("bytes */20");
    expect(await unsatisfied.text()).toBe("");
  } finally { client.mockRestore(); fetch.mockRestore(); }
});

test("non-success media bodies are cancelled before the service throws", async () => {
  const f = fixture();
  let cancelled = false;
  const fetch = spyOn(f.client.base, "fetch").mockImplementation(async () => new Response(new ReadableStream({ cancel: () => { cancelled = true; } }), { status: 403 }));
  try {
    await expect(downloadAlbumMedia(f.client, "123", { chatId: "c-fixture", oid: "expired" })).rejects.toThrow("HTTP 403");
    expect(cancelled).toBe(true);
  } finally { fetch.mockRestore(); }
});

for (const [status, retryAfter] of [[429, "30"], [503, "Wed, 01 Jan 2031 00:00:00 GMT"]] as const) {
  test(`album media BFF preserves upstream ${status}/Retry-After without exposing or caching private content`, async () => {
    const f = fixture();
    let cancelled = false;
    const fetch = spyOn(f.client.base, "fetch").mockImplementation(async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode("private-upstream-body fixture-secret-token")); },
      cancel() { cancelled = true; },
    }), { status, headers: { "Retry-After": retryAfter, "Content-Type": "text/plain",
      "X-Line-ChannelToken": "fixture-secret-token", "Set-Cookie": "private-session=fixture-secret-token",
      "Cache-Control": "public, max-age=3600" } }));
    const client = spyOn(manager, "getContentClient").mockResolvedValue(f.client);
    try {
      const { lineRouter } = await import("../api/line.js");
      const response = await lineRouter.request("/fixture/albums/123/media/object?chatId=c-fixture&sid=a");
      expect(response.status).toBe(status);
      expect(response.headers.get("Retry-After")).toBe(retryAfter);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(response.headers.get("Content-Type")).toContain("application/json");
      expect(response.headers.get("X-Line-ChannelToken")).toBeNull();
      expect(response.headers.get("Set-Cookie")).toBeNull();
      expect(await response.json()).toEqual({ ok: false, error: "アルバムのメディアを読み込めませんでした" });
      expect(cancelled).toBe(true);
      expect(f.calls.map(call => call.op)).toEqual(["1375220249"]);
    } finally { client.mockRestore(); fetch.mockRestore(); }
  });
}
