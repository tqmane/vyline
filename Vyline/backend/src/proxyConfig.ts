/**
 * proxyConfig.ts — LINE 向け HTTP(S)/SOCKS プロキシ設定
 *
 * Bun は HTTP_PROXY / HTTPS_PROXY / ALL_PROXY を参照する。
 */

import { childLogger } from "./logger.js";

const log = childLogger("proxy");

export type ProxyConfig = {
  enabled: boolean;
  url: string;
};

let current: ProxyConfig = {
  enabled: Boolean(process.env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.ALL_PROXY),
  url: process.env.ALL_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "",
};

export function getProxyConfig(): ProxyConfig {
  if (!current.enabled) return { enabled: false, url: "" };
  try {
    const parsed = new URL(current.url);
    if (parsed.username) parsed.username = "********";
    if (parsed.password) parsed.password = "********";
    return { enabled: true, url: parsed.toString() };
  } catch {
    return { enabled: true, url: "configured" };
  }
}

export function setProxyConfig(next: ProxyConfig): ProxyConfig {
  const raw = next.url.trim();
  if (next.enabled) {
    if (!raw || raw.length > 2048) throw new TypeError("invalid proxy URL");
    const parsed = new URL(raw);
    if (!new Set(["http:", "https:", "socks5:", "socks5h:"]).has(parsed.protocol)) {
      throw new TypeError("unsupported proxy protocol");
    }
  }
  current = {
    enabled: Boolean(next.enabled && raw),
    url: raw,
  };
  if (current.enabled) {
    process.env.HTTP_PROXY = current.url;
    process.env.HTTPS_PROXY = current.url;
    process.env.ALL_PROXY = current.url;
    log.info({ url: current.url.replace(/:[^:@/]+@/, ":***@") }, "proxy enabled");
  } else {
    process.env.HTTP_PROXY = undefined;
    process.env.HTTPS_PROXY = undefined;
    process.env.ALL_PROXY = undefined;
    log.info("proxy disabled");
  }
  return getProxyConfig();
}
