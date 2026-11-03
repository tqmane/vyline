import { captureBackendFetch, type AgentIHistoryItem } from "./client";

export type AgentIAuthMode = "anonymous" | "authenticated";
export type AgentICredentials = { yahooCookieConfigured: boolean; expiresAt: number | null };

/** Capture the original account transport so cleanup cannot use the next account's session. */
export function agentIClient(accountId: string) {
  const fetch = captureBackendFetch();
  const base = `/beta/agent-i/${encodeURIComponent(accountId)}`;
  async function request<T>(
    path: string,
    method = "GET",
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(base + path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
        keepalive: method === "DELETE",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(35_000)])
          : AbortSignal.timeout(35_000),
      });
    } catch {
      throw new Error("Agent Iに接続できませんでした");
    }
    const data = await response.json().catch(() => null);
    if (!response.ok || data?.ok !== true) {
      // Never display a proxy/transport error that might echo the Cookie request body.
      throw new Error(
        response.status === 401
          ? "認証が無効または期限切れです。Yahoo Cookieと端末のログイン状態を確認してください"
          : response.status === 400
            ? "同意とYahoo Cookieの形式を確認してください"
            : "Agent Iの処理に失敗しました",
      );
    }
    return data;
  }
  return {
    credentials: () => request<AgentICredentials>("/credentials"),
    setCredentials: (yahooCookie: string) =>
      request<AgentICredentials>("/credentials", "PUT", { yahooCookie, consent: true }),
    clearCredentials: () => request("/credentials", "DELETE"),
    resetSession: () => request("/session", "DELETE"),
    history: () => request<{ history: AgentIHistoryItem[] }>("/history"),
    chat: (
      prompt: string,
      history: AgentIHistoryItem[] = [],
      authMode: AgentIAuthMode = "anonymous",
      signal?: AbortSignal,
    ) =>
      request<{ text: string; authMode: AgentIAuthMode }>(
        "/chat",
        "POST",
        { prompt, history, authMode },
        signal,
      ),
  };
}
