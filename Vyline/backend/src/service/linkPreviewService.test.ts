import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import {
  createLinkPreviewService,
  isPublicPreviewAddress,
  parsePreviewUrl,
} from "./linkPreviewService";

const allowed = { requestUrlPreviews: true, linkPreviewMaxUrls: 1 };
const html =
  '<meta property="og:title" content="A &amp; B"><meta name="description" content="Description"><meta property="og:image" content="/thumb.png">';
const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

function fixture(
  responses: Array<{
    status?: number;
    type?: string;
    body?: string | Buffer;
    location?: string;
    length?: string;
  }>,
  addresses: string[] | (() => string[]) = ["93.184.215.14"],
) {
  const requests: Record<string, any>[] = [];
  let lookups = 0;
  let now = 0;
  const request = (options: Record<string, any>, respond: (response: any) => void) => {
    requests.push(options);
    const req = new EventEmitter() as any;
    req.destroy = (error: Error) => {
      queueMicrotask(() => req.emit("error", error));
      return req;
    };
    req.end = () =>
      queueMicrotask(() => {
        const value = responses.shift();
        if (!value) {
          req.emit("error", new Error("network failure"));
          return;
        }
        const response = new EventEmitter() as any;
        response.statusCode = value.status ?? 200;
        response.headers = {
          "content-type": value.type ?? "text/html",
          location: value.location,
          "content-length": value.length,
        };
        response.destroy = (error?: Error) => {
          if (error) response.emit("error", error);
          response.emit("close");
        };
        response.complete = true;
        respond(response);
        if (value.body) response.emit("data", Buffer.from(value.body));
        response.emit("end");
      });
    return req;
  };
  const service = createLinkPreviewService({
    lookup: (async () => {
      lookups++;
      return (typeof addresses === "function" ? addresses() : addresses).map((address) => ({
        address,
        family: address.includes(":") ? 6 : 4,
      }));
    }) as any,
    http: request as any,
    https: request as any,
    now: () => now,
  });
  return {
    service,
    requests,
    get lookups() {
      return lookups;
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("link preview security", () => {
  test("bounds parsing of repeated unclosed title tags", async () => {
    const f = fixture([{ body: "<title>".repeat(40_000) }]);
    const start = performance.now();
    expect(await f.service.fetchLinkPreview("https://site.org", "a", allowed)).toEqual({
      title: "site.org",
      description: "",
      site: "site.org",
    });
    expect(performance.now() - start).toBeLessThan(1000);
  }, 10_000);

  test("bounds parsing of repeated unclosed meta tags and malformed attribute values", async () => {
    for (const body of [
      "<meta ".repeat(120_000),
      `<meta ${"attribute".repeat(900)}>`.repeat(120),
      `<meta property="og:description" content="${"<".repeat(7900)}">`.repeat(120),
    ]) {
      const f = fixture([{ body }]);
      const start = performance.now();
      const result = await f.service.fetchLinkPreview("https://site.org", "a", allowed);
      expect(result?.title).toBe("site.org");
      expect(performance.now() - start).toBeLessThan(1000);
    }
  }, 10_000);

  test("preserves OG/Twitter priority, title fallback, attribute forms and entity decoding", async () => {
    for (const [body, expected] of [
      [
        '<title>Fallback</title><meta name="twitter:title" content="Twitter"><meta property="og:title" content="OG &amp; &#x65e5;"><meta property="og:description" content="OG description"><meta property="og:site_name" content="Fixture site">',
        { title: "OG & 日", description: "OG description", site: "Fixture site" },
      ],
      [
        "<title>Fallback</title><META CONTENT='Twitter &quot;title&quot;' NAME='twitter:title'><meta content=Twitter-description name=twitter:description>",
        { title: 'Twitter "title"', description: "Twitter-description", site: "site.org" },
      ],
      [
        '<TiTlE lang="ja">  Title &amp; <b>text</b> &#26085; </TITLE ><meta name="description" content="Plain description">',
        { title: "Title & text 日", description: "Plain description", site: "site.org" },
      ],
    ] as const) {
      const f = fixture([{ body }]);
      expect(await f.service.fetchLinkPreview("https://site.org", "a", allowed)).toEqual(expected);
    }
  });

  test("rejects non-public IPv4, IPv6 and encoded address variants", () => {
    for (const ip of [
      "0.0.0.0",
      "10.1.2.3",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "192.168.1.1",
      "192.0.0.1",
      "198.18.0.1",
      "203.0.113.1",
      "224.0.0.1",
      "::1",
      "::ffff:8.8.8.8",
      "fc00::1",
      "fe80::1",
      "2001:db8::1",
      "2002:7f00:1::",
      "3fff::1",
      "garbage",
    ]) {
      expect(isPublicPreviewAddress(ip)).toBe(false);
    }
    for (const ip of ["93.184.215.14", "8.8.8.8", "2606:4700:4700::1111"])
      expect(isPublicPreviewAddress(ip)).toBe(true);
    for (const url of [
      "http://2130706433",
      "http://0x7f000001",
      "http://127.1",
      "http://[::1]",
      "file:///etc/passwd",
      "https://site.org:80/",
      "https://site.org:8443/",
      "https://site.org/?X-Amz-Signature=secret",
    ])
      expect(parsePreviewUrl(url)).toBeNull();
  });
  test("OFF, zero and privacy masking stop DNS and HTTP even for cached data", async () => {
    const f = fixture([{ body: html }, { type: "image/png", body: png }]);
    for (const policy of [
      {},
      { ...allowed, requestUrlPreviews: false },
      { ...allowed, linkPreviewMaxUrls: 0 },
      { ...allowed, streamerMode: true },
    ]) {
      expect(await f.service.fetchLinkPreview("https://site.org", "a", policy)).toBeNull();
    }
    expect(f.lookups).toBe(0);
    expect(f.requests).toHaveLength(0);
  });
  test("pins validated DNS in socket lookup and isolates preview/image cache by account", async () => {
    const f = fixture([
      { body: html },
      { type: "image/png", body: png },
      { body: "<title>Other account</title>" },
    ]);
    const preview = await f.service.fetchLinkPreview("https://site.org", "a", allowed);
    expect(preview?.title).toBe("A & B");
    expect(preview?.imageId).toMatch(/^[a-f0-9]{64}$/);
    expect(f.requests[0]?.agent).toBe(false);
    expect(f.requests[0]?.maxHeaderSize).toBe(16384);
    let pinned: unknown;
    f.requests[0]?.lookup("site.org", {}, (_error: unknown, address: unknown) => {
      pinned = address;
    });
    expect(pinned).toBe("93.184.215.14");
    expect(f.requests[0]?.headers).not.toHaveProperty("cookie");
    expect(f.service.readLinkPreviewImage(preview!.imageId!, "b", allowed)).toBeNull();
    expect(f.service.readLinkPreviewImage(preview!.imageId!, "a", allowed)?.bytes).toEqual(png);
    expect(await f.service.fetchLinkPreview("https://site.org#section", "a", allowed)).toEqual(
      preview,
    );
    expect(f.requests).toHaveLength(2);
    expect((await f.service.fetchLinkPreview("https://site.org", "b", allowed))?.title).toBe(
      "Other account",
    );
    f.advance(4 * 60 * 60_000 + 1);
    expect(f.service.readLinkPreviewImage(preview!.imageId!, "a", allowed)).toBeNull();
  });
  test("rejects mixed public/private DNS before making a request", async () => {
    const f = fixture([], ["93.184.215.14", "127.0.0.1"]);
    expect(await f.service.fetchLinkPreview("https://site.org", "a", allowed)).toBeNull();
    expect(f.requests).toHaveLength(0);
  });
  test("revalidates redirects, including localhost and secret-query redirects", async () => {
    for (const location of [
      "http://127.0.0.1/",
      "http://[::1]/",
      "https://site.org/?token=secret",
      "https://site.org:8080/",
    ]) {
      const f = fixture([{ status: 302, location }]);
      expect(await f.service.fetchLinkPreview("https://site.org", "a", allowed)).toBeNull();
      expect(f.requests).toHaveLength(1);
    }
    const f = fixture(Array.from({ length: 5 }, () => ({ status: 302, location: "/next" })));
    expect(await f.service.fetchLinkPreview("https://site.org", "a", allowed)).toBeNull();
    expect(f.requests).toHaveLength(4);
    expect(f.lookups).toBe(4);
  });
  test("checks DNS again on redirects, rejecting a rebinding destination", async () => {
    let resolutions = 0;
    const f = fixture([{ status: 302, location: "/next" }], () =>
      ++resolutions === 1 ? ["93.184.215.14"] : ["10.0.0.1"],
    );
    expect(await f.service.fetchLinkPreview("https://site.org", "a", allowed)).toBeNull();
    expect(f.lookups).toBe(2);
    expect(f.requests).toHaveLength(1);
  });
  test("caps HTML by declared and streamed size and negative-caches failures", async () => {
    for (const response of [
      { length: "1048577" },
      { body: "x".repeat(1048577) },
      { type: "application/json", body: "{}" },
    ]) {
      const f = fixture([response]);
      expect(await f.service.fetchLinkPreview("https://site.org", "a", allowed)).toBeNull();
      expect(await f.service.fetchLinkPreview("https://site.org", "a", allowed)).toBeNull();
      expect(f.requests).toHaveLength(1);
    }
  });
  test("keeps text card on image failures, SVG and content-type spoofing", async () => {
    for (const response of [
      { type: "image/svg+xml", body: "<svg/>" },
      { type: "image/png", body: "<script>bad</script>" },
      { type: "image/png", body: Buffer.alloc(2 * 1024 * 1024 + 1) },
      { status: 404 },
    ]) {
      const f = fixture([{ body: html }, response]);
      expect(await f.service.fetchLinkPreview("https://site.org", "a", allowed)).toEqual({
        title: "A & B",
        description: "Description",
        site: "site.org",
      });
    }
  });
  test("limits each account to thirty new URLs per minute", async () => {
    const f = fixture([]);
    for (let i = 0; i < 31; i++)
      await f.service.fetchLinkPreview(`https://site.org/${i}`, "a", allowed);
    expect(f.requests).toHaveLength(30);
    f.advance(60_001);
    await f.service.fetchLinkPreview("https://site.org/31", "a", allowed);
    expect(f.requests).toHaveLength(31);
  });
  test("an aborted caller cannot start HTTP after a delayed DNS answer", async () => {
    let finish!: (value: unknown) => void;
    let requests = 0;
    const service = createLinkPreviewService({
      lookup: (() =>
        new Promise((resolve) => {
          finish = resolve;
        })) as any,
      https: (() => {
        requests++;
        throw new Error("must not request");
      }) as any,
    });
    const controller = new AbortController();
    const pending = service.fetchLinkPreview("https://site.org", "a", allowed, controller.signal);
    controller.abort();
    finish([{ address: "93.184.215.14", family: 4 }]);
    expect(await pending).toBeNull();
    expect(requests).toBe(0);
  });
  test("the total deadline includes a hung DNS lookup", async () => {
    const service = createLinkPreviewService({ lookup: (() => new Promise(() => {})) as any });
    const start = Date.now();
    expect(await service.fetchLinkPreview("https://site.org", "a", allowed)).toBeNull();
    expect(Date.now() - start).toBeLessThan(6500);
  }, 7000);
  test("deduplicates concurrent requests and limits bursts and global work", async () => {
    const f = fixture([{ body: "<title>OK</title>" }]);
    const values = await Promise.all(
      Array.from({ length: 10 }, () =>
        f.service.fetchLinkPreview("https://site.org", "a", allowed),
      ),
    );
    expect(values.every((value) => value?.title === "OK")).toBe(true);
    expect(f.requests).toHaveLength(1);
    const batch = await Promise.all(
      Array.from({ length: 15 }, (_, i) =>
        f.service.fetchLinkPreview(`https://site.org/${i}`, "a", allowed),
      ),
    );
    expect(batch.every((value) => value === null)).toBe(true);
    expect(f.requests.length).toBeLessThanOrEqual(5);
  });
});
