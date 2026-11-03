import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  AgentIAuthenticationError,
  agentILimits,
  askAgentI,
  clearAgentIYahooCookie,
  getAgentICredentials,
  getAgentIHistory,
  resetAgentISession,
  setAgentIYahooCookie,
  type AgentIHistoryItem,
} from "../service/agentIService.js";
import { getSubdeviceSession } from "../storage/subdeviceStore.js";

export const agentIRouter = new Hono();

function isLanAccessEnabled() {
  return process.env.VYLINE_LAN_ACCESS === "true";
}

function accountIdFromPath(path: string): string {
  const match = path.match(/\/([^/]+)\/(?:chat|history|session|credentials)$/);
  if (!match) return "";
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return "";
  }
}

agentIRouter.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  if (!isLanAccessEnabled() || c.req.header("x-vyline-local-request") === "1") return next();

  const auth = c.req.header("authorization") ?? "";
  const session = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const installationId = c.req.header("x-vyline-installation-id");
  const device = await getSubdeviceSession(session, installationId);
  if (!device) {
    return c.json({ ok: false, error: "subdevice authentication required" }, 401);
  }
  if (accountIdFromPath(c.req.path) !== device.accountId) {
    return c.json({ ok: false, error: "subdevice account mismatch" }, 403);
  }
  return next();
});
agentIRouter.use(
  "*",
  bodyLimit({
    maxSize: 96 * 1024,
    onError: (c) => c.json({ ok: false, error: "request is too large" }, 413),
  }),
);

function validHistory(value: unknown): AgentIHistoryItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(-agentILimits.MAX_CONTEXT_ITEMS)
    .filter((item): item is { role: "user" | "assistant"; text: string } => {
      if (!item || typeof item !== "object") return false;
      const candidate = item as Record<string, unknown>;
      return (
        (candidate.role === "user" || candidate.role === "assistant") &&
        typeof candidate.text === "string"
      );
    })
    .map((item) => ({ role: item.role, text: item.text.slice(0, agentILimits.MAX_CONTEXT_TEXT) }));
}

agentIRouter.post("/:accountId/chat", async (c) => {
  const accountId = c.req.param("accountId");
  const body = await c.req
    .json<{ prompt?: unknown; history?: unknown; authMode?: unknown }>()
    .catch(() => null);
  if (!body || typeof body.prompt !== "string" || !body.prompt.trim()) {
    return c.json({ ok: false, error: "prompt is required" }, 400);
  }
  if (body.prompt.length > agentILimits.MAX_PROMPT_LENGTH) {
    return c.json({ ok: false, error: "prompt is too long" }, 422);
  }
  if (
    body.authMode !== undefined &&
    body.authMode !== "anonymous" &&
    body.authMode !== "authenticated"
  ) {
    return c.json({ ok: false, error: "authMode is invalid" }, 400);
  }
  try {
    const result = await askAgentI(
      accountId,
      body.prompt,
      validHistory(body.history),
      body.authMode ?? "anonymous",
    );
    return c.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof AgentIAuthenticationError) {
      return c.json({ ok: false, error: error.message }, 401);
    }
    // Transport errors can contain request headers or prompt text; do not log them.
    return c.json({ ok: false, error: "upstream service unavailable" }, 502);
  }
});

agentIRouter.get("/:accountId/credentials", (c) => {
  return c.json({ ok: true, ...getAgentICredentials(c.req.param("accountId")) });
});

agentIRouter.put("/:accountId/credentials", async (c) => {
  const accountId = c.req.param("accountId");
  const body = await c.req.json<{ yahooCookie?: unknown; consent?: unknown }>().catch(() => null);
  if (!body || body.consent !== true || typeof body.yahooCookie !== "string") {
    return c.json({ ok: false, error: "Yahooへの送信に同意してCookieを入力してください" }, 400);
  }
  try {
    setAgentIYahooCookie(accountId, body.yahooCookie);
    return c.json({ ok: true, ...getAgentICredentials(accountId) });
  } catch {
    return c.json({ ok: false, error: "Yahoo Cookie形式が正しくありません" }, 400);
  }
});

agentIRouter.delete("/:accountId/credentials", (c) => {
  clearAgentIYahooCookie(c.req.param("accountId"));
  return c.json({ ok: true });
});

agentIRouter.get("/:accountId/history", (c) => {
  return c.json({ ok: true, history: getAgentIHistory(c.req.param("accountId")) });
});

agentIRouter.delete("/:accountId/session", (c) => {
  resetAgentISession(c.req.param("accountId"));
  return c.json({ ok: true });
});
