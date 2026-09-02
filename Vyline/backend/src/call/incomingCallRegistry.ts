import type { VylineClient } from "@vyline/protocol";

type CallRoute = Awaited<ReturnType<VylineClient["call"]["acquireRoute"]>>;

export type IncomingCallKind = "audio" | "video";

export interface IncomingCallInfo {
  callMid: string;
  chatMid: string;
  callerMid: string;
  callType: IncomingCallKind;
  route?: CallRoute;
}

type IncomingOperation = {
  param1?: string;
  param2?: string;
  param3?: string;
};

type PendingIncomingCall = {
  call: IncomingCallInfo;
  expiresAt: number;
};

export const INCOMING_CALL_TTL_MS = 2 * 60_000;

const pendingByAccount = new Map<string, Map<string, PendingIncomingCall>>();

function isDirectMid(value: string): boolean {
  return value.startsWith("u");
}

function parseRouteJson(raw: string, callerMid: string): CallRoute | undefined {
  if (!raw.trim().startsWith("{")) return undefined;
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return undefined;
  }

  const string = (key: string): string =>
    typeof value[key] === "string" ? String(value[key]) : "";
  const number = (key: string): number => {
    const parsed = Number(value[key]);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const boolean = (key: string): boolean => {
    const field = value[key];
    return field === true || field === 1 || field === "1" || field === "true";
  };
  const capabilities = (() => {
    const field = value.caps;
    if (Array.isArray(field)) return field.filter((item): item is string => typeof item === "string");
    if (typeof field !== "string" || !field) return [];
    try {
      const parsed = JSON.parse(field) as unknown;
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string")
        : [];
    } catch {
      return [];
    }
  })();

  const voipAddress = string("h");
  const fromToken = string("n");
  const voipUdpPort = number("p");
  if (!voipAddress || !fromToken || voipUdpPort <= 0) return undefined;

  const commParam = string("vc");
  let planet = false;
  try {
    planet = Boolean((JSON.parse(commParam || "{}") as { mpkey?: unknown }).mpkey);
  } catch {
    // Malformed/legacy commParam is handled by the Andromeda transport.
  }

  return {
    fromToken,
    callFlowType: planet ? 2 : 1,
    voipAddress,
    voipUdpPort,
    voipTcpPort: number("vp"),
    fromZone: string("vfz"),
    toZone: string("vtz"),
    fakeCall: false,
    ringbackTone: "",
    toMid: callerMid,
    tunneling: string("vt"),
    commParam,
    stid: string("vs"),
    encFromMid: "",
    encToMid: "",
    switchableToVideo: boolean("stv"),
    voipAddress6: string("hv6"),
    w2pGw: "",
    drCall: false,
    stnpk: string("stnpk"),
    capabilities,
  };
}

function pruneExpired(
  accountId: string,
  pending: Map<string, PendingIncomingCall>,
  now: number,
): void {
  for (const [callMid, entry] of pending) {
    if (entry.expiresAt <= now) pending.delete(callMid);
  }
  if (pending.size === 0) pendingByAccount.delete(accountId);
}

export function normalizeIncomingCall(op: IncomingOperation): IncomingCallInfo | null {
  const callMid = String(op.param1 ?? "").trim();
  const param2 = String(op.param2 ?? "").trim();
  const param3 = String(op.param3 ?? "");
  const callerMid = isDirectMid(param2) ? param2 : isDirectMid(callMid) ? callMid : "";
  if (!callMid || !callerMid) return null;
  const route = parseRouteJson(param3, callerMid);
  let routeKind = "";
  if (route) {
    try {
      routeKind = String((JSON.parse(param3) as { k?: unknown }).k ?? "");
    } catch {
      // parseRouteJson already validated this JSON; defensive only.
    }
  }
  return {
    callMid,
    chatMid: callerMid,
    callerMid,
    callType: routeKind === "CV" || /video/i.test(param3) ? "video" : "audio",
    ...(route ? { route } : {}),
  };
}

export function rememberIncomingCall(
  accountId: string,
  call: IncomingCallInfo,
  now = Date.now(),
): void {
  const pending = pendingByAccount.get(accountId) ?? new Map<string, PendingIncomingCall>();
  pruneExpired(accountId, pending, now);
  // One account can only present one incoming-call banner at a time. A fresh
  // ring supersedes an older operation even if LINE's terminal event was lost.
  pending.clear();
  pending.set(call.callMid, { call, expiresAt: now + INCOMING_CALL_TTL_MS });
  pendingByAccount.set(accountId, pending);
}

export function findIncomingCall(
  accountId: string,
  callMid: string,
  now = Date.now(),
): IncomingCallInfo | null {
  const pending = pendingByAccount.get(accountId);
  if (!pending) return null;
  pruneExpired(accountId, pending, now);
  return pending.get(callMid)?.call ?? null;
}

export function finishIncomingCall(
  accountId: string,
  callMid: string,
  now = Date.now(),
): IncomingCallInfo | null {
  const pending = pendingByAccount.get(accountId);
  if (!pending) return null;
  pruneExpired(accountId, pending, now);
  const call = pending.get(callMid)?.call ?? null;
  if (!call) return null;
  pending.delete(callMid);
  if (pending.size === 0) pendingByAccount.delete(accountId);
  return call;
}

export function clearIncomingCalls(accountId: string): void {
  pendingByAccount.delete(accountId);
}
