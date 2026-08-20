/**
 * backend/src/index.ts — Hono + Bun WebSocket（通話 PCM ブリッジ）
 *
 * 通話モジュールは遅延 import（ログイン等の基本機能を通話スタック障害から切り離す）
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";

import { existsSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "./logger.js";
import { authRouter } from "./api/auth.js";
import { ANDROID_DB_MAX_BYTES, lineRouter } from "./api/line.js";
import { debugRouter } from "./api/debug.js";
import { cdnRouter } from "./api/cdn.js";
import { publicRouter } from "./api/public.js";
import { restoreAllSessions } from "./line/clientManager.js";
import { initVylineProfile } from "./vyline/profileBridge.js";
import { warmAccountCache } from "./storage/chatStore.js";
import type { CallWsData } from "./call/callManager.js";
import { ensureCdnCacheDir } from "./storage/cdnAssetCache.js";
import { ensureMediaCacheDir } from "./storage/mediaCache.js";
import {
  ALLOWED_CORS_ORIGINS,
  assertSecureBindConfiguration,
  isSafeAccountId,
  isAllowedWebSocketOrigin,
  localRateLimit,
  requestIntegrityGuard,
  securityHeaders,
} from "./security.js";

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.VYLINE_HOST ?? "127.0.0.1";
const CORS_ORIGIN = process.env.VYLINE_CORS_ORIGIN ?? "http://localhost:5173";
const STATIC_DIR =
  process.env.VYLINE_STATIC_DIR ??
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "apps", "desktop", "dist");

assertSecureBindConfiguration(HOST);

const app = new Hono();

app.use("*", securityHeaders);
app.use("*", requestIntegrityGuard);
app.use("*", localRateLimit);
const regularBodyLimit = bodyLimit({
  maxSize: 16 * 1024 * 1024,
  onError: (c) => c.json({ ok: false, error: "request body too large" }, 413),
});
const androidDbBodyLimit = bodyLimit({
  maxSize: ANDROID_DB_MAX_BYTES,
  onError: (c) => c.json({ ok: false, error: "Android database upload is too large" }, 413),
});
app.use("*", async (c, next) => {
  const isAndroidDbImport =
    c.req.method === "POST" &&
    /^\/(?:api\/)?line\/[^/]+\/backup\/android-db$/.test(c.req.path);
  return (isAndroidDbImport ? androidDbBodyLimit : regularBodyLimit)(c, next);
});
app.use(
  "*",
  cors({
    origin: (origin) => (ALLOWED_CORS_ORIGINS.has(origin) ? origin : ""),
    allowHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"],
    allowMethods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    maxAge: 600,
    credentials: false,
  }),
);

app.get("/healthz", (c) => c.json({ ok: true, status: "ready" }));
app.route("/auth", authRouter);
app.route("/line", lineRouter);
app.route("/cdn", cdnRouter);

// セルフホスト用: /api プレフィックス付きでも同じルーターへ届ける
// （フロントは dev では Vite proxy、本番では同オリジンの /api を使う）
app.route("/api/auth", authRouter);
app.route("/api/line", lineRouter);
app.route("/api/cdn", cdnRouter);

// Debug routes expose E2EE state and message previews. Never mount them by default.
if (process.env.VYLINE_ENABLE_DEBUG === "1") {
  app.route("/debug", debugRouter);
  app.route("/api/debug", debugRouter);
}

// 公開 REST API（Bearer トークン認証）
app.route("/v1", publicRouter);
app.route("/api/v1", publicRouter);

// OpenAPI 仕様
app.get("/openapi.yaml", async (c) => {
  try {
    const yamlPath = join(dirname(fileURLToPath(import.meta.url)), "../../openapi.yaml");
    const yaml = await readFile(yamlPath, "utf8");
    return new Response(yaml, {
      status: 200,
      headers: { "Content-Type": "text/yaml; charset=utf-8" },
    });
  } catch {
    return c.json({ ok: false, error: "openapi.yaml not found" }, 404);
  }
});
app.get("/openapi.json", async (c) => {
  try {
    const yamlPath = join(dirname(fileURLToPath(import.meta.url)), "../../openapi.yaml");
    const yaml = await readFile(yamlPath, "utf8");
    return new Response(yaml, {
      status: 200,
      headers: { "Content-Type": "text/yaml; charset=utf-8" },
    });
  } catch {
    return c.json({ ok: false, error: "openapi.yaml not found" }, 404);
  }
});

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const SPA_PATHS = new Set(["", "/", "/chat", "/settings", "/login", "/hub"]);

async function serveStaticFile(path: string) {
  if (path.includes("\0") || path.includes("\\")) {
    return new Response("forbidden", { status: 403 });
  }
  const root = await realpath(STATIC_DIR);
  const requested = path === "/" ? "index.html" : path.replace(/^\/+/, "");
  const file = resolve(root, requested);
  const rel = relative(root, file);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    if (requested !== "index.html") return new Response("forbidden", { status: 403 });
  }
  try {
    const actual = await realpath(file);
    const actualRel = relative(root, actual);
    if (actualRel.startsWith("..") || isAbsolute(actualRel) || !(await stat(actual)).isFile()) {
      return new Response("forbidden", { status: 403 });
    }
    const buf = await readFile(actual);
    const ext = extname(actual).toLowerCase();
    return new Response(buf, {
      status: 200,
      headers: {
        "Content-Type": MIME[ext] ?? "application/octet-stream",
        "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return null;
  }
}

if (existsSync(STATIC_DIR)) {
  app.get("*", async (c) => {
    const path = c.req.path || "/";
    const res = await serveStaticFile(path);
    if (res) return res;
    // SPA フォールバック（拡張子なし・既知ルートは index.html）
    if (!/\.[a-z0-9]+$/i.test(path) || SPA_PATHS.has(path)) {
      const idx = await serveStaticFile("/index.html");
      if (idx) return idx;
    }
    return c.json({ ok: false, error: "not found" }, 404);
  });
}

app.notFound((c) => c.json({ ok: false, error: "not found" }, 404));

app.onError((err, c) => {
  logger.error({ err }, "unhandled error");
  // 内部の MID・パス・プロトコル詳細をクライアントに返さない
  return c.json({ ok: false, error: "internal server error" }, 500);
});

logger.info(
  { port: PORT, host: HOST, staticDir: STATIC_DIR, cors: CORS_ORIGIN },
  "starting Vyline backend",
);

process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  const code = reason instanceof Error ? ((reason as NodeJS.ErrnoException).code ?? "") : "";
  if (
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    msg.includes("ECONNRESET") ||
    msg.includes("socket connection was closed") ||
    (typeof reason === "object" &&
      reason !== null &&
      "path" in reason &&
      String((reason as { path?: string }).path ?? "").includes("/PUSH/"))
  ) {
    logger.debug({ reason, code, msg }, "push/listen connection reset (ignored)");
    return;
  }
  logger.error({ reason }, "unhandled rejection");
});

await initVylineProfile();
void ensureCdnCacheDir().catch(() => undefined);
void ensureMediaCacheDir().catch(() => undefined);

restoreAllSessions()
  .then(async () => {
    const { listAccounts } = await import("./line/clientManager.js");
    for (const id of listAccounts()) {
      await warmAccountCache(id).catch(() => undefined);
    }
  })
  .catch((err) => {
    logger.warn({ err }, "session restore had errors");
  });

type CallWsHandlers = typeof import("./call/callManager.js").callWebSocketHandler;
let callWsHandlers: CallWsHandlers | null = null;

async function getCallWsHandlers(): Promise<CallWsHandlers> {
  if (!callWsHandlers) {
    const mod = await import("./call/callManager.js");
    callWsHandlers = mod.callWebSocketHandler;
  }
  return callWsHandlers;
}

export default {
  port: PORT,
  hostname: HOST,
  /** 既読取得など LINE RPC が 10s を超えることがある */
  idleTimeout: 120,
  maxRequestBodySize: ANDROID_DB_MAX_BYTES,
  fetch(req: Request, server: Bun.Server<CallWsData>) {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/line\/([^/]+)\/call\/ws$/);
    if (m && req.headers.get("upgrade")?.toLowerCase() === "websocket") {
      if (!isAllowedWebSocketOrigin(req)) {
        return new Response("origin not allowed", { status: 403 });
      }
      let accountId: string;
      try {
        accountId = decodeURIComponent(m[1]!);
      } catch {
        return new Response("invalid account", { status: 400 });
      }
      if (!isSafeAccountId(accountId)) {
        return new Response("invalid account", { status: 400 });
      }
      const sessionId = url.searchParams.get("sessionId");
      if (!sessionId) {
        return new Response("sessionId required", { status: 400 });
      }
      const ok = server.upgrade(req, { data: { accountId, sessionId } });
      if (ok) return undefined as unknown as Response;
      return new Response("WebSocket upgrade failed", { status: 500 });
    }
    return app.fetch(req, server);
  },
  websocket: {
    maxPayloadLength: 256 * 1024,
    backpressureLimit: 1024 * 1024,
    closeOnBackpressureLimit: true,
    open(ws: Bun.ServerWebSocket<CallWsData>) {
      void getCallWsHandlers().then((h) => h.open(ws));
    },
    message(ws: Bun.ServerWebSocket<CallWsData>, message: string | Buffer) {
      void getCallWsHandlers().then((h) => h.message(ws, message));
    },
    close(ws: Bun.ServerWebSocket<CallWsData>) {
      void getCallWsHandlers().then((h) => h.close(ws));
    },
  },
};
