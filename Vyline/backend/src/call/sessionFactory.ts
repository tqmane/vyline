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
import { CallNotAllowedError, isGroupCallTarget } from "./allowlist.js";

const log = childLogger("call:factory");

/** Planet event sampling; never include the recipient MID in diagnostic logs. */
const WIRE_LOG_TYPES = new Set([
  "rel_req",
  "rel_remote_end",
  "conn_req",
  "conn_rsp_duplicate",
  "keepalive_scheduled",
  "keepalive_disabled",
  "nonce_changed",
  "media_configured",
  "media_key_selected",
  "video_local_state",
  "video_remote_state",
]);
const WIRE_SAMPLE_TYPES = new Set([
  "media_recv",
  "media_send",
  "decrypt_fail",
  "recv_ignored",
  "media_decrypt_fail",
  "media_ignored",
  "video_recv",
  "video_send",
  "video_ignored",
]);

function wireDebug(direction: "in" | "out" | "group"): (event: Record<string, unknown>) => void {
  const sampleCounts: Record<string, number> = {};
  return (event) => {
    const type = String(event.type ?? "");
    if (WIRE_SAMPLE_TYPES.has(type)) {
      const sampleIndex = (sampleCounts[type] ?? 0) + 1;
      sampleCounts[type] = sampleIndex;
      if (sampleIndex === 1 || sampleIndex === 10 || sampleIndex % 100 === 0) {
        const reason = typeof event.reason === "string" ? event.reason.slice(0, 80) : undefined;
        log.info(
          {
            direction,
            type,
            sampleIndex,
            ...(typeof event.bytes === "number" ? { bytes: event.bytes } : {}),
            ...(typeof event.packets === "number" ? { packets: event.packets } : {}),
            ...(typeof event.key === "boolean" ? { key: event.key } : {}),
            ...(typeof event.media === "string" ? { media: event.media } : {}),
            ...(typeof event.payloadType === "number" ? { payloadType: event.payloadType } : {}),
            ...(typeof event.rtpPayloadType === "number"
              ? { rtpPayloadType: event.rtpPayloadType }
              : {}),
            ...(typeof event.rtpSecondByte === "number" ? { rtpSecondByte: event.rtpSecondByte } : {}),
            ...(typeof event.expectedPayloadType === "number"
              ? { expectedPayloadType: event.expectedPayloadType }
              : {}),
            ...(typeof event.ssrc === "number" ? { ssrc: event.ssrc } : {}),
            ...(typeof event.frames === "number" ? { frames: event.frames } : {}),
            ...(typeof event.samples === "number" ? { samples: event.samples } : {}),
            ...(reason ? { reason } : {}),
          },
          "call media sample",
        );
      }
      return;
    }
    if (!WIRE_LOG_TYPES.has(type)) return;
    log.info(
      {
        direction,
        type,
        ...(typeof event.media === "string" ? { media: event.media } : {}),
        ...(typeof event.mode === "string" ? { mode: event.mode } : {}),
        ...(typeof event.family === "string" ? { family: event.family } : {}),
        ...(typeof event.enabled === "boolean" ? { enabled: event.enabled } : {}),
        ...(typeof event.operation === "number" ? { operation: event.operation } : {}),
        ...(typeof event.port === "number" ? { port: event.port } : {}),
        ...(typeof event.rtpPort === "number" ? { rtpPort: event.rtpPort } : {}),
        ...(typeof event.rtcpId === "number" ? { rtcpId: event.rtcpId } : {}),
        ...(typeof event.payloadType === "number" ? { payloadType: event.payloadType } : {}),
        ...(typeof event.rtpPayloadType === "number" ? { rtpPayloadType: event.rtpPayloadType } : {}),
        ...(typeof event.rtpSecondByte === "number" ? { rtpSecondByte: event.rtpSecondByte } : {}),
        ...(typeof event.ssrc === "number" ? { ssrc: event.ssrc } : {}),
        ...(typeof event.groupDataSsrc === "number" ? { groupDataSsrc: event.groupDataSsrc } : {}),
        ...(typeof event.mediaKeyMode === "string" ? { mediaKeyMode: event.mediaKeyMode } : {}),
        ...(typeof event.activeMediaKeyMode === "string"
          ? { activeMediaKeyMode: event.activeMediaKeyMode }
          : {}),
        ...(typeof event.reason === "string" ? { reason: event.reason.slice(0, 80) } : {}),
      },
      "call wire event",
    );
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
    debug: wireDebug("out"),
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
    debug: wireDebug("in"),
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

async function withCallTimeout<T>(request: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Group call route timeout")), 10_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Never use the cached badge lookup: its offline fallback cannot decide room creation. */
export async function acquireManagedGroupRoute(
  client: VylineClient,
  chatMid: string,
  kind: "AUDIO" | "VIDEO",
  joinOnly = false,
) {
  if (!isGroupCallTarget(chatMid)) throw new Error("Invalid group call target");
  const status = await withCallTimeout(client.call.getGroupCall(chatMid));
  if (
    !status ||
    typeof status.online !== "boolean" ||
    (status.chatMid && status.chatMid !== chatMid)
  )
    throw new Error("Invalid group call status");
  if (joinOnly && !status.online) throw new CallNotAllowedError("グループ通話は終了しています");
  return withCallTimeout(
    client.call.acquireGroupRoute({
      chatMid,
      mediaType: kind,
      isInitialHost: !status.online,
      capabilities: [],
    }),
  );
}

export async function createGroupCallSession(
  client: VylineClient,
  opts: {
    to: string;
    kind?: "AUDIO" | "VIDEO";
    desktopProfile?: DesktopProfile;
    joinOnly?: boolean;
  },
) {
  const kind = opts.kind ?? "AUDIO";
  const route = await acquireManagedGroupRoute(client, opts.to, kind, opts.joinOnly);
  const { transport, ctx } = pickCallTransportForClient(client, route, {
    ...(opts.desktopProfile ? { desktopProfile: opts.desktopProfile } : {}),
    debug: wireDebug("group"),
  });
  if (ctx.transportKind !== "planet") throw new Error("Unsupported group call transport");
  client.call.setCodecFactory(await opusCodecFactory());
  const session = client.call.startSession({ to: opts.to, kind, transport, group: { route } });
  return { session, route, transportKind: ctx.transportKind, wire: ctx };
}
