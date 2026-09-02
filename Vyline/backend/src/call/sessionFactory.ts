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
  toAndromedaCallRoute,
  type CallType,
  type IncomingCallRoutePayload,
} from "@vyline/protocol/stack/call";
import type { CallSession } from "@vyline/protocol/stack/call";
import { childLogger } from "../logger.js";

const log = childLogger("call:factory");

export interface DirectCallOpts {
  to: string;
  kind?: CallType;
  fromEnvInfo?: Record<string, string>;
  desktopProfile?: DesktopProfile;
}

export interface IncomingDirectCallOpts {
  chatId: string;
  route: IncomingCallRoutePayload;
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

/**
 * Build an incoming session from the rich VoIP push route. Unlike the outgoing
 * path this never calls acquireCallRoute. Only Andromeda is enabled until a
 * native PLANET incoming handshake is verified.
 */
export async function createIncomingDirectCallSession(
  client: VylineClient,
  opts: IncomingDirectCallOpts,
): Promise<DirectCallSessionResult> {
  const route = toAndromedaCallRoute(opts.route);
  const transportKind = describeCallRoute(route);
  if (transportKind !== "andromeda") {
    throw new Error("incoming call transport is not supported");
  }

  const { transport, ctx } = pickCallTransportForClient(client, route, {
    ...(opts.desktopProfile ? { desktopProfile: opts.desktopProfile } : {}),
  });
  if (ctx.transportKind !== "andromeda") {
    throw new Error("incoming call transport is not Andromeda");
  }

  const codecs = await opusCodecFactory();
  client.call.setCodecFactory(codecs);
  const session = client.call.startSession({
    to: opts.chatId,
    kind: opts.route.callType,
    transport,
    preacquiredRoute: route,
  });

  log.info(
    {
      chatId: opts.chatId,
      kind: opts.route.callType,
      transport: ctx.transportKind,
      device: ctx.deviceDetails.device,
      voip: opts.route.address,
      port: opts.route.udpPort,
    },
    "incoming call session prepared",
  );

  return { session, route, transportKind, wire: ctx };
}
