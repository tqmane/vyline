import { useCallback, useEffect, useRef, useState } from "react";
import { decodeCallVideoFrame, encodeCallVideoFrame, type CallVideoState } from "@vyline/types";
import type { ActiveCall } from "@/utils/callAllowlist";
import { annexBToAvcc, avccToAnnexB, avcCodec } from "@/utils/callVideo";

const EMPTY_VIDEO: CallVideoState = { available: false, localEnabled: false, remoteEnabled: false };

export function useCallVideo(accountId: string | null, call: ActiveCall | null) {
  const localRef = useRef<HTMLVideoElement | null>(null);
  const remoteRef = useRef<HTMLCanvasElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const encoderRef = useRef<VideoEncoder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const attemptRef = useRef(0);
  const animationRef = useRef(0);
  const forceKeyRef = useRef(true);
  const wantCameraRef = useRef(false);
  const pendingRef = useRef<boolean | null>(null);
  const facingRef = useRef<"user" | "environment">("user");
  const [video, setVideo] = useState(EMPTY_VIDEO);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [hasImage, setHasImage] = useState(false);
  const disposeRef = useRef<(() => void) | null>(null);
  const sessionId =
    call && !["ending", "ended", "failed"].includes(call.state) ? call.sessionId : null;

  const stopCamera = useCallback(() => {
    attemptRef.current++;
    wantCameraRef.current = false;
    cancelAnimationFrame(animationRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (encoderRef.current?.state !== "closed") encoderRef.current?.close();
    encoderRef.current = null;
    if (localRef.current) localRef.current.srcObject = null;
  }, []);

  useEffect(() => {
    setVideo(EMPTY_VIDEO);
    setHasImage(false);
    setError(undefined);
    setBusy(false);
    pendingRef.current = null;
    if (!sessionId || !accountId) return;
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(
      `${scheme}://${location.host}/api/line/${encodeURIComponent(accountId)}/call/ws?sessionId=${encodeURIComponent(sessionId)}&media=video`,
    );
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;
    let decoder: VideoDecoder | undefined;
    let codec: string | undefined;
    let needsKey = true;
    let disposed = false;
    let rotation = 0;
    let remoteEnabled = false;
    let decoderGeneration = 0;
    const fail = () => {
      needsKey = true;
      setError("映像を再生できませんでした。音声通話は継続します");
    };
    const createDecoder = () => {
      const generation = ++decoderGeneration;
      return new VideoDecoder({
        error: fail,
        output(frame) {
          try {
            const canvas = remoteRef.current;
            if (
              disposed ||
              generation !== decoderGeneration ||
              !remoteEnabled ||
              !canvas ||
              frame.displayWidth > 1280 ||
              frame.displayHeight > 720
            )
              return;
            canvas.width = rotation % 2 ? frame.displayHeight : frame.displayWidth;
            canvas.height = rotation % 2 ? frame.displayWidth : frame.displayHeight;
            const context = canvas.getContext("2d");
            if (!context) return;
            context.translate(canvas.width / 2, canvas.height / 2);
            context.rotate((rotation * Math.PI) / 2);
            context.drawImage(frame, -frame.displayWidth / 2, -frame.displayHeight / 2);
            setHasImage(true);
          } finally {
            frame.close();
          }
        },
      });
    };
    ws.onmessage = (event) => {
      if (disposed) return;
      if (typeof event.data === "string") {
        try {
          const message = JSON.parse(event.data);
          if (message.type === "state" && message.video) {
            const state = message.video as CallVideoState;
            setVideo(state);
            remoteEnabled = state.remoteEnabled;
            if (!remoteEnabled) {
              setHasImage(false);
              needsKey = true;
              decoderGeneration++;
              if (decoder?.state !== "closed") decoder?.close();
              decoder = undefined;
            }
            if (pendingRef.current === state.localEnabled) {
              pendingRef.current = null;
              setBusy(false);
            }
            if (!state.localEnabled && pendingRef.current !== true) stopCamera();
          }
          if (message.type === "video-keyframe") forceKeyRef.current = true;
          if (message.type === "video-error") {
            setError(message.error || "カメラを切り替えられませんでした");
            setBusy(false);
            pendingRef.current = null;
            stopCamera();
          }
        } catch {
          /* malformed state cannot affect the audio socket */
        }
        return;
      }
      if (!(event.data instanceof ArrayBuffer) || !globalThis.VideoDecoder) return;
      try {
        const frame = decodeCallVideoFrame(new Uint8Array(event.data));
        if (needsKey && !frame.key) return;
        const nextCodec = frame.key ? avcCodec(frame.data) : undefined;
        if (nextCodec && (nextCodec !== codec || decoder?.state !== "configured")) {
          if (decoder?.state !== "closed") decoder?.close();
          decoder = createDecoder();
          decoder.configure({ codec: nextCodec, optimizeForLatency: true });
          codec = nextCodec;
          needsKey = true;
        }
        if (!decoder || decoder.state !== "configured") return;
        if (decoder.decodeQueueSize > 2) {
          decoder.reset();
          decoder.configure({ codec: codec!, optimizeForLatency: true });
          needsKey = true;
          return;
        }
        rotation = frame.rotation ?? 0;
        decoder.decode(
          new EncodedVideoChunk({
            type: frame.key ? "key" : "delta",
            timestamp: Math.round((frame.timestamp * 1000) / 90),
            data: avccToAnnexB(frame.data),
          }),
        );
        needsKey = false;
      } catch {
        fail();
      }
    };
    ws.onclose = () => {
      if (disposed) return;
      dispose();
      setVideo(EMPTY_VIDEO);
      setHasImage(false);
      setBusy(false);
      pendingRef.current = null;
      setError("映像接続が切断されました。音声通話は継続します");
    };
    const heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
    }, 25_000);
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      clearInterval(heartbeat);
      stopCamera();
      if (decoder?.state !== "closed") decoder?.close();
      ws.close();
      if (wsRef.current === ws) wsRef.current = null;
    };
    disposeRef.current = dispose;
    return () => {
      dispose();
      if (disposeRef.current === dispose) disposeRef.current = null;
    };
  }, [accountId, sessionId, stopCamera]);

  const startCamera = useCallback(async () => {
    const ws = wsRef.current;
    if (!video.available || !ws || ws.readyState !== WebSocket.OPEN || call?.state !== "in-call")
      return;
    stopCamera();
    const attempt = ++attemptRef.current;
    setBusy(true);
    pendingRef.current = true;
    setError(undefined);
    try {
      if (!globalThis.VideoEncoder || !navigator.mediaDevices?.getUserMedia) {
        throw new Error("このブラウザはビデオ通話に対応していません");
      }
      const config: VideoEncoderConfig = {
        codec: "avc1.42e01e",
        width: 640,
        height: 360,
        bitrate: 450_000,
        framerate: 15,
        latencyMode: "realtime",
        avc: { format: "annexb" },
      };
      const support = await VideoEncoder.isConfigSupported(config);
      if (
        attempt !== attemptRef.current ||
        ws !== wsRef.current ||
        ws.readyState !== WebSocket.OPEN
      )
        return;
      if (!support.supported) throw new Error("このブラウザではH.264映像を送信できません");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          width: { ideal: 640, max: 1280 },
          height: { ideal: 360, max: 720 },
          frameRate: { ideal: 15, max: 24 },
          facingMode: facingRef.current,
        },
      });
      if (attempt !== attemptRef.current || ws !== wsRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const preview = localRef.current;
      if (!preview) throw new Error("プレビューを表示できませんでした");
      preview.srcObject = stream;
      await preview.play();
      if (attempt !== attemptRef.current) return;
      const canvas = new OffscreenCanvas(640, 360);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("カメラ映像を準備できませんでした");
      let sentFrames = 0;
      let lastTime = 0;
      let lastKeyTime = 0;
      let waitingKey = true;
      forceKeyRef.current = true;
      const encoder = new VideoEncoder({
        error() {
          if (attempt !== attemptRef.current) return;
          stopCamera();
          setBusy(false);
          setError("映像の送信を停止しました。音声通話は継続します");
          if (ws.readyState === WebSocket.OPEN)
            ws.send(JSON.stringify({ type: "video", enabled: false }));
        },
        output(chunk) {
          if (
            attempt !== attemptRef.current ||
            !wantCameraRef.current ||
            ws.readyState !== WebSocket.OPEN
          )
            return;
          if (ws.bufferedAmount > 256 * 1024) {
            waitingKey = true;
            forceKeyRef.current = true;
            return;
          }
          if (waitingKey && chunk.type !== "key") return;
          try {
            const data = new Uint8Array(chunk.byteLength);
            chunk.copyTo(data);
            const avcc = annexBToAvcc(data);
            ws.send(
              encodeCallVideoFrame({
                data: avcc,
                key: chunk.type === "key",
                timestamp: Math.round((chunk.timestamp * 90) / 1000) >>> 0,
              }),
            );
            waitingKey = false;
          } catch {
            waitingKey = true;
            forceKeyRef.current = true;
          }
        },
      });
      encoder.configure(config);
      encoderRef.current = encoder;
      wantCameraRef.current = true;
      pendingRef.current = true;
      ws.send(JSON.stringify({ type: "video", enabled: true }));
      const pump = (now: number) => {
        if (attempt !== attemptRef.current || !wantCameraRef.current) return;
        animationRef.current = requestAnimationFrame(pump);
        if (
          pendingRef.current !== null ||
          now - lastTime < 1000 / 15 ||
          encoder.encodeQueueSize >= 2
        )
          return;
        lastTime = now;
        // Match the codec dimensions with a native browser canvas, preserving aspect ratio.
        context.fillStyle = "black";
        context.fillRect(0, 0, 640, 360);
        const ratio = Math.min(640 / preview.videoWidth, 360 / preview.videoHeight);
        const width = preview.videoWidth * ratio;
        const height = preview.videoHeight * ratio;
        context.drawImage(preview, (640 - width) / 2, (360 - height) / 2, width, height);
        const frame = new VideoFrame(canvas, { timestamp: Math.round(now * 1000) });
        try {
          const key = forceKeyRef.current || sentFrames === 0 || now - lastKeyTime >= 1000;
          encoder.encode(frame, { keyFrame: key });
          if (key) {
            lastKeyTime = now;
            forceKeyRef.current = false;
          }
          sentFrames++;
        } finally {
          frame.close();
        }
      };
      animationRef.current = requestAnimationFrame(pump);
    } catch (cause) {
      if (attempt !== attemptRef.current) return;
      stopCamera();
      setBusy(false);
      pendingRef.current = null;
      setError(
        cause instanceof DOMException && cause.name === "NotAllowedError"
          ? "カメラの使用が許可されていません"
          : cause instanceof Error
            ? cause.message
            : "カメラを開始できませんでした",
      );
    }
  }, [video.available, call?.state, stopCamera]);

  const toggleCamera = useCallback(() => {
    if (busy) return;
    if (wantCameraRef.current || video.localEnabled) {
      stopCamera();
      setBusy(true);
      pendingRef.current = false;
      wsRef.current?.send(JSON.stringify({ type: "video", enabled: false }));
    } else {
      void startCamera();
    }
  }, [busy, video.localEnabled, startCamera, stopCamera]);

  const switchCamera = useCallback(() => {
    if (busy || !video.localEnabled) return;
    facingRef.current = facingRef.current === "user" ? "environment" : "user";
    void startCamera();
  }, [busy, video.localEnabled, startCamera]);

  const stopVideo = useCallback(() => {
    stopCamera();
    disposeRef.current?.();
    pendingRef.current = null;
    setBusy(false);
    setHasImage(false);
    setVideo(EMPTY_VIDEO);
  }, [stopCamera]);

  return {
    ...video,
    localRef,
    remoteRef,
    hasImage,
    busy,
    error,
    toggleCamera,
    switchCamera,
    stopVideo,
  };
}
