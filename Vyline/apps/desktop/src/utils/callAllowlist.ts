/** DM・グループ通話の UI 対応判定（表示名 allowlist は廃止） */
import type { CallParticipant } from "@vyline/types";

export function canDirectCall(chatId: string | undefined | null): boolean {
  return Boolean(chatId?.startsWith("u"));
}

export function canStartCall(chatId: string | undefined | null, kind: "voice" | "video"): boolean {
  return (
    canDirectCall(chatId) ||
    ((kind === "voice" || kind === "video") && /^c[0-9a-f]{32}$/.test(chatId ?? ""))
  );
}

export function directCallHint(): string {
  return "1:1 通話は DM（u*）のみ対応しています";
}

export type CallUiState =
  | "idle"
  | "starting"
  | "acquiring"
  | "connecting"
  | "ringing"
  | "in-call"
  | "ending"
  | "ended"
  | "failed";

export interface ActiveCall {
  sessionId: string;
  to: string;
  kind: "voice" | "video";
  state: CallUiState;
  transport?: "planet" | "andromeda" | "unknown";
  error?: string;
  participants?: CallParticipant[];
}

export function readCallParticipants(value: unknown): CallParticipant[] | undefined {
  if (!Array.isArray(value) || value.length > 512) return;
  const mids = new Set<string>();
  const participants: CallParticipant[] = [];
  for (const member of value) {
    if (
      !member ||
      typeof member !== "object" ||
      typeof member.mid !== "string" ||
      !/^u[0-9a-f]{32}$/.test(member.mid) ||
      mids.has(member.mid) ||
      typeof member.hasAudioStream !== "boolean" ||
      typeof member.hasVideoStream !== "boolean"
    )
      return;
    mids.add(member.mid);
    participants.push({
      mid: member.mid,
      hasAudioStream: member.hasAudioStream,
      hasVideoStream: member.hasVideoStream,
    });
  }
  return participants;
}
