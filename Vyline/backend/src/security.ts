import { timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";

const ACCOUNT_ID_RE = /^[\p{L}\p{N}][\p{L}\p{N}._@+-]{0,127}$/u;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isSafeAccountId(value: unknown): value is string {
  return typeof value === "string" && ACCOUNT_ID_RE.test(value.normalize("NFC"));
}

export function assertSafeAccountId(value: unknown): asserts value is string {
  if (!isSafeAccountId(value)) {
    throw new TypeError("invalid accountId");
  }
}

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.trim().toLowerCase());
}

/**
 * The desktop BFF has access to LINE auth tokens, decrypted messages, and write APIs.
 * Refuse an externally reachable bind unless a trusted access proxy is explicitly acknowledged.
 */
export function assertSecureBindConfiguration(host: string): void {
  if (isLoopbackHost(host)) return;
  if (process.env.VYLINE_TRUSTED_PROXY_AUTH === "1") return;
  if (process.env.VYLINE_LOOPBACK_PORT_FORWARD === "1") return;
  throw new Error(
    "Refusing non-loopback bind without an explicit access boundary. " +
      "Use VYLINE_TRUSTED_PROXY_AUTH=1 behind an authenticated proxy, or " +
      "VYLINE_LOOPBACK_PORT_FORWARD=1 only when the host port is bound to 127.0.0.1.",
  );
}

export function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function configuredOrigins(): Set<string> {
  const raw = process.env.VYLINE_CORS_ORIGIN ?? "http://localhost:5173";
  const origins = new Set(
    raw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (origins.has("*")) {
    throw new Error("VYLINE_CORS_ORIGIN=* is not allowed for a credential-bearing application");
  }
  return origins;
}

export const ALLOWED_CORS_ORIGINS = configuredOrigins();

export function isAllowedOrigin(origin: string, requestUrl: string): boolean {
  try {
    if (origin === new URL(requestUrl).origin) return true;
  } catch {
    return false;
  }
  return ALLOWED_CORS_ORIGINS.has(origin);
}

export function isAllowedWebSocketOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || isAllowedOrigin(origin, request.url);
}

export const requestIntegrityGuard: MiddlewareHandler = async (c, next) => {
  const method = c.req.method.toUpperCase();
  if (!SAFE_METHODS.has(method)) {
    const fetchSite = c.req.header("sec-fetch-site")?.toLowerCase();
    if (fetchSite === "cross-site") {
      return c.json({ ok: false, error: "cross-site request rejected" }, 403);
    }
    const origin = c.req.header("origin");
    if (origin && !isAllowedOrigin(origin, c.req.url)) {
      return c.json({ ok: false, error: "origin not allowed" }, 403);
    }
  }
  await next();
};

export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Frame-Options", "DENY");
  c.header("Cross-Origin-Opener-Policy", "same-origin");
  c.header("Cross-Origin-Resource-Policy", "same-origin");
  c.header("Permissions-Policy", "camera=(self), microphone=(self), geolocation=()");
  c.header(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "base-uri 'none'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data: blob: https:",
      "media-src 'self' data: blob:",
      "connect-src 'self' ws: wss:",
    ].join("; "),
  );

  if (/^\/(?:api\/)?(?:auth|line|debug|v1)(?:\/|$)/.test(c.req.path)) {
    c.header("Cache-Control", "no-store");
    c.header("Pragma", "no-cache");
  }
};

type Window = { count: number; resetAt: number };
const rateWindows = new Map<string, Window>();

function clientKey(c: Context): string {
  if (process.env.VYLINE_TRUST_PROXY === "1") {
    const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) return forwarded.slice(0, 128);
  }
  return "direct-client";
}

function consume(key: string, limit: number, windowMs: number): number | null {
  const now = Date.now();
  const current = rateWindows.get(key);
  if (!current || current.resetAt <= now) {
    rateWindows.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }
  current.count += 1;
  if (current.count <= limit) return null;
  return Math.max(1, Math.ceil((current.resetAt - now) / 1000));
}

/** In-process safety net. The public Vercel service additionally uses Redis and WAF limits. */
export const localRateLimit: MiddlewareHandler = async (c, next) => {
  if (c.req.method === "OPTIONS" || c.req.path === "/healthz") {
    await next();
    return;
  }
  const client = clientKey(c);
  const isLogin = /^\/(?:api\/)?auth\/login\//.test(c.req.path);
  const isWrite = !SAFE_METHODS.has(c.req.method.toUpperCase());
  const retryAfter = isLogin
    ? consume(`login:${client}`, 8, 15 * 60_000)
    : isWrite
      ? consume(`write:${client}`, 180, 60_000)
      : consume(`read:${client}`, 1_200, 60_000);
  if (retryAfter != null) {
    c.header("Retry-After", String(retryAfter));
    return c.json({ ok: false, error: "too many requests" }, 429);
  }
  if (rateWindows.size > 10_000) {
    const now = Date.now();
    for (const [key, value] of rateWindows) {
      if (value.resetAt <= now) rateWindows.delete(key);
    }
  }
  await next();
};
