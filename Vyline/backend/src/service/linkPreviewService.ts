import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { createHash, randomBytes } from "node:crypto";

export type LinkPreviewPolicy = {
  requestUrlPreviews?: boolean;
  linkPreviewMaxUrls?: number;
  streamerMode?: boolean;
};
export type LinkPreviewData = {
  title: string;
  description: string;
  site: string;
  imageId?: string;
};
type Image = { accountId: string; bytes: Buffer; contentType: string; expiresAt: number };
type Response = { status: number; headers: Record<string, string | undefined>; body: Buffer };
const TTL = 4 * 60 * 60_000;
const MAX_HTML = 1024 * 1024;
const MAX_METADATA_TAG_LENGTH = 8192;
const MAX_IMAGE = 2 * 1024 * 1024;
const MAX_IMAGE_CACHE = 16 * 1024 * 1024;

export function previewPolicyAllowsFetch(policy: LinkPreviewPolicy): boolean {
  return (
    policy.requestUrlPreviews === true &&
    !policy.streamerMode &&
    Number.isInteger(policy.linkPreviewMaxUrls) &&
    (policy.linkPreviewMaxUrls ?? 0) >= 1 &&
    (policy.linkPreviewMaxUrls ?? 0) <= 3
  );
}

export function isPublicPreviewAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 6) {
    const [first = "0", second = "0"] = address.split(":");
    const a = Number.parseInt(first, 16);
    const b = Number.parseInt(second || "0", 16);
    // Only global unicast; exclude transition, special-purpose and documentation prefixes.
    return (
      (a & 0xe000) === 0x2000 &&
      a !== 0x2002 &&
      !(a === 0x2001 && (b < 0x200 || b === 0xdb8)) &&
      !(a === 0x3fff && b < 0x1000)
    );
  }
  if (family !== 4) return false;
  const [a = 0, b = 0, c = 0] = address.split(".").map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}

export function parsePreviewUrl(raw: string): URL | null {
  if (raw.length > 2048 || /[\x00-\x20\\]/.test(raw)) return null;
  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (isIP(host)) {
      if (!isPublicPreviewAddress(host)) return null;
    } else if (
      !host.includes(".") ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid|onion)\.?$|\.home\.arpa\.?$/.test(host)
    )
      return null;
    if (
      /password[_-]?reset|reset[_-]?password|oauth|authorize|callback/i.test(
        decodeURIComponent(url.pathname),
      )
    )
      return null;
    if (
      /(?:token|auth|password|secret|credential|session|ticket|signature|reset)[=_-]/i.test(
        decodeURIComponent(url.hash),
      )
    )
      return null;
    for (const key of url.searchParams.keys()) {
      if (
        /^(?:(?:access|refresh|id|auth|authaccess)?token|auth(?:orization)?|code|password|passwd|secret|clientsecret|credential|privatekey|bearer|oauth|(?:api)?key|session(?:id)?|sid|ticket|signature|sig|state|reset(?:token|code)?)$|^(?:xamz|xgoog)/i.test(
          key.replace(/[^a-z0-9]/gi, ""),
        )
      )
        return null;
    }
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

function decodeHtml(value: string): string {
  return value
    .replace(/&#(x[\da-f]+|\d+);?/gi, (_, code: string) => {
      const n = Number.parseInt(
        code[0]?.toLowerCase() === "x" ? code.slice(1) : code,
        code[0]?.toLowerCase() === "x" ? 16 : 10,
      );
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
    })
    .replace(
      /&(amp|quot|apos|lt|gt|nbsp);/gi,
      (_, name: string) =>
        ({ amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " })[name.toLowerCase()] ?? "",
    )
    .replace(/<[^<>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function metadata(html: string, url: URL) {
  const meta = new Map<string, string>();
  const tags = /<\/?(meta|title)(?=[\s/>])/gi;
  let titleStart = -1;
  let titleText: string | undefined;
  for (let match = tags.exec(html); match; match = tags.exec(html)) {
    const start = tags.lastIndex;
    const limit = Math.min(html.length, match.index + MAX_METADATA_TAG_LENGTH);
    let end = start;
    let quote = "";
    // Always advance past scanned input, even for oversized or unclosed tags.
    for (; end < limit; end++) {
      const char = html[end]!;
      if (quote) {
        if (char === quote) quote = "";
      } else if (char === '"' || char === "'") quote = char;
      else if (char === ">") break;
    }
    tags.lastIndex = end < limit ? end + 1 : end;
    if (end === limit) continue;
    const closing = html[match.index + 1] === "/";
    if (match[1]!.toLowerCase() === "title") {
      if (titleText === undefined) {
        if (closing && titleStart >= 0) {
          // shortcut: title text is capped at 8 KiB; expand only for real pages that need more.
          titleText = decodeHtml(
            html.slice(titleStart, Math.min(match.index, titleStart + MAX_METADATA_TAG_LENGTH)),
          );
        } else if (!closing && titleStart < 0) titleStart = end + 1;
      }
      continue;
    }
    if (closing) continue;
    const tag = html.slice(start, end);
    const attrs = new Map<string, string>();
    const attribute = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gy;
    for (let offset = 0; offset < tag.length; ) {
      attribute.lastIndex = offset;
      const attr = attribute.exec(tag);
      offset = attr ? attribute.lastIndex : offset + 1;
      if (!attr) continue;
      const name = attr[1]!.toLowerCase();
      const value = attr[2] ?? attr[3] ?? attr[4];
      if ((name === "property" || name === "name" || name === "content") && value !== undefined)
        attrs.set(name, decodeHtml(value));
    }
    const name = (attrs.get("property") || attrs.get("name") || "").toLowerCase();
    if (name && !meta.has(name)) meta.set(name, attrs.get("content") ?? "");
  }
  const title = meta.get("og:title") || meta.get("twitter:title") || titleText || url.hostname;
  const image =
    meta.get("og:image:secure_url") || meta.get("og:image") || meta.get("twitter:image");
  return {
    title: title.slice(0, 200),
    description: (
      meta.get("og:description") ||
      meta.get("twitter:description") ||
      meta.get("description") ||
      ""
    ).slice(0, 320),
    site: (meta.get("og:site_name") || url.hostname).slice(0, 100),
    image,
  };
}

function validImage(bytes: Buffer, type: string): boolean {
  if (type === "image/png")
    return bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  if (type === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/gif") return /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString("ascii"));
  if (type === "image/webp")
    return (
      bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP"
    );
  return false;
}

export function createLinkPreviewService(
  deps: {
    lookup?: typeof dnsLookup;
    http?: typeof httpRequest;
    https?: typeof httpsRequest;
    now?: () => number;
  } = {},
) {
  const lookup = deps.lookup ?? dnsLookup;
  const now = deps.now ?? Date.now;
  const previews = new Map<string, { value: LinkPreviewData | null; expiresAt: number }>();
  const images = new Map<string, Image>();
  const pending = new Map<string, Promise<LinkPreviewData | null>>();
  const rates = new Map<string, { count: number; expiresAt: number }>();
  let imageBytes = 0;

  function removeImage(id: string) {
    imageBytes -= images.get(id)?.bytes.length ?? 0;
    images.delete(id);
  }

  async function request(url: URL, maxBytes: number, signal: AbortSignal): Promise<Response> {
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(hostname)
      ? [{ address: hostname, family: isIP(hostname) }]
      : await lookup(hostname, { all: true, verbatim: true });
    if (signal.aborted) throw new Error("aborted");
    if (!addresses.length || addresses.some((item) => !isPublicPreviewAddress(item.address)))
      throw new Error("unsafe destination");
    const pinned = addresses[0]!;
    const pinnedLookup: NonNullable<RequestOptions["lookup"]> = (_host, options, callback) => {
      if (typeof options === "object" && options.all) callback(null, [pinned]);
      else callback(null, pinned.address, pinned.family);
    };
    return new Promise((resolve, reject) => {
      const transport =
        url.protocol === "https:" ? (deps.https ?? httpsRequest) : (deps.http ?? httpRequest);
      const req = transport(
        {
          protocol: url.protocol,
          hostname,
          path: url.pathname + url.search,
          method: "GET",
          agent: false,
          lookup: pinnedLookup,
          signal,
          maxHeaderSize: 16384,
          headers: {
            accept: "text/html,application/xhtml+xml,image/png,image/jpeg,image/gif,image/webp",
            "accept-encoding": "identity",
            "user-agent": "Vyline-LinkPreview/1.0",
          },
        },
        (response) => {
          let size = 0;
          const chunks: Buffer[] = [];
          response.on("error", reject);
          response.on("aborted", () => reject(new Error("incomplete response")));
          response.on("close", () => {
            if (!response.complete) reject(new Error("incomplete response"));
          });
          if (
            Number(response.headers["content-length"]) > maxBytes ||
            (response.headers["content-encoding"] &&
              response.headers["content-encoding"] !== "identity")
          ) {
            response.destroy(new Error("unsupported response"));
            return;
          }
          response.on("data", (chunk: Buffer | string) => {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += bytes.length;
            if (size > maxBytes) response.destroy(new Error("response too large"));
            else chunks.push(bytes);
          });
          response.on("end", () =>
            resolve({
              status: response.statusCode ?? 0,
              headers: {
                location: response.headers.location,
                "content-type": response.headers["content-type"],
              },
              body: Buffer.concat(chunks),
            }),
          );
        },
      );
      req.on("error", reject);
      req.end();
    });
  }

  async function fetchPublic(url: URL, maxBytes: number, signal: AbortSignal) {
    let current = url;
    for (let redirects = 0; redirects <= 3; redirects++) {
      const response = await request(current, maxBytes, signal);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.location;
        const next = location && parsePreviewUrl(new URL(location, current).href);
        if (
          !next ||
          redirects === 3 ||
          (current.protocol === "https:" && next.protocol !== "https:")
        )
          throw new Error("unsafe redirect");
        current = next;
      } else return { url: current, response };
    }
    throw new Error("redirect limit");
  }

  function readLinkPreviewImage(id: string, accountId: string, policy: LinkPreviewPolicy) {
    if (!previewPolicyAllowsFetch(policy) || !/^[a-f0-9]{64}$/.test(id)) return null;
    const image = images.get(id);
    if (!image || image.accountId !== accountId) return null;
    if (image.expiresAt <= now()) {
      removeImage(id);
      return null;
    }
    return { bytes: image.bytes, contentType: image.contentType };
  }

  async function fetchLinkPreview(
    raw: unknown,
    accountId: string,
    policy: LinkPreviewPolicy,
    callerSignal?: AbortSignal,
  ): Promise<LinkPreviewData | null> {
    if (
      !accountId ||
      !previewPolicyAllowsFetch(policy) ||
      typeof raw !== "string" ||
      callerSignal?.aborted
    )
      return null;
    const url = parsePreviewUrl(raw);
    if (!url) return null;
    const key = createHash("sha256")
      .update(JSON.stringify([accountId, url.href]))
      .digest("hex");
    const cached = previews.get(key);
    if (cached && cached.expiresAt > now()) {
      if (cached.value?.imageId && !readLinkPreviewImage(cached.value.imageId, accountId, policy)) {
        const { imageId: _expiredImage, ...text } = cached.value;
        cached.value = text;
      }
      return cached.value;
    }
    if (pending.has(key)) return pending.get(key)!;
    if (pending.size >= 4) return null;
    for (const [id, rate] of rates) if (rate.expiresAt <= now()) rates.delete(id);
    const rate = rates.get(accountId) ?? { count: 0, expiresAt: now() + 60_000 };
    if (rate.count >= 30 || (!rates.has(accountId) && rates.size >= 256)) return null;
    rate.count++;
    rates.set(accountId, rate);
    const controller = new AbortController();
    const abort = () => controller.abort();
    callerSignal?.addEventListener("abort", abort, { once: true });
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(null);
      }, 5000);
    });
    const task = (async (): Promise<LinkPreviewData | null> => {
      try {
        const { url: finalUrl, response } = await fetchPublic(url, MAX_HTML, controller.signal);
        if (
          response.status < 200 ||
          response.status >= 300 ||
          !/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(
            response.headers["content-type"] ?? "",
          )
        )
          return null;
        const data = metadata(response.body.toString("utf8"), finalUrl);
        const value: LinkPreviewData = {
          title: data.title,
          description: data.description,
          site: data.site,
        };
        if (data.image && !controller.signal.aborted) {
          try {
            const imageUrl = parsePreviewUrl(new URL(data.image, finalUrl).href);
            if (imageUrl) {
              const { response: image } = await fetchPublic(imageUrl, MAX_IMAGE, controller.signal);
              const type = image.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() ?? "";
              if (
                image.status >= 200 &&
                image.status < 300 &&
                validImage(image.body, type) &&
                !controller.signal.aborted
              ) {
                for (const [id, item] of images) if (item.expiresAt <= now()) removeImage(id);
                while (images.size >= 256 || imageBytes + image.body.length > MAX_IMAGE_CACHE)
                  removeImage(images.keys().next().value!);
                value.imageId = randomBytes(32).toString("hex");
                images.set(value.imageId, {
                  accountId,
                  bytes: image.body,
                  contentType: type,
                  expiresAt: now() + TTL,
                });
                imageBytes += image.body.length;
              }
            }
          } catch {
            /* Keep the text card when an image is unsafe, expired or unavailable. */
          }
        }
        return controller.signal.aborted ? null : value;
      } catch {
        return null;
      }
    })();
    const result = Promise.race([task, timeout]);
    pending.set(key, result);
    try {
      const value = await result;
      if (!callerSignal?.aborted) {
        while (previews.size >= 256) previews.delete(previews.keys().next().value!);
        previews.set(key, { value, expiresAt: now() + (value ? TTL : 5 * 60_000) });
      }
      return value;
    } finally {
      clearTimeout(timer!);
      callerSignal?.removeEventListener("abort", abort);
      pending.delete(key);
    }
  }
  return { fetchLinkPreview, readLinkPreviewImage };
}

export const linkPreviewService = createLinkPreviewService();
