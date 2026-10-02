/**
 * アクティブ通話セッション管理 + WebSocket PCM ブリッジ
 */

import type { ServerWebSocket } from "bun";
import type { CallSession, CallSessionState } from "@vyline/protocol/stack/call";
import type { PcmFrame } from "@vyline/protocol/stack/call";
import { bufferSource, type AudioSource, validateVp8 } from "@vyline/protocol/stack/call";
import {
  decodeCallVideoFrame,
  encodeCallVideoFrame,
  type CallVideoFrame,
  type CallVideoState,
  type CallParticipant,
} from "@vyline/types";
import {
  createDirectCallSession,
  createGroupCallSession,
  createIncomingDirectCallSession,
} from "./sessionFactory.js";
import type { VylineClient } from "@vyline/protocol";
import { randomUUID } from "node:crypto";
import { childLogger } from "../logger.js";
import type { DesktopProfile } from "@vyline/protocol";
import { pushTalkEvent } from "../line/talkEventBuffer.js";
import { clearIncomingCalls } from "./incomingCallRegistry.js";
import { callConflict } from "./allowlist.js";

const log = childLogger("call:manager");
const MAX_PCM_FRAME_BYTES = 64 * 1024;
const MAX_MIC_QUEUE_FRAMES = 100;
const MAX_WS_CLIENTS_PER_CALL = 8;
const CALL_CLIENT_ERROR = "call operation failed";

export interface CallSessionSnapshot {
  sessionId: string;
  accountId: string;
  to: string;
  kind: "AUDIO" | "VIDEO";
  state: CallSessionState;
  transport: "planet" | "andromeda" | "unknown";
  startedAt: number;
  error?: string;
  video?: CallVideoState;
  participants?: CallParticipant[];
}

interface ManagedCall {
  sessionId: string;
  accountId: string;
  to: string;
  kind: "AUDIO" | "VIDEO";
  session: CallSession;
  state: CallSessionState;
  transport: "planet" | "andromeda" | "unknown";
  startedAt: number;
  error?: string;
  wsClients: Set<ServerWebSocket<CallWsData>>;
  micQueue: PcmFrame[];
  micWaiters: Array<(f: PcmFrame | null) => void>;
  micClosed: boolean;
  sendTask?: Promise<void>;
  recvTask?: Promise<void>;
  startTask?: Promise<void>;
  endTask?: Promise<void>;
  /** 上り（ブラウザマイク→相手）・下り（相手→ブラウザ）のメディア実績。声不通の切り分け用。 */
  micFrames: number;
  micNonZeroFrames: number;
  remoteFrames: number;
  remoteSamples: number;
  audioWsOpens: number;
  audioWsCloses: number;
  micWsFramesReceived: number;
  micWsBytesReceived: number;
  audioWsFramesSent: number;
  audioWsSendFailures: number;
  audioWsBackpressureEvents: number;
  audioWsMaxBufferedBytes: number;
  videoWsOpens: number;
  videoWsCloses: number;
  videoBrowserFramesReceived: number;
  videoBrowserQueueDrops: number;
  videoKeyframeRequests: number;
  videoControlRequests: number;
  videoControlSuccesses: number;
  videoControlFailures: number;
  videoPlanetSendAttempts: number;
  videoPlanetSendSuccesses: number;
  videoPlanetSendFailures: number;
  videoWsFramesSent: number;
  videoWsBackpressureDrops: number;
  videoWsKeyframeWaitDrops: number;
  videoWsMaxBufferedBytes: number;
  videoClientNeedsKey: Set<string>;
  videoClients: Set<ServerWebSocket<CallWsData>>;
  videoQueue: CallVideoFrame[];
  videoSendTask?: Promise<void> | undefined;
  videoControlTask?: Promise<void> | undefined;
  videoNeedsKey: boolean;
}

export interface CallWsData {
  accountId: string;
  sessionId: string;
  media?: "video";
}

const sessions = new Map<string, ManagedCall>();
const byAccount = new Map<string, Set<string>>();
const acquiringAccounts = new Set<string>();

function reserveCallAccount(accountId: string): () => void {
  if (acquiringAccounts.has(accountId)) throw callConflict("通話の接続処理中です");
  for (const id of byAccount.get(accountId) ?? []) {
    const call = sessions.get(id);
    if (!call) continue;
    if (call.session.state === "ended" || call.session.state === "failed") cleanupCall(id);
    else throw callConflict("すでに通話中です");
  }
  acquiringAccounts.add(accountId);
  return () => {
    acquiringAccounts.delete(accountId);
  };
}

function micSource(call: ManagedCall): AudioSource {
  return {
    async *frames(opts?: { signal?: AbortSignal }) {
      const signal = opts?.signal;
      while (!signal?.aborted && !call.micClosed) {
        const frame = await new Promise<PcmFrame | null>((resolve) => {
          if (call.micQueue.length > 0) {
            resolve(call.micQueue.shift()!);
            return;
          }
          call.micWaiters.push(resolve);
        });
        if (!frame) break;
        yield frame;
      }
    },
  };
}

function pushMic(call: ManagedCall, frame: PcmFrame) {
  const waiter = call.micWaiters.shift();
  if (waiter) waiter(frame);
  else {
    if (call.micQueue.length >= MAX_MIC_QUEUE_FRAMES) call.micQueue.shift();
    call.micQueue.push(frame);
  }
}

function broadcastState(call: ManagedCall) {
  const participants = callParticipants(call);
  if (participants) {
    const activeVideoSources = new Set(
      participants.filter((participant) => participant.hasVideoStream).map((participant) => participant.mid),
    );
    for (const source of call.videoClientNeedsKey) {
      if (source && !activeVideoSources.has(source)) call.videoClientNeedsKey.delete(source);
    }
  }
  const msg = JSON.stringify({
    type: "state",
    state: call.session.state,
    sessionId: call.sessionId,
    transport: call.transport,
    error: call.error,
    video: call.session.videoState,
    participants,
  });
  for (const ws of [...call.wsClients, ...call.videoClients]) {
    try {
      ws.send(msg);
    } catch {
      /* */
    }
  }
}

function broadcastPcm(call: ManagedCall, pcm: ArrayBuffer) {
  for (const ws of call.wsClients) {
    try {
      const buffered = ws.getBufferedAmount();
      call.audioWsMaxBufferedBytes = Math.max(call.audioWsMaxBufferedBytes, buffered);
      if (buffered >= 1024 * 1024) {
        call.audioWsBackpressureEvents++;
        if (call.audioWsBackpressureEvents === 1 || call.audioWsBackpressureEvents % 100 === 0) {
          log.warn(
            { media: "audio", bufferedBytes: buffered, sampleIndex: call.audioWsBackpressureEvents },
            "call media backpressure sample",
          );
        }
      }
      ws.send(pcm);
      call.audioWsFramesSent++;
    } catch {
      call.audioWsSendFailures++;
      /* */
    }
  }
}

function attachSessionEvents(call: ManagedCall) {
  call.session.on("video", () => broadcastState(call));
  call.session.on("participants", () => broadcastState(call));
  call.session.on("state", (s) => {
    call.state = s;
    broadcastState(call);
  });
  call.session.on("ended", (reason) => {
    const durationSec = Math.round((Date.now() - call.startedAt) / 1000);
    log.info(
      {
        sessionId: call.sessionId,
        reason,
        durationSec,
        micFrames: call.micFrames,
        micNonZeroFrames: call.micNonZeroFrames,
        remoteFrames: call.remoteFrames,
        remoteSamples: call.remoteSamples,
        audioWsOpens: call.audioWsOpens,
        audioWsCloses: call.audioWsCloses,
        micWsFramesReceived: call.micWsFramesReceived,
        micWsBytesReceived: call.micWsBytesReceived,
        audioWsFramesSent: call.audioWsFramesSent,
        audioWsSendFailures: call.audioWsSendFailures,
        audioWsBackpressureEvents: call.audioWsBackpressureEvents,
        audioWsMaxBufferedBytes: call.audioWsMaxBufferedBytes,
        videoWsOpens: call.videoWsOpens,
        videoWsCloses: call.videoWsCloses,
        videoBrowserFramesReceived: call.videoBrowserFramesReceived,
        videoBrowserQueueDrops: call.videoBrowserQueueDrops,
        videoKeyframeRequests: call.videoKeyframeRequests,
        videoControlRequests: call.videoControlRequests,
        videoControlSuccesses: call.videoControlSuccesses,
        videoControlFailures: call.videoControlFailures,
        videoPlanetSendAttempts: call.videoPlanetSendAttempts,
        videoPlanetSendSuccesses: call.videoPlanetSendSuccesses,
        videoPlanetSendFailures: call.videoPlanetSendFailures,
        videoWsFramesSent: call.videoWsFramesSent,
        videoWsBackpressureDrops: call.videoWsBackpressureDrops,
        videoWsKeyframeWaitDrops: call.videoWsKeyframeWaitDrops,
        videoWsMaxBufferedBytes: call.videoWsMaxBufferedBytes,
      },
      "call ended",
    );
    // 終了状態を WS へ通知してから掃除する（相手側切断でも UI が「通話中」のまま残らない）。
    broadcastState(call);
    clearIncomingCalls(call.accountId);
    pushTalkEvent(call.accountId, {
      kind: "call:end",
      chatMid: call.to,
      durationSec,
    });
    setTimeout(() => cleanupCall(call.sessionId), 300);
  });
  call.session.on("error", (err) => {
    call.error = CALL_CLIENT_ERROR;
    call.state = call.session.state;
    log.warn({ sessionId: call.sessionId, err }, "call session error");
    broadcastState(call);
  });
}

async function runCallStart(call: ManagedCall): Promise<void> {
  const { sessionId } = call;
  try {
    await call.session.start();
    if (!sessions.has(sessionId)) return;
    call.state = call.session.state;
    if (call.session.state === "in-call") {
      await startMediaLoops(call);
    }
    if (!sessions.has(sessionId)) return;
    broadcastState(call);
    log.info(
      {
        sessionId,
        accountId: call.accountId,
        to: call.to,
        transport: call.transport,
        state: call.state,
      },
      "call session ready",
    );
  } catch (err) {
    if (!sessions.has(sessionId)) return;
    call.state = call.session.state;
    call.error = CALL_CLIENT_ERROR;
    broadcastState(call);
    log.warn({ sessionId, err }, "call start failed");
  }
}

async function startMediaLoops(call: ManagedCall) {
  if (call.session.videoState?.available) {
    void (async () => {
      for await (const frame of call.session.receivedVideo()) {
        const packet = encodeCallVideoFrame(frame);
        for (const ws of call.videoClients) {
          const buffered = ws.getBufferedAmount();
          call.videoWsMaxBufferedBytes = Math.max(call.videoWsMaxBufferedBytes, buffered);
          const source = frame.sourceMid ?? "";
          if (buffered > 1024 * 1024) {
            call.videoClientNeedsKey.add(source);
            call.videoWsBackpressureDrops++;
            if (
              call.videoWsBackpressureDrops === 1 ||
              call.videoWsBackpressureDrops % 100 === 0
            ) {
              log.warn(
                {
                  media: "video",
                  dropIndex: call.videoWsBackpressureDrops,
                  bufferedBytes: buffered,
                },
                "call media backpressure sample",
              );
            }
            continue;
          }
          if (call.videoClientNeedsKey.has(source)) {
            if (!frame.key) {
              call.videoWsKeyframeWaitDrops++;
              continue;
            }
            call.videoClientNeedsKey.delete(source);
          }
          ws.send(packet);
          call.videoWsFramesSent++;
        }
      }
    })().catch(() => {
      for (const ws of call.videoClients)
        ws.send(JSON.stringify({ type: "video-error", error: "映像を受信できませんでした" }));
    });
  }
  const countingMic: AudioSource = {
    async *frames(opts?: { signal?: AbortSignal }) {
      for await (const frame of micSource(call).frames(opts)) {
        call.micFrames++;
        yield frame;
      }
    },
  };
  call.sendTask = call.session.sendStream(countingMic).catch((err) => {
    log.warn({ err, sessionId: call.sessionId }, "sendStream ended");
    // 相手側切断でソケットが閉じられると send も失敗する。in-call のままなら終了させる。
    if (call.session.state === "in-call") {
      void call.session.end("media-error").catch(() => undefined);
    }
  });

  call.recvTask = (async () => {
    for await (const frame of call.session.received()) {
      call.remoteFrames++;
      call.remoteSamples += frame.samples.length;
      const buf = frame.samples.buffer.slice(
        frame.samples.byteOffset,
        frame.samples.byteOffset + frame.samples.byteLength,
      );
      broadcastPcm(call, buf as ArrayBuffer);
    }
    // receive() の正常終了 = トランスポート破棄 = 相手側切断（Planet REL）。
    // in-call のままなら終了させ、ended イベントで UI へ通知する。
    if (call.session.state === "in-call") {
      await call.session.end("remote-ended").catch(() => undefined);
    }
  })().catch((err) => {
    log.warn({ err, sessionId: call.sessionId }, "receive loop ended");
    if (call.session.state === "in-call") {
      void call.session.end("remote-ended").catch(() => undefined);
    }
  });
}

export async function startManagedCall(opts: {
  accountId: string;
  client: VylineClient;
  to: string;
  kind?: "AUDIO" | "VIDEO";
  desktopProfile?: DesktopProfile;
  joinOnly?: boolean;
}): Promise<CallSessionSnapshot> {
  const release = reserveCallAccount(opts.accountId);
  try {
    const kind = opts.kind ?? "AUDIO";

    const createSession = opts.to.startsWith("c")
      ? createGroupCallSession
      : createDirectCallSession;
    const created = await createSession(opts.client, {
      to: opts.to,
      kind,
      ...(opts.joinOnly ? { joinOnly: true } : {}),
      ...(opts.desktopProfile ? { desktopProfile: opts.desktopProfile } : {}),
    });
    const session = created.session;
    const sessionId = randomUUID();
    const transport = created.transportKind;

    const call: ManagedCall = {
      sessionId,
      accountId: opts.accountId,
      to: opts.to,
      kind,
      session,
      state: "idle",
      transport,
      startedAt: Date.now(),
      wsClients: new Set(),
      micQueue: [],
      micWaiters: [],
      micClosed: false,
      micFrames: 0,
      micNonZeroFrames: 0,
      remoteFrames: 0,
      remoteSamples: 0,
      audioWsOpens: 0,
      audioWsCloses: 0,
      micWsFramesReceived: 0,
      micWsBytesReceived: 0,
      audioWsFramesSent: 0,
      audioWsSendFailures: 0,
      audioWsBackpressureEvents: 0,
      audioWsMaxBufferedBytes: 0,
      videoWsOpens: 0,
      videoWsCloses: 0,
      videoBrowserFramesReceived: 0,
      videoBrowserQueueDrops: 0,
      videoKeyframeRequests: 0,
      videoControlRequests: 0,
      videoControlSuccesses: 0,
      videoControlFailures: 0,
      videoPlanetSendAttempts: 0,
      videoPlanetSendSuccesses: 0,
      videoPlanetSendFailures: 0,
      videoWsFramesSent: 0,
      videoWsBackpressureDrops: 0,
      videoWsKeyframeWaitDrops: 0,
      videoWsMaxBufferedBytes: 0,
      videoClientNeedsKey: new Set(),
      videoClients: new Set(),
      videoQueue: [],
      videoNeedsKey: true,
    };

    sessions.set(sessionId, call);
    if (!byAccount.has(opts.accountId)) byAccount.set(opts.accountId, new Set());
    byAccount.get(opts.accountId)!.add(sessionId);

    // Route acquisition and signalling succeeded, so any ringing call for this
    // account is superseded by the call we just placed. Doing this before
    // createSession would silently discard unrelated rings on a failed attempt.
    clearIncomingCalls(opts.accountId);

    attachSessionEvents(call);

    call.startTask = runCallStart(call);
    broadcastState(call);
    log.info(
      {
        sessionId,
        accountId: opts.accountId,
        to: opts.to,
        transport,
        device: created.wire.deviceDetails.device,
      },
      "call session created",
    );

    return snapshot(call);
  } finally {
    release();
  }
}

export async function startManagedIncomingCall(opts: {
  accountId: string;
  client: VylineClient;
  callerMid: string;
  callId: string;
  route: Parameters<typeof createIncomingDirectCallSession>[1]["route"];
  kind?: "AUDIO" | "VIDEO";
  desktopProfile?: DesktopProfile;
}): Promise<CallSessionSnapshot> {
  const release = reserveCallAccount(opts.accountId);
  try {
    const kind = opts.kind ?? "AUDIO";

    // VERIFY 応答が 10s でタイムアウトすることがある（実機で確認）。
    // 1回きりで諦めず、セッションを作り直して再試行する（毎回新しい ephemeral 鍵）。
    const maxAttempts = 3;
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const created = await createIncomingDirectCallSession(opts.client, {
        callerMid: opts.callerMid,
        callId: opts.callId,
        route: opts.route,
        kind,
        ...(opts.desktopProfile ? { desktopProfile: opts.desktopProfile } : {}),
      });
      const sessionId = randomUUID();
      const call: ManagedCall = {
        sessionId,
        accountId: opts.accountId,
        to: opts.callerMid,
        kind,
        session: created.session,
        state: "idle",
        transport: created.transportKind,
        startedAt: Date.now(),
        wsClients: new Set(),
        micQueue: [],
        micWaiters: [],
        micClosed: false,
        micFrames: 0,
        micNonZeroFrames: 0,
        remoteFrames: 0,
        remoteSamples: 0,
        audioWsOpens: 0,
        audioWsCloses: 0,
        micWsFramesReceived: 0,
        micWsBytesReceived: 0,
        audioWsFramesSent: 0,
        audioWsSendFailures: 0,
        audioWsBackpressureEvents: 0,
        audioWsMaxBufferedBytes: 0,
        videoWsOpens: 0,
        videoWsCloses: 0,
        videoBrowserFramesReceived: 0,
        videoBrowserQueueDrops: 0,
        videoKeyframeRequests: 0,
        videoControlRequests: 0,
        videoControlSuccesses: 0,
        videoControlFailures: 0,
        videoPlanetSendAttempts: 0,
        videoPlanetSendSuccesses: 0,
        videoPlanetSendFailures: 0,
        videoWsFramesSent: 0,
        videoWsBackpressureDrops: 0,
        videoWsKeyframeWaitDrops: 0,
        videoWsMaxBufferedBytes: 0,
        videoClientNeedsKey: new Set(),
        videoClients: new Set(),
        videoQueue: [],
        videoNeedsKey: true,
      };

      sessions.set(sessionId, call);
      if (!byAccount.has(opts.accountId)) byAccount.set(opts.accountId, new Set());
      byAccount.get(opts.accountId)!.add(sessionId);
      attachSessionEvents(call);
      call.startTask = runCallStart(call);
      broadcastState(call);

      await call.startTask;
      if (call.session.state === "in-call") return snapshot(call);
      lastError = call.error ? new Error(call.error) : new Error("incoming call signaling failed");
      log.warn(
        { sessionId, accountId: opts.accountId, attempt, maxAttempts, err: lastError },
        "incoming call signaling failed, retrying with a fresh session",
      );
      cleanupCall(sessionId);
    }
    throw lastError ?? new Error("incoming call signaling failed");
  } finally {
    release();
  }
}

export function endManagedCall(sessionId: string, reason = "user-ended"): Promise<void> {
  const call = sessions.get(sessionId);
  if (!call) return Promise.resolve();
  if (call.endTask) return call.endTask;
  call.micClosed = true;
  call.videoQueue = [];
  for (const w of call.micWaiters) w(null);
  call.endTask = (async () => {
    try {
      await call.session.end(reason);
    } catch (err) {
      log.warn({ sessionId, err }, "call end error");
    } finally {
      cleanupCall(sessionId);
    }
  })();
  return call.endTask;
}

function cleanupCall(sessionId: string) {
  const call = sessions.get(sessionId);
  if (!call) return;
  call.micClosed = true;
  for (const w of call.micWaiters) w(null);
  for (const ws of [...call.wsClients, ...call.videoClients]) {
    try {
      ws.close();
    } catch {
      /* */
    }
  }
  sessions.delete(sessionId);
  byAccount.get(call.accountId)?.delete(sessionId);
}

export function getCallSnapshot(sessionId: string): CallSessionSnapshot | null {
  const call = sessions.get(sessionId);
  return call ? snapshot(call) : null;
}

export function listAccountCalls(accountId: string): CallSessionSnapshot[] {
  const ids = byAccount.get(accountId);
  if (!ids) return [];
  return [...ids]
    .map((id) => sessions.get(id))
    .filter(Boolean)
    .map((c) => snapshot(c!));
}

/**
 * End every live call for one account. Logout replaces the client, so a session
 * left behind would hold its transport socket open and keep the per-account
 * reservation occupied ("すでに通話中です") for the next login.
 *
 * The reservation is released synchronously: transport teardown is network-bound,
 * and blocking the next login on it would just move the wedge.
 */
export function endAccountCalls(accountId: string, reason = "account-detached"): Promise<void> {
  const ids = [...(byAccount.get(accountId) ?? [])];
  const reservations = byAccount.get(accountId);
  const pending = ids.map((id) => {
    const call = sessions.get(id);
    if (call) call.micClosed = true;
    reservations?.delete(id);
    return endManagedCall(id, reason);
  });
  return Promise.all(pending).then(() => undefined);
}

/**
 * End the live call that a peer cancel refers to, if any.
 *
 * CANCEL_CALL(51) is the only call-end notification LINE sends (Android 26.13.0
 * OpType table). Without this, a hangup the transport does not surface on its own
 * leaves the ManagedCall in-call and blocks every later call for the account.
 */
export function endAccountCallMatching(
  accountId: string,
  ids: readonly (string | undefined)[],
): Promise<void> {
  const wanted = new Set(ids.filter((value): value is string => typeof value === "string" && value !== ""));
  if (wanted.size === 0) return Promise.resolve();
  const match = listAccountCalls(accountId).find(
    (call) =>
      call.state !== "ended" &&
      call.state !== "failed" &&
      (wanted.has(call.to) || wanted.has(call.sessionId)),
  );
  return match ? endManagedCall(match.sessionId, "remote-cancelled") : Promise.resolve();
}

function callParticipants(call: ManagedCall): CallParticipant[] | undefined {
  return call.session.participants?.map((member) => ({
    mid: member.mid,
    hasAudioStream: member.sources.some((source) => source.name === "A"),
    hasVideoStream: member.sources.some((source) => source.name === "V"),
  }));
}

function snapshot(call: ManagedCall): CallSessionSnapshot {
  const participants = callParticipants(call);
  return {
    sessionId: call.sessionId,
    accountId: call.accountId,
    to: call.to,
    kind: call.kind,
    state: call.session.state,
    transport: call.transport,
    startedAt: call.startedAt,
    video: call.session.videoState,
    ...(participants ? { participants } : {}),
    ...(call.error ? { error: call.error } : {}),
  };
}

export function attachCallWebSocket(ws: ServerWebSocket<CallWsData>) {
  const call = sessions.get(ws.data.sessionId);
  if (!call || call.accountId !== ws.data.accountId) {
    ws.close(4403, "invalid session");
    return;
  }
  const clients = ws.data.media === "video" ? call.videoClients : call.wsClients;
  if (clients.size >= (ws.data.media === "video" ? 1 : MAX_WS_CLIENTS_PER_CALL)) {
    ws.close(4429, "too many call clients");
    return;
  }
  clients.add(ws);
  if (ws.data.media === "video") call.videoWsOpens++;
  else call.audioWsOpens++;
  ws.send(
    JSON.stringify({
      type: "state",
      state: call.session.state,
      sessionId: call.sessionId,
      transport: call.transport,
      error: call.error,
      video: call.session.videoState,
      participants: callParticipants(call),
    }),
  );
}

/** ブラウザからの PCM Int16LE mono @48kHz */
export function ingestCallMicPcm(sessionId: string, data: ArrayBuffer) {
  const call = sessions.get(sessionId);
  if (!call || call.session.state !== "in-call") return;
  if (data.byteLength === 0 || data.byteLength > MAX_PCM_FRAME_BYTES || data.byteLength % 2 !== 0)
    return;
  call.micWsFramesReceived++;
  call.micWsBytesReceived += data.byteLength;
  const samples = new Int16Array(data);
  if (samples.some((sample) => sample !== 0)) call.micNonZeroFrames++;
  pushMic(call, { samples, sampleRate: 48000, channels: 1 });
}

/** テスト用: 440Hz トーンを数秒送る（Desktop 準拠の通話エンコード検証） */
export async function sendTestTone(sessionId: string, durationMs = 2000): Promise<void> {
  const call = sessions.get(sessionId);
  if (!call || call.session.state !== "in-call") throw new Error("not in-call");
  const total = Math.floor((48000 * durationMs) / 1000);
  const samples = new Int16Array(total);
  for (let i = 0; i < total; i++) {
    samples[i] = Math.floor(Math.sin((2 * Math.PI * 440 * i) / 48000) * 8000);
  }
  await call.session.sendStream(bufferSource({ samples, sampleRate: 48000, frameDurationMs: 20 }));
}

export const callWebSocketHandler = {
  open(ws: ServerWebSocket<CallWsData>) {
    attachCallWebSocket(ws);
  },
  message(ws: ServerWebSocket<CallWsData>, message: string | Buffer) {
    const call = sessions.get(ws.data.sessionId);
    const clients = ws.data.media === "video" ? call?.videoClients : call?.wsClients;
    if (!call || call.accountId !== ws.data.accountId || !clients?.has(ws)) return;
    if (typeof message === "string") {
      if (message.length > 1024) return;
      try {
        const j = JSON.parse(message) as { type?: string; enabled?: unknown };
        if (j.type === "ping") ws.send(JSON.stringify({ type: "pong" }));
        if (ws.data.media === "video" && j.type === "video" && typeof j.enabled === "boolean") {
          if (call.videoControlTask) return;
          call.videoControlRequests++;
          call.videoQueue = [];
          call.videoNeedsKey = true;
          call.videoControlTask = call.session
            .setVideoEnabled(j.enabled)
            .then(() => {
              call.videoControlSuccesses++;
              broadcastState(call);
            })
            .catch(() => {
              call.videoControlFailures++;
              ws.send(
                JSON.stringify({
                  type: "video-error",
                  error: "カメラの切り替えに失敗しました。音声通話は継続します",
                }),
              );
            })
            .then(() => {
              call.videoControlTask = undefined;
            });
        }
      } catch {
        /* */
      }
      return;
    }
    if (ws.data.media === "video") {
      if (!call.session.videoState?.localEnabled || call.session.state !== "in-call") return;
      try {
        const frame = decodeCallVideoFrame(new Uint8Array(message));
        if (frame.sourceMid !== undefined) throw new Error("Video source is server-assigned");
        validateVp8(frame.data, frame.key);
        call.videoBrowserFramesReceived++;
        if (call.videoQueue.length >= 2) {
          call.videoBrowserQueueDrops += call.videoQueue.length + (frame.key ? 0 : 1);
          call.videoQueue = [];
          call.videoNeedsKey = true;
          if (!frame.key) {
            call.videoKeyframeRequests++;
            ws.send(JSON.stringify({ type: "video-keyframe" }));
          }
        }
        if (call.videoNeedsKey && !frame.key) return;
        call.videoNeedsKey = false;
        call.videoQueue.push(frame);
        if (!call.videoSendTask) {
          call.videoSendTask = (async () => {
            while (call.videoQueue.length && sessions.get(call.sessionId) === call) {
              const next = call.videoQueue.shift()!;
              call.videoPlanetSendAttempts++;
              try {
                await call.session.sendVideo(next);
                call.videoPlanetSendSuccesses++;
              } catch (error) {
                call.videoPlanetSendFailures++;
                if (
                  call.videoPlanetSendFailures === 1 ||
                  call.videoPlanetSendFailures % 100 === 0
                ) {
                  log.warn(
                    { media: "video", failureIndex: call.videoPlanetSendFailures },
                    "call protocol video send failed",
                  );
                }
                throw error;
              }
            }
          })()
            .catch(() => {
              call.videoQueue = [];
              call.videoNeedsKey = true;
            })
            .finally(() => {
              call.videoSendTask = undefined;
            });
        }
      } catch {
        ws.send(JSON.stringify({ type: "video-error", error: "無効な映像データを破棄しました" }));
      }
      return;
    }
    const buf =
      message instanceof Buffer
        ? message.buffer.slice(message.byteOffset, message.byteOffset + message.byteLength)
        : message;
    ingestCallMicPcm(ws.data.sessionId, buf as ArrayBuffer);
  },
  close(ws: ServerWebSocket<CallWsData>) {
    const call = sessions.get(ws.data.sessionId);
    if (!call || call.accountId !== ws.data.accountId) return;
    if (ws.data.media === "video") {
      if (!call.videoClients.delete(ws)) return;
      call.videoWsCloses++;
      call.videoClientNeedsKey.clear();
      call.videoQueue = [];
      void (call.videoControlTask ?? Promise.resolve())
        .then(async () => {
          if (call.session.state === "in-call" && call.session.videoState?.localEnabled) {
            await call.session.setVideoEnabled(false);
            broadcastState(call);
          }
        })
        .catch(() => undefined);
      return;
    }
    if (!call.wsClients.delete(ws)) return;
    call.audioWsCloses++;
    if (
      call.wsClients.size === 0 &&
      call.session.state !== "ended" &&
      call.session.state !== "failed"
    ) {
      void endManagedCall(call.sessionId, "media-client-disconnected");
    }
  },
};
