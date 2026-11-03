const AGENT_I_CHAT_URL = "https://search.yahoo.co.jp/chat";
const AGENT_I_ENDPOINT = "https://search-agent.yahoo.co.jp/v2/chat";
const MAX_PROMPT_LENGTH = 4_000;
const MAX_CONTEXT_ITEMS = 12;
const MAX_CONTEXT_TEXT = 1_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const SESSION_TTL_MS = 30 * 60_000;
const MAX_YAHOO_COOKIE_LENGTH = 16_384;

export type AgentIHistoryItem = { role: "user" | "assistant"; text: string };
export type AgentIAuthMode = "anonymous" | "authenticated";
export type AgentICredentials = { yahooCookieConfigured: boolean; expiresAt: number | null };

export class AgentIAuthenticationError extends Error {
  constructor() {
    super("Yahoo Cookieが無効または期限切れです。匿名モードへ戻しました");
  }
}

type AgentIChatMessage = {
  id: string;
  role: "user" | "assistant";
  contents: [{ type: "text"; text: string }];
};

export type AgentIBody = {
  chats: AgentIChatMessage[];
  context: {
    agentMode: "multi";
    logid: string;
    qId: string;
    snc: true;
    frtype: "line_chattab_searchbar";
    frcode: "line_agenti_chattab_searchbar";
    requestType: "free_text";
    index: 0;
    yz: false;
    pdis: false;
  };
  debug: Record<string, never>;
};

const randomId = () => crypto.randomUUID().replaceAll("-", "");

function trimHistory(history: AgentIHistoryItem[]): AgentIHistoryItem[] {
  return history
    .slice(-MAX_CONTEXT_ITEMS)
    .map((item) => ({
      role: item.role,
      text: item.text.trim().slice(0, MAX_CONTEXT_TEXT),
    }))
    .filter((item) => item.text.length > 0);
}

export function buildAgentIBody(prompt: string, history: AgentIHistoryItem[] = []): AgentIBody {
  const text = prompt.trim().slice(0, MAX_PROMPT_LENGTH);
  if (!text) throw new Error("prompt is required");

  const chats: AgentIChatMessage[] = trimHistory(history).map((item) => ({
    id: randomId(),
    role: item.role,
    contents: [{ type: "text", text: item.text }],
  }));
  chats.push({ id: randomId(), role: "user", contents: [{ type: "text", text }] });

  return {
    chats,
    context: {
      agentMode: "multi",
      logid: randomId(),
      qId: randomId(),
      snc: true,
      frtype: "line_chattab_searchbar",
      frcode: "line_agenti_chattab_searchbar",
      requestType: "free_text",
      index: 0,
      yz: false,
      pdis: false,
    },
    debug: {},
  };
}

function textFromData(data: unknown): string {
  if (typeof data === "string") return data;
  if (Array.isArray(data)) return data.map(textFromData).filter(Boolean).join("");
  if (!data || typeof data !== "object") return "";
  const value = data as Record<string, unknown>;
  // Agent I のSSEには type/attachment/execution などの制御イベントも含まれる。
  // 任意の値を再帰探索すると、これらのイベント名が回答本文として表示される。
  for (const key of ["text", "delta", "content", "message", "parts", "value"]) {
    const candidate = value[key];
    if (typeof candidate === "string") return candidate;
    if (candidate && typeof candidate === "object") {
      const nested = textFromData(candidate);
      if (nested) return nested;
    }
  }
  return "";
}

export function extractAgentIText(sse: string): string {
  const chunks: string[] = [];
  for (const event of sse.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("");
    if (!data || data === "[DONE]") continue;
    try {
      const text = textFromData(JSON.parse(data));
      if (text) chunks.push(text);
    } catch {
      // JSONでない制御イベント名を回答本文へ漏らさない。
      if (data && !/^(?:agentstate|compositeMessage|attachment|execution(?:-|$))/i.test(data)) {
        chunks.push(data);
      }
    }
  }
  return chunks.join("").trim();
}

/** Bound the remote SSE body before converting it into one in-memory string. */
export async function readBoundedAgentIResponse(
  response: Response,
  maxBytes = MAX_RESPONSE_BYTES,
): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Agent I response too large: ${declaredLength} bytes`);
  }

  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new Error(`Agent I response exceeded ${maxBytes} bytes`);
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
}

type AgentISession = {
  yahooCookie: string | undefined;
  anonymousCookie: Promise<string> | undefined;
  history: AgentIHistoryItem[];
  expiresAt: number;
  controller: AbortController;
  timer: ReturnType<typeof setTimeout>;
};
// Credentials and dialogue never enter settings, storage, or diagnostics.
const sessions = new Map<string, AgentISession>();

function existingSession(accountId: string): AgentISession | undefined {
  const session = sessions.get(accountId);
  if (session && session.expiresAt <= Date.now()) {
    resetAgentISession(accountId);
    return undefined;
  }
  return session;
}

function getSession(accountId: string): AgentISession {
  if (!accountId || accountId.length > 256) throw new Error("accountId is invalid");
  const existing = existingSession(accountId);
  if (existing) return existing;
  const timer = setTimeout(() => resetAgentISession(accountId), SESSION_TTL_MS);
  timer.unref();
  const session: AgentISession = {
    history: [],
    expiresAt: Date.now() + SESSION_TTL_MS,
    controller: new AbortController(),
    timer,
    yahooCookie: undefined,
    anonymousCookie: undefined,
  };
  sessions.set(accountId, session);
  return session;
}

function assertCurrentSession(accountId: string, session: AgentISession): void {
  if (existingSession(accountId) !== session || session.controller.signal.aborted) {
    throw new Error("Agent I session was cleared");
  }
}

export function getAgentICredentials(accountId: string): AgentICredentials {
  const session = existingSession(accountId);
  return {
    yahooCookieConfigured: Boolean(session?.yahooCookie),
    expiresAt: session?.expiresAt ?? null,
  };
}

export function setAgentIYahooCookie(accountId: string, cookie: string): void {
  const parts = cookie.trim().split(/;\s*/);
  if (
    !cookie.trim() ||
    cookie.length > MAX_YAHOO_COOKIE_LENGTH ||
    /[^\x20-\x7e]/.test(cookie) ||
    parts.some(
      (part) =>
        !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+=[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*$/.test(part),
    )
  ) {
    throw new Error("Yahoo Cookie形式が正しくありません");
  }
  resetAgentISession(accountId);
  getSession(accountId).yahooCookie = cookie.trim();
}

export function clearAgentIYahooCookie(accountId: string): void {
  resetAgentISession(accountId);
}

async function mintAnonymousCookie(signal: AbortSignal): Promise<string> {
  const response = await fetch(AGENT_I_CHAT_URL, {
    headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0 Vyline Agent I" },
    signal,
  });
  if (!response.ok) throw new Error("Agent I の匿名セッションを取得できませんでした");
  const cookies = response.headers.getSetCookie?.() ?? [];
  return cookies
    .map((cookie) => cookie.split(";", 1)[0])
    .filter(Boolean)
    .join("; ");
}

async function getCookie(session: AgentISession, signal: AbortSignal): Promise<string> {
  session.anonymousCookie ??= mintAnonymousCookie(signal).catch((error) => {
    session.anonymousCookie = undefined;
    throw error;
  });
  const cookie = await session.anonymousCookie;
  if (!cookie) {
    session.anonymousCookie = undefined;
    throw new Error("Agent I の匿名セッションを取得できませんでした");
  }
  return cookie;
}

export async function askAgentI(
  accountId: string,
  prompt: string,
  history: AgentIHistoryItem[] = [],
  authMode: AgentIAuthMode = "anonymous",
): Promise<{ text: string; authMode: AgentIAuthMode }> {
  const body = buildAgentIBody(prompt, history);
  const session = getSession(accountId);
  const signal = AbortSignal.any([
    session.controller.signal,
    AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  ]);
  const mode = authMode === "authenticated" && session.yahooCookie ? "authenticated" : "anonymous";
  const cookie = mode === "authenticated" ? session.yahooCookie! : await getCookie(session, signal);
  assertCurrentSession(accountId, session);
  const response = await fetch(AGENT_I_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "text/event-stream",
      "Content-Type": "application/json",
      "Accept-Language": "ja",
      Origin: "https://search.yahoo.co.jp",
      Referer: "https://search.yahoo.co.jp/",
      Cookie: cookie,
      "User-Agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Line/26.7.2/Agenti",
    },
    body: JSON.stringify(body),
    signal,
    redirect: "error",
  });
  assertCurrentSession(accountId, session);
  if (mode === "authenticated" && (response.status === 401 || response.status === 403)) {
    resetAgentISession(accountId);
    throw new AgentIAuthenticationError();
  }
  if (!response.ok) throw new Error(`Agent I API error: HTTP ${response.status}`);
  const text = extractAgentIText(await readBoundedAgentIResponse(response));
  assertCurrentSession(accountId, session);
  if (!text) throw new Error("Agent I が回答を返しませんでした");
  const nextHistory = [
    ...session.history,
    { role: "user" as const, text: body.chats.at(-1)!.contents[0].text },
    { role: "assistant" as const, text },
  ];
  session.history = trimHistory(nextHistory);
  return { text, authMode: mode };
}

export function getAgentIHistory(accountId: string): AgentIHistoryItem[] {
  return existingSession(accountId)?.history.map((item) => ({ ...item })) ?? [];
}

export function resetAgentISession(accountId: string): void {
  const session = sessions.get(accountId);
  if (!session) return;
  clearTimeout(session.timer);
  session.controller.abort();
  session.yahooCookie = undefined;
  session.anonymousCookie = undefined;
  session.history = [];
  sessions.delete(accountId);
}

export const agentILimits = {
  MAX_PROMPT_LENGTH,
  MAX_CONTEXT_ITEMS,
  MAX_CONTEXT_TEXT,
  MAX_RESPONSE_BYTES,
  MAX_YAHOO_COOKIE_LENGTH,
  SESSION_TTL_MS,
} as const;
