import type { CallSessionInfo } from "@vyline/types";
import type { ActiveCall, CallUiState } from "./callAllowlist";

export function friendlyCallError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error ?? "call failed");
  if (msg === "BACKEND_DOWN") return "バックエンドに接続できません";
  if (msg.includes("PLANET reply timeout")) return "応答がありませんでした";
  if (msg.includes("SIP")) return `通話サーバー応答エラー: ${msg}`;
  return msg;
}

export function mapCallState(state: string): CallUiState {
  if (
    state === "idle" ||
    state === "acquiring" ||
    state === "connecting" ||
    state === "ringing" ||
    state === "in-call" ||
    state === "ending" ||
    state === "ended" ||
    state === "failed"
  ) {
    return state;
  }
  return "failed";
}

export function activeCallFromSession(session: CallSessionInfo): ActiveCall {
  return {
    sessionId: session.sessionId,
    to: session.to,
    kind: session.kind === "VIDEO" ? "video" : "voice",
    state: mapCallState(session.state),
    transport: session.transport,
    ...(session.error ? { error: friendlyCallError(session.error) } : {}),
  };
}

export function pickRecoverableCall(sessions: CallSessionInfo[]): CallSessionInfo | null {
  return sessions.find((session) => session.state !== "ended" && session.state !== "failed") ?? null;
}
