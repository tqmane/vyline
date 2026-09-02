/**
 * useCall — backend 通話セッション + WebSocket PCM ブリッジ
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import type { ActiveCall } from "@/utils/callAllowlist";
import {
  activeCallFromSession,
  friendlyCallError,
  mapCallState,
  pickRecoverableCall,
} from "@/utils/callSession";

/** HTTP API と同じオリジン・同じ /api プレフィックスを使う（リバースプロキシ経由でも届く） */
function callWsUrl(accountId: string, sessionId: string): string {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${location.host}/api/line/${encodeURIComponent(accountId)}/call/ws?sessionId=${encodeURIComponent(sessionId)}`;
}

const PCM_FRAME_SAMPLES = 960; // 48kHz mono 20ms — protocol Opus encoder の入力単位
const WS_RECONNECT_LIMIT = 4;

type SessionOwner = { accountId: string; sessionId: string };

export function useCall(accountId: string | null) {
  const [call, setCall] = useState<ActiveCall | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const playbackTimeRef = useRef(0);
  const mutedRef = useRef(false);
  const micStartedRef = useRef(false);
  const micFrameRef = useRef(new Int16Array(PCM_FRAME_SAMPLES));
  const micFrameOffsetRef = useRef(0);
  const sessionOwnerRef = useRef<SessionOwner | null>(null);
  const previousAccountRef = useRef<string | null>(null);
  const operationGenerationRef = useRef(0);
  const startingRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ensureAudioContext = useCallback(() => {
    const ctx = audioCtxRef.current ?? new AudioContext({ sampleRate: 48000 });
    audioCtxRef.current = ctx;
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    return ctx;
  }, []);

  const cleanupMedia = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    micStartedRef.current = false;
    micFrameOffsetRef.current = 0;
    micProcessorRef.current?.disconnect();
    micProcessorRef.current = null;
    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    micStreamRef.current = null;

    const ws = wsRef.current;
    wsRef.current = null;
    if (ws) {
      ws.onclose = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.close();
    }

    void audioCtxRef.current?.close();
    audioCtxRef.current = null;
    playbackTimeRef.current = 0;
  }, []);

  const startMicPipeline = useCallback(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      micStartedRef.current = false;
      setCall((prev) =>
        prev ? { ...prev, error: "この環境ではマイクを利用できません" } : prev,
      );
      return;
    }

    void (async () => {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      micStreamRef.current = stream;
      const ctx = ensureAudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(1024, 1, 1);
      micProcessorRef.current = processor;
      processor.onaudioprocess = (event) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN || mutedRef.current) {
          micFrameOffsetRef.current = 0;
          return;
        }

        const input = event.inputBuffer.getChannelData(0);
        const frame = micFrameRef.current;
        let offset = micFrameOffsetRef.current;
        for (let i = 0; i < input.length; i++) {
          const sample = Math.max(-1, Math.min(1, input[i] ?? 0));
          frame[offset++] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
          if (offset === PCM_FRAME_SAMPLES) {
            // CallSession の Opus encoder は1回の encode で20msだけ消費するため、
            // WebSocket 側でも必ず960 sample単位に切って送る。
            ws.send(frame.slice().buffer);
            offset = 0;
          }
        }
        micFrameOffsetRef.current = offset;
      };
      source.connect(processor);
      processor.connect(ctx.destination);
    })().catch((error) => {
      micStartedRef.current = false;
      setCall((prev) =>
        prev ? { ...prev, error: `マイクを開始できません: ${friendlyCallError(error)}` } : prev,
      );
    });
  }, [ensureAudioContext]);

  const playRemotePcm = useCallback(
    (buf: ArrayBuffer) => {
      if (buf.byteLength < 2 || buf.byteLength % 2 !== 0) return;
      const ctx = ensureAudioContext();
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
      const playbackAt = Math.max(ctx.currentTime, playbackTimeRef.current);
      src.start(playbackAt);
      playbackTimeRef.current = playbackAt + audioBuf.duration;
    },
    [ensureAudioContext],
  );

  const connectWs = useCallback(
    (sessionId: string, accId: string) => {
      if (
        sessionOwnerRef.current?.sessionId !== sessionId ||
        sessionOwnerRef.current.accountId !== accId
      ) {
        return;
      }

      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      const previous = wsRef.current;
      wsRef.current = null;
      if (previous) {
        previous.onclose = null;
        previous.close();
      }

      let reconnectAttempt = 0;
      const open = () => {
        if (
          sessionOwnerRef.current?.sessionId !== sessionId ||
          sessionOwnerRef.current.accountId !== accId
        ) {
          return;
        }

        const ws = new WebSocket(callWsUrl(accId, sessionId));
        ws.binaryType = "arraybuffer";
        wsRef.current = ws;

        ws.onmessage = (event) => {
          if (
            sessionOwnerRef.current?.sessionId !== sessionId ||
            sessionOwnerRef.current.accountId !== accId
          ) {
            return;
          }

          if (typeof event.data === "string") {
            try {
              const message = JSON.parse(event.data) as {
                type?: string;
                state?: string;
                error?: string;
                transport?: string;
              };
              if (message.type === "state" && message.state) {
                const nextState = mapCallState(message.state);
                const transport =
                  message.transport === "planet" ||
                  message.transport === "andromeda" ||
                  message.transport === "unknown"
                    ? message.transport
                    : undefined;
                setCall((prev) =>
                  prev
                    ? {
                        ...prev,
                        state: nextState,
                        ...(transport ? { transport } : {}),
                        ...(message.error
                          ? { error: friendlyCallError(message.error) }
                          : {}),
                      }
                    : prev,
                );

                if (nextState === "in-call" && !micStartedRef.current) {
                  ensureAudioContext();
                  micStartedRef.current = true;
                  startMicPipeline();
                }
                if (nextState === "ended" || nextState === "failed") {
                  sessionOwnerRef.current = null;
                  cleanupMedia();
                }
              }
            } catch {
              /* malformed state frame */
            }
            return;
          }

          if (event.data instanceof ArrayBuffer) playRemotePcm(event.data);
        };

        ws.onopen = () => {
          ws.send(JSON.stringify({ type: "ping" }));
        };

        ws.onclose = () => {
          if (wsRef.current === ws) wsRef.current = null;
          if (
            sessionOwnerRef.current?.sessionId !== sessionId ||
            sessionOwnerRef.current.accountId !== accId
          ) {
            return;
          }
          if (reconnectAttempt >= WS_RECONNECT_LIMIT) {
            setCall((prev) =>
              prev ? { ...prev, error: "通話の音声接続が切れました" } : prev,
            );
            return;
          }
          reconnectAttempt += 1;
          reconnectTimerRef.current = setTimeout(open, Math.min(500 * 2 ** reconnectAttempt, 4000));
        };
      };

      open();
    },
    [cleanupMedia, ensureAudioContext, playRemotePcm, startMicPipeline],
  );

  const startCall = useCallback(
    async (to: string, kind: "voice" | "video") => {
      if (!accountId) return { ok: false as const, error: "not logged in" };
      if (startingRef.current || sessionOwnerRef.current) {
        return { ok: false as const, error: "すでに通話中です" };
      }

      const requestedAccountId = accountId;
      const generation = ++operationGenerationRef.current;
      startingRef.current = true;
      setCall({ sessionId: "", to, kind, state: "starting" });

      try {
        const callType = kind === "video" ? "VIDEO" : "AUDIO";
        const res = await api.line.callStart(requestedAccountId, to, callType);
        if (!res.ok || !("session" in res) || !res.session) {
          const error = !res.ok && "error" in res ? res.error : "call start failed";
          if (operationGenerationRef.current === generation) {
            setCall({
              sessionId: "",
              to,
              kind,
              state: "failed",
              error: friendlyCallError(error),
            });
          }
          return { ok: false as const, error };
        }

        if (
          operationGenerationRef.current !== generation ||
          requestedAccountId !== previousAccountRef.current
        ) {
          void api.line.callEnd(requestedAccountId, res.session.sessionId).catch(() => {});
          return { ok: false as const, error: "アカウントが切り替わりました" };
        }

        sessionOwnerRef.current = {
          accountId: requestedAccountId,
          sessionId: res.session.sessionId,
        };
        setCall(activeCallFromSession(res.session));
        ensureAudioContext();
        connectWs(res.session.sessionId, requestedAccountId);
        return { ok: true as const, session: res.session };
      } catch (error) {
        const message = friendlyCallError(error);
        if (operationGenerationRef.current === generation) {
          setCall({ sessionId: "", to, kind, state: "failed", error: message });
        }
        return { ok: false as const, error: message };
      } finally {
        if (operationGenerationRef.current === generation) startingRef.current = false;
      }
    },
    [accountId, connectWs, ensureAudioContext],
  );

  const endCall = useCallback(async () => {
    operationGenerationRef.current += 1;
    startingRef.current = false;
    const owner = sessionOwnerRef.current;
    sessionOwnerRef.current = null;
    cleanupMedia();
    setCall(null);
    if (!owner) return;
    try {
      await api.line.callEnd(owner.accountId, owner.sessionId);
    } catch {
      /* backend/session may already be gone */
    }
  }, [cleanupMedia]);

  const setMuted = useCallback((muted: boolean) => {
    mutedRef.current = muted;
    if (muted) micFrameOffsetRef.current = 0;
  }, []);

  useEffect(() => {
    const previousAccount = previousAccountRef.current;
    previousAccountRef.current = accountId;
    const generation = ++operationGenerationRef.current;
    startingRef.current = false;

    if (previousAccount !== accountId) {
      const previousOwner = sessionOwnerRef.current;
      sessionOwnerRef.current = null;
      cleanupMedia();
      setCall(null);
      if (previousOwner && previousOwner.accountId === previousAccount) {
        void api.line.callEnd(previousOwner.accountId, previousOwner.sessionId).catch(() => {});
      }
    }

    if (!accountId) return;
    let cancelled = false;
    void api.line
      .callActive(accountId)
      .then((res) => {
        if (cancelled || operationGenerationRef.current !== generation || !res.ok) return;
        const session = pickRecoverableCall(res.sessions);
        if (!session) return;
        sessionOwnerRef.current = { accountId, sessionId: session.sessionId };
        setCall(activeCallFromSession(session));
        ensureAudioContext();
        connectWs(session.sessionId, accountId);
      })
      .catch(() => {
        /* recovery is best effort; a new outgoing call still remains available */
      });

    return () => {
      cancelled = true;
    };
  }, [accountId, cleanupMedia, connectWs, ensureAudioContext]);

  useEffect(
    () => () => {
      operationGenerationRef.current += 1;
      sessionOwnerRef.current = null;
      cleanupMedia();
    },
    [cleanupMedia],
  );

  return { call, startCall, endCall, setMuted, isInCall: call?.state === "in-call" };
}
