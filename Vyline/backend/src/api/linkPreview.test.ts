import { expect, test } from "bun:test";
import { createLinkPreviewRouter } from "./linkPreview";

test("router requires explicit per-request opt-in, bounded JSON and passes account scope", async () => {
  let calls = 0;
  const app = createLinkPreviewRouter({
    service: {
      fetchLinkPreview: async (url, accountId) => {
        calls++;
        expect(url).toBe("https://site.org");
        expect(accountId).toBe("a");
        return { title: "Card", description: "", site: "site.org" };
      },
      readLinkPreviewImage: () => null,
    },
  });
  const request = (body: string, id = "a") =>
    app.request(`/${id}/link-preview`, {
      method: "POST",
      body,
      headers: { "content-type": "application/json" },
    });
  for (const policy of [
    {},
    { requestUrlPreviews: true, linkPreviewMaxUrls: 0 },
    { requestUrlPreviews: true, linkPreviewMaxUrls: 4 },
    { requestUrlPreviews: true, linkPreviewMaxUrls: 1, streamerMode: true },
  ]) {
    expect(
      await (await request(JSON.stringify({ url: "https://site.org", ...policy }))).json(),
    ).toEqual({ ok: true, preview: null });
  }
  expect(calls).toBe(0);
  expect((await request("not json")).status).toBe(422);
  expect((await request(JSON.stringify({ url: "x".repeat(2050) }))).status).toBe(422);
  expect((await request("x".repeat(4097))).status).toBe(413);
  const response = await request(
    '{"url":"https://site.org","requestUrlPreviews":true,"linkPreviewMaxUrls":1}',
  );
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect((await response.json()).preview.title).toBe("Card");
  expect(calls).toBe(1);
});

test("image route uses account-bound cached bytes only and disables browser cache", async () => {
  const app = createLinkPreviewRouter({
    service: {
      fetchLinkPreview: async () => {
        throw new Error("must not fetch");
      },
      readLinkPreviewImage: (id, accountId) =>
        id === "cached" && accountId === "a"
          ? { bytes: Buffer.from("image"), contentType: "image/png" }
          : null,
    },
  });
  const options = { headers: { "X-Vyline-Url-Preview": "1" } };
  expect((await app.request("/a/link-preview/images/cached")).status).toBe(404);
  expect((await app.request("/b/link-preview/images/cached", options)).status).toBe(404);
  expect((await app.request("/a/link-preview/images/expired", options)).status).toBe(404);
  const response = await app.request("/a/link-preview/images/cached", options);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(await response.text()).toBe("image");
});
