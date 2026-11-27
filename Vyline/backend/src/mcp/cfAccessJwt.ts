import { createPublicKey } from "node:crypto";

export type CfAccessConfig = {
  teamDomain: string;
  audiences: string[];
};

export type CfAccessIdentity = {
  email?: string;
  sub?: string;
};

type JwkEntry = JsonWebKey & {
  kid?: string;
  alg?: string;
  kty?: string;
};

type JwksCacheEntry = {
  keys: JwkEntry[];
  fetchedAt: number;
};

const JWKS_TTL_MS = 10 * 60_000;
const JWKS_FORCE_REFRESH_COOLDOWN_MS = 30_000;
const CLOCK_SKEW_SEC = 60;
const jwksCache = new Map<string, JwksCacheEntry>();

export function normalizeTeamDomain(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "";
  }
}

export function getCfAccessConfig(
  env: Record<string, string | undefined> = process.env,
): CfAccessConfig | null {
  const teamDomain = normalizeTeamDomain(env.VYLINE_CF_ACCESS_TEAM_DOMAIN ?? "");
  const audiences = (env.VYLINE_CF_ACCESS_AUD ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!teamDomain || audiences.length === 0) return null;
  return { teamDomain, audiences };
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4;
  const padded = pad === 0 ? normalized : normalized + "=".repeat(4 - pad);
  const decoded = Buffer.from(padded, "base64");
  const out = new Uint8Array(new ArrayBuffer(decoded.byteLength));
  out.set(decoded);
  return out;
}

function decodeJwtJson(segment: string): Record<string, unknown> | null {
  try {
    const decoded = Buffer.from(decodeBase64Url(segment)).toString("utf8");
    const parsed = JSON.parse(decoded) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function fetchJwks(
  teamDomain: string,
  forceRefresh: boolean,
  fetchImpl: typeof fetch,
): Promise<JwkEntry[]> {
  const now = Date.now();
  const cached = jwksCache.get(teamDomain);
  if (
    cached &&
    (!forceRefresh || now - cached.fetchedAt < JWKS_FORCE_REFRESH_COOLDOWN_MS) &&
    now - cached.fetchedAt < JWKS_TTL_MS
  ) {
    return cached.keys;
  }

  const response = await fetchImpl(`${teamDomain}/cdn-cgi/access/certs`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    if (cached && now - cached.fetchedAt < JWKS_TTL_MS * 3) return cached.keys;
    throw new Error(`JWKS fetch failed: ${response.status}`);
  }
  const body = (await response.json()) as { keys?: unknown };
  const keys = Array.isArray(body?.keys)
    ? body.keys.filter((entry): entry is JwkEntry => Boolean(entry && typeof entry === "object"))
    : [];
  if (keys.length === 0) throw new Error("JWKS contained no keys");
  jwksCache.set(teamDomain, { keys, fetchedAt: now });
  return keys;
}

async function importRsaKey(jwk: JwkEntry): Promise<CryptoKey> {
  if (jwk.kty !== "RSA" || typeof jwk.n !== "string" || typeof jwk.e !== "string") {
    throw new Error("Unsupported JWK key type");
  }
  // Node/Bun crypto converts JWK cleanly; strip private fields if any accidentally exist.
  const publicJwk: JsonWebKey = {
    kty: "RSA",
    n: jwk.n,
    e: jwk.e,
    alg: "RS256",
    ext: true,
    key_ops: ["verify"],
  };
  const keyObj = createPublicKey({ key: publicJwk as unknown as Record<string, unknown>, format: "jwk" });
  const spki = keyObj.export({ type: "spki", format: "der" });
  return crypto.subtle.importKey(
    "spki",
    new Uint8Array(spki),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

export async function verifyCfAccessJwt(
  token: string,
  config: CfAccessConfig,
  fetchImpl: typeof fetch = fetch,
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<CfAccessIdentity | null> {
  const parts = token.trim().split(".");
  if (parts.length !== 3) return null;
  const [headerSeg, payloadSeg, signatureSeg] = parts;
  if (!headerSeg || !payloadSeg || !signatureSeg) return null;

  const header = decodeJwtJson(headerSeg);
  const payload = decodeJwtJson(payloadSeg);
  if (!header || !payload) return null;
  if (header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid) return null;

  const issuer = typeof payload.iss === "string" ? normalizeTeamDomain(payload.iss) : "";
  if (!issuer || issuer !== config.teamDomain) return null;

  const tokenAud = Array.isArray(payload.aud)
    ? payload.aud.filter((value): value is string => typeof value === "string")
    : typeof payload.aud === "string"
      ? [payload.aud]
      : [];
  if (!tokenAud.some((aud) => config.audiences.includes(aud))) return null;

  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) return null;
  if (nowSec - CLOCK_SKEW_SEC >= payload.exp) return null;
  if (payload.nbf !== undefined) {
    if (typeof payload.nbf !== "number" || !Number.isFinite(payload.nbf)) return null;
    if (payload.nbf > nowSec + CLOCK_SKEW_SEC) return null;
  }

  let keys: JwkEntry[];
  try {
    keys = await fetchJwks(config.teamDomain, false, fetchImpl);
    if (!keys.some((entry) => entry.kid === header.kid)) {
      keys = await fetchJwks(config.teamDomain, true, fetchImpl);
    }
  } catch {
    return null;
  }

  const jwk = keys.find((entry) => entry.kid === header.kid);
  if (!jwk) return null;

  try {
    const key = await importRsaKey(jwk);
    const signingInput = new TextEncoder().encode(`${headerSeg}.${payloadSeg}`);
    const signature = decodeBase64Url(signatureSeg);
    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, signingInput);
    if (!valid) return null;
    return {
      ...(typeof payload.email === "string" ? { email: payload.email } : {}),
      ...(typeof payload.sub === "string" ? { sub: payload.sub } : {}),
    };
  } catch {
    return null;
  }
}

export function clearCfAccessJwksCache(): void {
  jwksCache.clear();
}
