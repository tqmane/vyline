/**
 * api/auth.ts
 *
 * 認証関連エンドポイント
 *
 * POST /auth/login/email   — メールログイン開始
 * POST /auth/login/qr      — QR ログイン開始
 * GET  /auth/login/qr/:id  — QR URL ポーリング
 * POST /auth/restore        — 保存済みトークンで復元
 * POST /auth/switch/:id     — アカウント切替（未ログインなら restore）
 * GET  /auth/accounts       — ログイン中 + 保存セッション一覧
 * GET  /auth/sessions       — 保存済みセッション詳細
 * DELETE /auth/sessions/:id — 保存セッション削除
 * DELETE /auth/accounts/:id — アカウント削除
 */

import { Hono } from "hono";
import { randomInt } from "node:crypto";
import { childLogger } from "../logger.js";
import { isSafeAccountId } from "../security.js";
import {
  loginWithEmail,
  loginWithQRCode,
  loginWithToken,
  loginWithAuthToken,
  listAccounts,
  getQrState,
  getLoggedInAt,
  removeClient,
} from "../line/clientManager.js";
import { deleteToken, loadTokens, listSavedSessions } from "../storage/tokenStore.js";

const log = childLogger("api:auth");
export const authRouter = new Hono();
type EmailLoginStatus = "idle" | "pending" | "completed" | "failed";
const emailLoginState = new Map<
  string,
  { status: EmailLoginStatus; pincode: string | null; error: string | null }
>();

function random6DigitPin(): string {
  return String(randomInt(100000, 1000000));
}

// ─────────────────────────────────────────────
// POST /auth/login/email
// body: { accountId, email, password }
// ─────────────────────────────────────────────
authRouter.post("/login/email", async (c) => {
  let body: { accountId?: string; email?: string; password?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid JSON body" }, 400);
  }

  if (!body.accountId || !body.email || !body.password) {
    return c.json({ ok: false, error: "accountId, email, password required" }, 400);
  }
  if (!isSafeAccountId(body.accountId)) {
    return c.json({ ok: false, error: "invalid accountId" }, 400);
  }
  if (body.email.length > 320 || body.password.length > 1024) {
    return c.json({ ok: false, error: "credentials too long" }, 413);
  }
  const { accountId, email, password } = body as {
    accountId: string;
    email: string;
    password: string;
  };

  // E2EE 暗号化と表示 PIN は必ず同一。食い違うと decryptKeyChain が Invalid type: 0 になる
  const pincode = random6DigitPin();
  emailLoginState.set(accountId, { status: "pending", pincode, error: null });

  loginWithEmail(
    accountId,
    email,
    password,
    (pin) => {
      emailLoginState.set(accountId, { status: "pending", pincode: pin, error: null });
      log.info({ accountId, pin: Boolean(pin) }, "PINCODE REQUIRED — enter on LINE app");
    },
    pincode,
  )
    .then(() => {
      const current = emailLoginState.get(accountId);
      emailLoginState.set(accountId, {
        status: "completed",
        pincode: current?.pincode ?? null,
        error: null,
      });
      log.info({ accountId }, "email login completed");
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      let userError = "メールログインに失敗しました。";

      if (message.includes("INVALID_IDENTITY_CREDENTIAL")) {
        userError = "メールアドレスまたはパスワードが正しくありません。";
      } else if (message.includes("REQUIRE_DEVICE_CONFIRM")) {
        userError = "LINE アプリ側で端末確認が必要です。";
      } else if (message.includes("TOO_MANY_REQUEST")) {
        userError = "試行回数が多すぎます。しばらく待って再試行してください。";
      } else if (message.includes("Invalid type")) {
        userError = "PIN 認証に失敗しました。表示された PIN をそのまま入力して再試行してください。";
      }

      emailLoginState.set(accountId, { status: "failed", pincode: null, error: userError });
      log.error({ accountId, err }, "email login failed");
    });

  return c.json({
    ok: true,
    message: "メールログインを開始しました。PIN が表示されたら LINE 端末に入力してください。",
    accountId,
  });
});

authRouter.get("/login/email/:id", (c) => {
  const accountId = c.req.param("id");
  if (!isSafeAccountId(accountId)) {
    return c.json({ ok: false, error: "invalid accountId" }, 400);
  }
  const state = emailLoginState.get(accountId) ?? {
    status: "idle" as EmailLoginStatus,
    pincode: null,
    error: null,
  };

  return c.json({
    ok: true,
    status: state.status,
    pincode: state.pincode,
    error: state.error,
  });
});

// ─────────────────────────────────────────────
// POST /auth/login/qr
// body: { accountId }
// ─────────────────────────────────────────────
authRouter.post("/login/qr", async (c) => {
  let body: { accountId?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid JSON body" }, 400);
  }
  if (!body.accountId || !isSafeAccountId(body.accountId)) {
    return c.json({ ok: false, error: "accountId required" }, 400);
  }

  // 非同期でログイン開始
  loginWithQRCode(body.accountId, (url) => {
    log.info({ accountId: body.accountId, urlReady: Boolean(url) }, "QR URL ready");
  })
    .then(() => {
      log.info({ accountId: body.accountId }, "QR login completed");
    })
    .catch((err: unknown) => {
      log.error({ accountId: body.accountId, err }, "QR login failed");
    });

  return c.json({
    ok: true,
    message: "QR login started — poll GET /auth/login/qr/:id for URL",
    accountId: body.accountId,
  });
});

// ─────────────────────────────────────────────
// GET /auth/login/qr/:id
// QR 状態をポーリングで取得する
// status: "idle" | "waiting" | "pending" | "expired" | "completed"
// ─────────────────────────────────────────────
authRouter.get("/login/qr/:id", (c) => {
  const accountId = c.req.param("id");
  if (!isSafeAccountId(accountId)) {
    return c.json({ ok: false, error: "invalid accountId" }, 400);
  }
  const { url, expired, pincode, inProgress } = getQrState(accountId);

  if (expired) {
    return c.json({ ok: true, status: "expired", qrUrl: null, pincode: null });
  }

  if (url) {
    return c.json({ ok: true, status: "pending", qrUrl: url, pincode });
  }

  // ログイン処理中だが URL 未着
  if (inProgress) {
    return c.json({ ok: true, status: "waiting", qrUrl: null, pincode });
  }

  const loggedIn = listAccounts().includes(accountId) && getLoggedInAt(accountId) !== null;
  // メモリにセッション無し → ホットリロード等で QR が消えた
  // フロントが「表示中だった QR」を失ったと分かるよう idle を返す
  return c.json({
    ok: true,
    status: loggedIn ? "completed" : "idle",
    qrUrl: null,
    pincode: null,
  });
});

// ─────────────────────────────────────────────
// POST /auth/restore
// body: { accountId }  — 保存済みトークンで復元
// ─────────────────────────────────────────────
authRouter.post("/restore", async (c) => {
  let body: { accountId?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid JSON body" }, 400);
  }
  if (!body.accountId || !isSafeAccountId(body.accountId)) {
    return c.json({ ok: false, error: "accountId required" }, 400);
  }

  try {
    await loginWithToken(body.accountId);
    return c.json({ ok: true, accountId: body.accountId });
  } catch (err) {
    log.error({ accountId: body.accountId, err }, "restore failed");
    return c.json({ ok: false, error: "restore failed" }, 502);
  }
});

// ─────────────────────────────────────────────
// POST /auth/login/token
// body: { accountId, authToken }  — トークン直接指定でログイン
// ─────────────────────────────────────────────
authRouter.post("/login/token", async (c) => {
  let body: { accountId?: string; authToken?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid JSON body" }, 400);
  }
  if (!body.accountId || !isSafeAccountId(body.accountId) || !body.authToken) {
    return c.json({ ok: false, error: "accountId and authToken required" }, 400);
  }
  if (body.authToken.length > 8192) {
    return c.json({ ok: false, error: "authToken too long" }, 413);
  }

  try {
    await loginWithAuthToken(body.accountId, body.authToken);

    // トークンを保存（次回から restore で復元可能）
    const { saveToken } = await import("../storage/tokenStore.js");
    await saveToken(body.accountId, body.authToken, {});

    log.info({ accountId: body.accountId }, "token login success");
    return c.json({ ok: true, accountId: body.accountId });
  } catch (err) {
    log.error({ accountId: body.accountId, err }, "token login failed");
    return c.json({ ok: false, error: "token login failed" }, 502);
  }
});

// ─────────────────────────────────────────────
// POST /auth/switch/:id
// 未ログインなら restore → ログイン済みならそのまま active 切替
// ─────────────────────────────────────────────
authRouter.post("/switch/:id", async (c) => {
  const accountId = c.req.param("id");
  if (!isSafeAccountId(accountId)) {
    return c.json({ ok: false, error: "accountId required" }, 400);
  }

  const active = listAccounts();
  if (active.includes(accountId)) {
    return c.json({ ok: true, accountId, restored: false });
  }

  const tokens = await loadTokens();
  if (!tokens[accountId]) {
    return c.json({ ok: false, error: "account not found" }, 404);
  }

  try {
    await loginWithToken(accountId);
    return c.json({ ok: true, accountId, restored: true });
  } catch (err) {
    log.error({ accountId, err }, "switch restore failed");
    return c.json({ ok: false, error: "restore failed" }, 502);
  }
});

// ─────────────────────────────────────────────
// GET /auth/accounts
// ─────────────────────────────────────────────
authRouter.get("/accounts", async (c) => {
  const active = listAccounts();
  const saved = await loadTokens();
  const sessions = await listSavedSessions();
  return c.json({
    ok: true,
    active,
    saved: Object.keys(saved),
    sessions,
  });
});

// ─────────────────────────────────────────────
// GET /auth/sessions — 保存済みセッション詳細
// ─────────────────────────────────────────────
authRouter.get("/sessions", async (c) => {
  const active = new Set(listAccounts());
  const sessions = (await listSavedSessions()).map((s) => ({
    ...s,
    active: active.has(s.accountId),
  }));
  return c.json({ ok: true, sessions });
});

// ─────────────────────────────────────────────
// DELETE /auth/sessions/:id — 保存セッションのみ削除（メモリは維持可）
// query: ?logout=1 でメモリ上のクライアントも破棄
// ─────────────────────────────────────────────
authRouter.delete("/sessions/:id", async (c) => {
  const accountId = c.req.param("id");
  if (!isSafeAccountId(accountId)) {
    return c.json({ ok: false, error: "invalid accountId" }, 400);
  }
  const alsoLogout = c.req.query("logout") === "1" || c.req.query("logout") === "true";
  await deleteToken(accountId);
  if (alsoLogout) removeClient(accountId);
  return c.json({ ok: true, accountId });
});

// ─────────────────────────────────────────────
// DELETE /auth/accounts/:id
// ─────────────────────────────────────────────
authRouter.delete("/accounts/:id", async (c) => {
  const accountId = c.req.param("id");
  if (!isSafeAccountId(accountId)) {
    return c.json({ ok: false, error: "invalid accountId" }, 400);
  }
  removeClient(accountId);
  await deleteToken(accountId);
  return c.json({ ok: true, accountId });
});
