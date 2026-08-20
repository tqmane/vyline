const WEB_PROTOCOLS = new Set(["https:", "http:"]);
const DEEP_LINK_PROTOCOLS = new Set(["line:", "mailto:", "tel:"]);

/** Return a normalized URL only when its scheme is safe to activate from untrusted content. */
export function safeExternalHref(
  value: unknown,
  options: { allowDeepLinks?: boolean } = {},
): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    const allowed =
      WEB_PROTOCOLS.has(url.protocol) ||
      (options.allowDeepLinks === true && DEEP_LINK_PROTOCOLS.has(url.protocol));
    if (!allowed || url.username || url.password) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}
