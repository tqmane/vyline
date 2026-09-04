/**
 * 1:1 CallSession 生成 — Desktop 通話コンテキスト + Planet/Andromeda
 */

import type { DesktopProfile, VylineClient } from "@vyline/protocol";
import {
  pickCallTransportForClient,
  describeCallRoute,
  type CallWireContext,
} from "@vyline/protocol";
import {
  defaultCallFromEnvInfo,
  opusCodecFactory,
  type CallType,
} from "@vyline/protocol/stack/call";
import type { CallSession } from "@vyline/protocol/stack/call";
import { childLogger } from "../logger.js";

const log = childLogger("call:factory");

/**
 * Planet トランスポートの低頻度イベントだけをログに出す（RTP/メディア系は除外）。
 * REL 切断の relCode/releaser 等を通話切断の原因特定に使う。
 */
const WIRE_LOG_TYPES = new Set([
  "rel_req",
  "rel_remote_end",
  "decrypt_fail",
  "recv_ignored",
  "conn_req",
  "conn_rsp_duplicate",
  "keepalive_scheduled",
  "keepalive_disabled",
  "nonce_changed",
]);

function wireDebug(tag: string): (event: Record<string, unknown>) => void {
  return (event) => {
    if (!WIRE_LOG_TYPES.has(String(event.type ?? ""))) return;
    log.info({ tag, ...event }, "call wire event");
  };
}

export interface DirectCallOpts {
  to: string;
  kind?: CallType;
  fromEnvInfo?: Record<string, string>;
  desktopProfile?: DesktopProfile;
}

export interface IncomingDirectCallOpts {
  callerMid: string;
  callId: string;
  route: AcquiredRoute;
  kind?: CallType;
  desktopProfile?: DesktopProfile;
}

type AcquiredRoute = Awaited<ReturnType<VylineClient["call"]["acquireRoute"]>>;

export interface DirectCallSessionResult {
  session: CallSession;
  route: AcquiredRoute;
  transportKind: "planet" | "andromeda";
  wire: CallWireContext;
}

export async function createDirectCallSession(
  client: VylineClient,
  opts: DirectCallOpts,
): Promise<DirectCallSessionResult> {
  const kind = opts.kind ?? "AUDIO";
  const fromEnvInfo = opts.fromEnvInfo ?? defaultCallFromEnvInfo(client.base.deviceDetails);

  const route = await client.call.acquireRoute({
    to: opts.to,
    callType: kind,
    fromEnvInfo,
  });

  const { transport, ctx } = pickCallTransportForClient(client, route, {
    ...(opts.desktopProfile ? { desktopProfile: opts.desktopProfile } : {}),
    debug: wireDebug(`out:${opts.to}`),
  });

  log.info(
    {
      to: opts.to,
      kind,
      transport: ctx.transportKind,
      device: ctx.deviceDetails.device,
      devname: fromEnvInfo.devname,
      planetOs: ctx.planetUserAgent.osName,
      planetRelease: ctx.planetUserAgent.appReleaseInfo,
      voip: route.voipAddress,
      port: route.voipUdpPort,
      fakeCall: route.fakeCall,
    },
    "call route acquired",
  );

  const codecs = await opusCodecFactory();
  client.call.setCodecFactory(codecs);

  const session = client.call.startSession({
    to: opts.to,
    kind,
    transport,
    preacquiredRoute: route,
    fromEnvInfo,
  });

  return {
    session,
    route,
    transportKind: describeCallRoute(route),
    wire: ctx,
  };
}

export async function createIncomingDirectCallSession(
  client: VylineClient,
  opts: IncomingDirectCallOpts,
): Promise<DirectCallSessionResult> {
  const kind = opts.kind ?? "AUDIO";
  const route = opts.route;
  const { transport, ctx } = pickCallTransportForClient(client, route, {
    ...(opts.desktopProfile ? { desktopProfile: opts.desktopProfile } : {}),
    callId: opts.callId,
    debug: wireDebug(`in:${opts.callerMid}`),
  });

  const codecs = await opusCodecFactory();
  client.call.setCodecFactory(codecs);

  const session = client.call.startSession({
    to: opts.callerMid,
    kind,
    direction: "incoming",
    transport,
    preacquiredRoute: route,
  });

  log.info(
    {
      callerMid: opts.callerMid,
      callId: opts.callId,
      kind,
      transport: ctx.transportKind,
      voip: route.voipAddress,
      port: route.voipUdpPort,
    },
    "incoming call session prepared",
  );

  return {
    session,
    route,
    transportKind: describeCallRoute(route),
    wire: ctx,
  };
}
