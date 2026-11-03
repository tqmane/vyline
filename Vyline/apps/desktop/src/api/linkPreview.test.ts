import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { fetchLinkPreview, fetchLinkPreviewImage } from "./linkPreview";

const preconnect = globalThis.fetch.preconnect;
function mockFetch(implementation: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>) {
  spyOn(globalThis, "fetch").mockImplementation(Object.assign(implementation, { preconnect }));
}

afterEach(() => {
  mock.restore();
});

test("preview API uses authenticated BFF conventions, explicit consent and safe metadata fields", async () => {
  mockFetch(async (input, init) => {
    expect(String(input)).toBe("/api/line/account%2Fa/link-preview");
    expect(JSON.parse(String(init?.body))).toEqual({
      url: "https://site.org",
      requestUrlPreviews: true,
      linkPreviewMaxUrls: 1,
    });
    return Response.json({
      ok: true,
      preview: {
        title: "Title",
        site: "Site",
        description: "Description",
        imageId: "https://tracker.org/image",
        image: "https://tracker.org/image",
      },
    });
  });
  expect(
    await fetchLinkPreview("account/a", "https://site.org", new AbortController().signal),
  ).toEqual({ title: "Title", site: "Site", description: "Description" });
});

test("preview API handles non-2xx and invalid metadata without showing a card", async () => {
  for (const response of [
    new Response("private upstream detail", { status: 502 }),
    Response.json({ ok: false }),
    Response.json({ ok: true, preview: { title: 123 } }),
  ]) {
    mockFetch(async () => response);
    expect(
      await fetchLinkPreview("account", "https://site.org", new AbortController().signal),
    ).toBeNull();
  }
});

test("image API treats expired images as absent and rejects active or invalid content", async () => {
  for (const response of [
    new Response("expired", { status: 404 }),
    new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } }),
  ]) {
    mockFetch(async () => response);
    expect(
      await fetchLinkPreviewImage("account", "a".repeat(64), new AbortController().signal),
    ).toBeNull();
  }
  mockFetch(async () => {
    throw new Error("must not fetch an arbitrary URL");
  });
  expect(
    await fetchLinkPreviewImage("account", "https://tracker.org", new AbortController().signal),
  ).toBeNull();
});
