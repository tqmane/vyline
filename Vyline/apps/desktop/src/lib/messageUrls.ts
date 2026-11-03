import { splitTextLinks } from "./linkifyText";

export type UrlPreviewSettings = {
  requestUrlPreviews?: boolean;
  linkPreviewMaxUrls?: number;
  streamerMode?: boolean;
};

export function maskMessageUrls(text: string): string {
  return splitTextLinks(text)
    .map((part) => (part.type === "link" ? "[URL]" : part.value))
    .join("");
}

export function canRequestUrlPreviews(settings: UrlPreviewSettings): boolean {
  return (
    settings.requestUrlPreviews === true &&
    !settings.streamerMode &&
    Number.isFinite(settings.linkPreviewMaxUrls) &&
    (settings.linkPreviewMaxUrls ?? 0) >= 1
  );
}

export function previewUrlsForText(text: string, limit = 1): string[] {
  if (!Number.isFinite(limit) || limit < 1) return [];
  const urls = new Set<string>();
  for (const part of splitTextLinks(text.slice(0, 32_768))) {
    if (part.type !== "link" || part.href.length > 2048) continue;
    try {
      const url = new URL(part.href);
      if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port) continue;
      if (
        !url.hostname.includes(".") ||
        /^[\d.]+$/.test(url.hostname) ||
        url.hostname.includes(":")
      )
        continue;
      if (
        /(?:^|\.)(?:localhost|local|internal|test|invalid|onion)$|\.home\.arpa\.?$/i.test(
          url.hostname,
        )
      )
        continue;
      if (
        /password[_-]?reset|reset[_-]?password|oauth|authorize|callback/i.test(
          decodeURIComponent(url.pathname),
        )
      )
        continue;
      if (
        /(?:token|auth|password|secret|credential|session|ticket|signature|reset)[=_-]/i.test(
          decodeURIComponent(url.hash),
        )
      )
        continue;
      if (
        [...url.searchParams.keys()].some((key) =>
          /^(?:(?:access|refresh|id|auth|authaccess)?token|auth(?:orization)?|code|password|passwd|secret|clientsecret|credential|privatekey|bearer|oauth|(?:api)?key|session(?:id)?|sid|ticket|signature|sig|state|reset(?:token|code)?)$|^(?:xamz|xgoog)/i.test(
            key.replace(/[^a-z0-9]/gi, ""),
          ),
        )
      )
        continue;
      url.hash = "";
      urls.add(url.href);
      if (urls.size >= Math.min(3, Math.floor(limit))) break;
    } catch {
      /* Invalid or malformed URL: leave the message text alone. */
    }
  }
  return [...urls];
}
