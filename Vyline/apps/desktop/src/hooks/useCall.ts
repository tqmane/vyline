/**
 * useCall — backend 通話セッション + WebSocket PCM ブリッジ
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import type { ActiveCall, CallUiState } from "@/utils/callAllowlist";
import { splitPcm16Frames } from "@/utils/callAudio";

/** HTTP API と同じオリジン・同じ /api プレフィックスを使う（リバースプロキシ経由でも届く） */
function callWsUrl(accountId: string, sessionId: string): string {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${location.host}/api/line/${encodeURIComponent(accountId)}/call/ws?sessionId=${encodeURIComponent(sessionId)}`;
}

const PCM_FRAME_SAMPLES = 960; // 48kHz mono 20ms
const PCM_FRAME_BYTES = PCM_FRAME_SAMPLES * Int16Array.BYTES_PER_ELEMENT;
const REMOTE_PLAYBACK_LEAD_SECONDS = 0.08;

function friendlyCallError(msg: string): string {
  if (msg.includes("PLANET reply timeout")) return "応答がありませんでした";
  if (msg.includes("SIP")) return `通話サーバー応答エラー: ${msg}`;
  return msg;
}

function mapState(s: string): CallUiState {
  if (
    s === "idle" ||
    s === "acquiring" ||
    s === "connecting" ||
    s === "ringing" ||
    s === "in-call" ||
    s === "ending" ||
    s === "ended" ||
    s === "failed"
  ) {
    return s;
  }
  return "failed";
}

export function useCall(accountId: string | null) {
  const [call, setCall] = useState<ActiveCall | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const playbackTimeRef = useRef(0);
  const mutedRef = useRef(false);
  const micRemainderRef = useRef(new Int16Array(0));

  const micStartedRef = useRef(false);

  const cleanupMedia = useCallback(() => {
    micStartedRef.current = false;
    micRemainderRef.current = new Int16Array(0);
    micProcessorRef.current?.disconnect();
    micProcessorRef.current = null;
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
    void audioCtxRef.current?.close();
    audioCtxRef.current = null;
    playbackTimeRef.current = 0;
  }, []);

  const endCall = useCallback(async () => {
    const sessionId = call?.sessionId;
    cleanupMedia();
    if (sessionId) {
      try {
        await api.line.callEnd(accountId!, sessionId);
      } catch {
        /* */
      }
    }
    setCall(null);
  }, [accountId, call?.sessionId, cleanupMedia]);

  const startMicPipeline = useCallback((ws: WebSocket) => {
    if (!navigator.mediaDevices?.getUserMedia) return;
    void (async () => {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      micStreamRef.current = stream;
      const ctx = audioCtxRef.current ?? new AudioContext({ sampleRate: 48000 });
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      // ScriptProcessor sizes are powers of two, so frame at 1024 samples and
      // carry the excess into exact 20 ms / 960-sample Opus frames.
      const processor = ctx.createScriptProcessor(1024, 1, 1);
      micProcessorRef.current = processor;
      processor.onaudioprocess = (ev) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const input = ev.inputBuffer.getChannelData(0);
        const out = new Int16Array(input.length);
        if (!mutedRef.current) {
          for (let i = 0; i < input.length; i++) {
            const s = Math.max(-1, Math.min(1, input[i] ?? 0));
            out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }
        }
        const framed = splitPcm16Frames(out, micRemainderRef.current, PCM_FRAME_SAMPLES);
        micRemainderRef.current = framed.remainder;
        for (const frame of framed.frames) {
          ws.send(frame.buffer);
        }
      };
      source.connect(processor);
      processor.connect(ctx.destination);
    })().catch(() => {
      /* mic optional */
    });
  }, []);

  const playRemotePcm = useCallback((buf: ArrayBuffer) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const samples = new Int16Array(buf);
    const floats = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      floats[i] = (samples[i] ?? 0) / 0x8000;
    }
    const audioBuf = ctx.createBuffer(1, floats.length, 48000);
    audioBuf.copyToChannel(floats, 0);
    const src = ctx.createBufferSource();
    src.buffer = audioBuf;
    src.connect(ctx.destination);
    // Keep a small playout lead so ordinary WebSocket/network jitter does not
    // turn into repeated audio under-runs and crackle.
    const t = Math.max(ctx.currentTime + REMOTE_PLAYBACK_LEAD_SECONDS, playbackTimeRef.current);
    src.start(t);
    playbackTimeRef.current = t + audioBuf.duration;
  }, []);

  const connectWs = useCallback(
    (sessionId: string, accId: string) => {
      const ws = new WebSocket(callWsUrl(accId, sessionId));
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;
      ws.onmessage = (ev) => {
        if (typeof ev.data === "string") {
          try {
            const j = JSON.parse(ev.data) as {
              type?: string;
              state?: string;
              error?: string;
              transport?: string;
            };
            if (j.type === "state" && j.state) {
              const nextState = mapState(j.state);
              const transport =
                j.transport === "planet" || j.transport === "andromeda" || j.transport === "unknown"
                  ? j.transport
                  : undefined;
              setCall((prev) =>
                prev
                  ? {
                      ...prev,
                      state: nextState,
                      ...(transport ? { transport } : {}),
                      ...(j.error ? { error: friendlyCallError(j.error) } : {}),
                    }
                  : prev,
              );
              if (nextState === "in-call" && !micStartedRef.current) {
                micStartedRef.current = true;
                startMicPipeline(ws);
              }
            }
          } catch {
            /* */
          }
          return;
        }
        if (ev.data instanceof ArrayBuffer && ev.data.byteLength >= PCM_FRAME_BYTES / 4) {
          playRemotePcm(ev.data);
        }
      };
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "ping" }));
      };
    },
    [playRemotePcm, startMicPipeline],
  );

  const startCall = useCallback(
    async (to: string, kind: "voice" | "video") => {
      if (!accountId) return { ok: false as const, error: "not logged in" };
      setCall({
        sessionId: "",
        to,
        kind,
        state: "starting",
      });
      const callType = kind === "video" ? "VIDEO" : "AUDIO";
      const res = await api.line.callStart(accountId, to, callType);
      if (!res.ok || !("session" in res) || !res.session) {
        const errMsg = !res.ok && "error" in res ? res.error : "call start failed";
        setCall({
          sessionId: "",
          to,
          kind,
          state: "failed",
          error: errMsg ? friendlyCallError(errMsg) : "call start failed",
        });
        return { ok: false as const, error: errMsg };
      }
      const active: ActiveCall = {
        sessionId: res.session.sessionId,
        to,
        kind,
        state: mapState(res.session.state),
        transport: res.session.transport,
        error: res.session.error ? friendlyCallError(res.session.error) : undefined,
      };
      setCall(active);
      audioCtxRef.current = new AudioContext({ sampleRate: 48000 });
      connectWs(res.session.sessionId, accountId);
      return { ok: true as const, session: res.session };
    },
    [accountId, connectWs],
  );

  const answerCall = useCallback(
    async (callMid: string, callerMid: string, kind: "voice" | "video") => {
      if (!accountId) return { ok: false as const, error: "not logged in" };
      setCall({
        sessionId: "",
        to: callerMid,
        kind,
        state: "starting",
      });
      let res: Awaited<ReturnType<typeof api.line.callAnswer>>;
      try {
        res = await api.line.callAnswer(accountId, callMid);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : "call answer failed";
        setCall(null);
        return { ok: false as const, error: errMsg };
      }
      if (!res.ok || !("session" in res) || !res.session) {
        const errMsg = !res.ok && "error" in res ? res.error : "call answer failed";
        setCall(null);
        return { ok: false as const, error: errMsg };
      }
      const active: ActiveCall = {
        sessionId: res.session.sessionId,
        to: callerMid,
        kind,
        state: mapState(res.session.state),
        transport: res.session.transport,
        error: res.session.error ? friendlyCallError(res.session.error) : undefined,
      };
      setCall(active);
      audioCtxRef.current = new AudioContext({ sampleRate: 48000 });
      connectWs(res.session.sessionId, accountId);
      return { ok: true as const, session: res.session };
    },
    [accountId, connectWs],
  );

  const setMuted = useCallback((muted: boolean) => {
    mutedRef.current = muted;
  }, []);

  useEffect(() => () => cleanupMedia(), [cleanupMedia]);

  return { call, startCall, answerCall, endCall, setMuted, isInCall: call?.state === "in-call" };
}
