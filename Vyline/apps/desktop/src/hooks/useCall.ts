/**
 * useCall — backend 通話セッション + WebSocket PCM ブリッジ
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import { useStore } from "@/lib/store";
import type { ActiveCall, CallUiState } from "@/utils/callAllowlist";
import {
  shouldRestartMicTrack,
  splitPcm16Frames,
  resampleLinearPcm16,
  AudioJitterBuffer,
  ensureRunningAudioContext,
} from "@/utils/callAudio";

/** HTTP API と同じオリジン・同じ /api プレフィックスを使う（リバースプロキシ経由でも届く） */
function callWsUrl(accountId: string, sessionId: string): string {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${location.host}/api/line/${encodeURIComponent(accountId)}/call/ws?sessionId=${encodeURIComponent(sessionId)}`;
}

const PCM_FRAME_SAMPLES = 960; // 48kHz mono 20ms
const PCM_FRAME_BYTES = PCM_FRAME_SAMPLES * Int16Array.BYTES_PER_ELEMENT;

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
  const jitterBufferRef = useRef<AudioJitterBuffer | null>(null);
  const playbackNodeRef = useRef<ScriptProcessorNode | null>(null);
  const mutedRef = useRef(false);
  const micRemainderRef = useRef(new Int16Array(0));
  const micAttemptRef = useRef(0);
  const micRestartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const micStartedRef = useRef(false);

  const ensureAudioContext = useCallback(() => {
    const context = ensureRunningAudioContext(
      audioCtxRef.current,
      () => new AudioContext({ sampleRate: 48000 }),
    );
    audioCtxRef.current = context;
    return context;
  }, []);

  const cleanupMedia = useCallback(() => {
    micAttemptRef.current++;
    micStartedRef.current = false;
    micRemainderRef.current = new Int16Array(0);
    if (micRestartTimerRef.current) {
      clearTimeout(micRestartTimerRef.current);
      micRestartTimerRef.current = null;
    }
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
    micProcessorRef.current?.disconnect();
    micProcessorRef.current = null;
    playbackNodeRef.current?.disconnect();
    playbackNodeRef.current = null;
    jitterBufferRef.current?.clear();
    jitterBufferRef.current = null;
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
    void audioCtxRef.current?.close();
    audioCtxRef.current = null;
  }, []);

  const endCall = useCallback(async () => {
    const sessionId = call?.sessionId;
    cleanupMedia();
    useStore.getState().dismissIncomingCall();
    if (sessionId) {
      try {
        await api.line.callEnd(accountId!, sessionId);
      } catch {
        /* */
      }
    }
    setCall(null);
  }, [accountId, call?.sessionId, cleanupMedia]);

  const startMicPipeline = useCallback(
    (ws: WebSocket) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCall((prev) => (prev ? { ...prev, error: "マイクを使用できません" } : prev));
        return;
      }

      const acquire = async (retry: boolean): Promise<void> => {
        const attempt = ++micAttemptRef.current;
        if (micRestartTimerRef.current) {
          clearTimeout(micRestartTimerRef.current);
          micRestartTimerRef.current = null;
        }
        micProcessorRef.current?.disconnect();
        micProcessorRef.current = null;
        micStreamRef.current?.getTracks().forEach((track) => track.stop());
        micStreamRef.current = null;
        micRemainderRef.current = new Int16Array(0);

        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              channelCount: 1,
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
            video: false,
          });
        } catch (error) {
          if (attempt !== micAttemptRef.current) return;
          const denied = error instanceof DOMException && error.name === "NotAllowedError";
          setCall((prev) =>
            prev
              ? {
                  ...prev,
                  error: denied
                    ? "マイクの使用が許可されていません"
                    : "マイクを開始できませんでした",
                }
              : prev,
          );
          return;
        }

        if (attempt !== micAttemptRef.current || ws.readyState !== WebSocket.OPEN) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        const track = stream.getAudioTracks()[0];
        if (!track) {
          stream.getTracks().forEach((item) => item.stop());
          setCall((prev) => (prev ? { ...prev, error: "利用できるマイクがありません" } : prev));
          return;
        }

        micStreamRef.current = stream;
        const ctx = ensureAudioContext();
        if (attempt !== micAttemptRef.current) {
          stream.getTracks().forEach((item) => item.stop());
          return;
        }

        const source = ctx.createMediaStreamSource(stream);
        // ScriptProcessor sizes are powers of two, so frame at 1024 samples and
        // carry the excess into exact 20 ms / 960-sample Opus frames.
        const processor = ctx.createScriptProcessor(1024, 1, 1);
        const silentOutput = ctx.createGain();
        silentOutput.gain.value = 0;
        micProcessorRef.current = processor;
        processor.onaudioprocess = (ev) => {
          if (attempt !== micAttemptRef.current || ws.readyState !== WebSocket.OPEN) return;
          const input = ev.inputBuffer.getChannelData(0);
          let out: Int16Array<ArrayBuffer> = new Int16Array(input.length);
          if (!mutedRef.current) {
            for (let i = 0; i < input.length; i++) {
              const s = Math.max(-1, Math.min(1, input[i] ?? 0));
              out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
            }
          }
          if (ctx.sampleRate !== 48000) {
            out = resampleLinearPcm16(out, ctx.sampleRate, 48000);
          }
          const framed = splitPcm16Frames(out, micRemainderRef.current, PCM_FRAME_SAMPLES);
          micRemainderRef.current = framed.remainder;
          for (const frame of framed.frames) {
            ws.send(frame.buffer);
          }
        };
        source.connect(processor);
        processor.connect(silentOutput);
        silentOutput.connect(ctx.destination);

        setCall((prev) =>
          prev?.error?.startsWith("マイク") || prev?.error === "利用できるマイクがありません"
            ? { ...prev, error: undefined }
            : prev,
        );

        const restart = () => {
          if (attempt !== micAttemptRef.current || ws.readyState !== WebSocket.OPEN) return;
          if (retry) {
            setCall((prev) => (prev ? { ...prev, error: "マイク接続が切断されました" } : prev));
            return;
          }
          void acquire(true);
        };
        track.addEventListener("ended", restart, { once: true });
        track.addEventListener("mute", () => {
          if (attempt !== micAttemptRef.current) return;
          if (micRestartTimerRef.current) clearTimeout(micRestartTimerRef.current);
          micRestartTimerRef.current = setTimeout(() => {
            micRestartTimerRef.current = null;
            if (attempt === micAttemptRef.current && shouldRestartMicTrack(track)) restart();
          }, 750);
        });
        track.addEventListener("unmute", () => {
          if (attempt !== micAttemptRef.current || !micRestartTimerRef.current) return;
          clearTimeout(micRestartTimerRef.current);
          micRestartTimerRef.current = null;
        });
      };

      void acquire(false);
    },
    [ensureAudioContext],
  );

  const ensurePlaybackPipeline = useCallback((ctx: AudioContext) => {
    if (playbackNodeRef.current) return;
    const jb = (jitterBufferRef.current ??= new AudioJitterBuffer({
      sampleRate: ctx.sampleRate,
      prebufferMs: 80,
      maxBufferMs: 240,
    }));
    const node = ctx.createScriptProcessor(1024, 1, 1);
    node.onaudioprocess = (ev) => {
      const output = ev.outputBuffer.getChannelData(0);
      jb.read(output);
    };
    node.connect(ctx.destination);
    playbackNodeRef.current = node;
  }, []);

  const playRemotePcm = useCallback(
    (buf: ArrayBuffer) => {
      const ctx = ensureAudioContext();
      ensurePlaybackPipeline(ctx);
      let samples = new Int16Array(buf);
      if (samples.length === 0) return;
      if (ctx.sampleRate !== 48000) {
        samples = resampleLinearPcm16(samples, 48000, ctx.sampleRate);
      }
      jitterBufferRef.current?.pushPcm16(samples);
    },
    [ensureAudioContext, ensurePlaybackPipeline],
  );

  const connectWs = useCallback(
    (sessionId: string, accId: string) => {
      const ws = new WebSocket(callWsUrl(accId, sessionId));
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;
      // プロキシやサーバ側で WS が切られても UI が「通話中」のまま残らないよう、
      // close を検知したら通話終了扱いにする（通常の endCall 経路では call は
      // 既に null のため何も起きない）。
      ws.onclose = () => {
        useStore.getState().dismissIncomingCall();
        if (heartbeatTimerRef.current) {
          clearInterval(heartbeatTimerRef.current);
          heartbeatTimerRef.current = null;
        }
        setCall((prev) =>
          prev ? { ...prev, state: "ended", error: prev.error ?? "通話が切断されました" } : prev,
        );
        micStreamRef.current?.getTracks().forEach((t) => t.stop());
        micStreamRef.current = null;
        micProcessorRef.current?.disconnect();
        micProcessorRef.current = null;
        playbackNodeRef.current?.disconnect();
        playbackNodeRef.current = null;
        jitterBufferRef.current?.clear();
        jitterBufferRef.current = null;
      };
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
              if (nextState === "ended" || nextState === "failed") {
                useStore.getState().dismissIncomingCall();
              }
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
        // アイドル WS がプロキシ等で切られないよう heartbeat（backend は pong を返す）。
        // backend の closeOnBackpressureLimit / idleTimeout 対策も兼ねる。
        if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
        heartbeatTimerRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            try {
              ws.send(JSON.stringify({ type: "ping" }));
            } catch {
              /* onclose が後処理する */
            }
          }
        }, 25_000);
      };
    },
    [playRemotePcm, startMicPipeline],
  );

  const startCall = useCallback(
    async (to: string, kind: "voice" | "video") => {
      if (!accountId) return { ok: false as const, error: "not logged in" };
      useStore.getState().dismissIncomingCall();
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
      ensureAudioContext();
      connectWs(res.session.sessionId, accountId);
      return { ok: true as const, session: res.session };
    },
    [accountId, connectWs, ensureAudioContext],
  );

  const answerCall = useCallback(
    async (callMid: string, callerMid: string, kind: "voice" | "video") => {
      if (!accountId) return { ok: false as const, error: "not logged in" };
      useStore.getState().dismissIncomingCall();
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
      ensureAudioContext();
      connectWs(res.session.sessionId, accountId);
      return { ok: true as const, session: res.session };
    },
    [accountId, connectWs, ensureAudioContext],
  );

  const setMuted = useCallback((muted: boolean) => {
    mutedRef.current = muted;
  }, []);

  useEffect(() => {
    if (!accountId) return;
    const unlockAudio = () => ensureAudioContext();
    window.addEventListener("pointerdown", unlockAudio, true);
    window.addEventListener("keydown", unlockAudio, true);
    return () => {
      window.removeEventListener("pointerdown", unlockAudio, true);
      window.removeEventListener("keydown", unlockAudio, true);
    };
  }, [accountId, ensureAudioContext]);

  useEffect(() => () => cleanupMedia(), [cleanupMedia]);

  return { call, startCall, answerCall, endCall, setMuted, isInCall: call?.state === "in-call" };
}
