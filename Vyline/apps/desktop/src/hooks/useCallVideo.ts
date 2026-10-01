import { useCallback, useEffect, useRef, useState } from "react";
import { decodeCallVideoFrame, encodeCallVideoFrame, type CallVideoState } from "@vyline/types";
import { readCallParticipants, type ActiveCall } from "@/utils/callAllowlist";

const EMPTY_VIDEO: CallVideoState = { available: false, localEnabled: false, remoteEnabled: false };

export function useCallVideo(accountId: string | null, call: ActiveCall | null) {
  const localRef = useRef<HTMLVideoElement | null>(null);
  const remoteRef = useRef<HTMLCanvasElement | null>(null);
  const remoteCanvasesRef = useRef(new Map<string, HTMLCanvasElement>());
  const [remoteImages, setRemoteImages] = useState<ReadonlySet<string>>(new Set());
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
  const metricsRef = useRef({
    wsStateRx: 0,
    wsBinaryRx: 0,
    wsOpenEvents: 0,
    wsCloses: 0,
    wsErrors: 0,
    wsCloseCode: 0,
    wsCloseWasClean: 0,
    keyFramesRx: 0,
    deltaFramesRx: 0,
    decoderCreations: 0,
    decoderCloses: 0,
    decodeQueueHighWater: 0,
    decodeCalls: 0,
    decoderOutputs: 0,
    canvasRenders: 0,
    droppedFrames: 0,
    keyframeWaitDrops: 0,
    decodeErrors: 0,
    cameraRequests: 0,
    cameraSuccesses: 0,
    cameraFailures: 0,
    previewPlaySuccesses: 0,
    previewPlayFailures: 0,
    encoderConfigChecks: 0,
    encoderUnsupported: 0,
    encoderSoftwarePreferenceFallbacks: 0,
    encoderErrors: 0,
    encoderConfigureSuccesses: 0,
    encoderOutputs: 0,
    encoderOutputBytes: 0,
    encoderKeyFrames: 0,
    encodeCalls: 0,
    encodeQueueHighWater: 0,
    encodeQueueSkips: 0,
    videoWsTxFrames: 0,
    videoWsTxBytes: 0,
    videoWsBufferedHighWater: 0,
    decoderQueueDrops: 0,
    videoWsBufferDrops: 0,
    videoEnableRequests: 0,
    videoStateChanges: 0,
    cameraStartFailures: 0,
  });
  const lastCameraErrorRef = useRef("");
  const sessionId =
    call && !["ending", "ended", "failed"].includes(call.state) ? call.sessionId : null;
  const group = call?.to.startsWith("c") ?? false;

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
    setRemoteImages(new Set());
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
    type Track = {
      decoder?: VideoDecoder;
      needsKey: boolean;
      rotation: number;
      generation: number;
    };
    const tracks = new Map<string, Track>();
    let sources = new Set<string>();
    let disposed = false;
    let remoteEnabled = false;
    let localEnabled = false;
    const metrics = metricsRef.current;
    for (const key of Object.keys(metrics) as Array<keyof typeof metrics>) metrics[key] = 0;
    const closeReasons: Record<string, number> = {};
    lastCameraErrorRef.current = "";
    const reportDiagnostics = () => {
      const track = streamRef.current?.getVideoTracks()[0];
      let settings: MediaTrackSettings | undefined;
      try {
        settings = track?.getSettings();
      } catch {
        /* Track settings are diagnostic only. */
      }
      const decoderStates: Record<string, number> = {};
      for (const videoTrack of tracks.values()) {
        const state = videoTrack.decoder?.state ?? "missing";
        decoderStates[state] = (decoderStates[state] ?? 0) + 1;
      }
      console.info("[vyline-call-video]", {
        ...metrics,
        closeReasons: { ...closeReasons },
        wsReadyState: ws.readyState,
        localEnabled,
        remoteEnabled,
        cameraTrack: track
          ? {
              readyState: track.readyState,
              muted: track.muted,
              enabled: track.enabled,
              width: settings?.width,
              height: settings?.height,
              frameRate: settings?.frameRate,
            }
          : null,
        preview: localRef.current
          ? {
              readyState: localRef.current.readyState,
              width: localRef.current.videoWidth,
              height: localRef.current.videoHeight,
            }
          : null,
        encoderState: encoderRef.current?.state ?? "missing",
        pendingVideoEnabled: pendingRef.current,
        lastCameraError: lastCameraErrorRef.current,
        decoderCount: tracks.size,
        decoderStates,
      });
      lastCameraErrorRef.current = "";
      for (const key of Object.keys(metrics) as Array<keyof typeof metrics>) metrics[key] = 0;
      for (const key of Object.keys(closeReasons)) delete closeReasons[key];
    };
    const diagnosticTimer = setInterval(reportDiagnostics, 1000);
    ws.onopen = () => {
      if (wsRef.current === ws) metrics.wsOpenEvents++;
    };
    const fail = (track?: Track) => {
      if (disposed) return;
      if (track) track.needsKey = true;
      metrics.decodeErrors++;
      setError("映像を再生できませんでした。音声通話は継続します");
    };
    const closeTrack = (id: string, reason: string) => {
      const track = tracks.get(id);
      tracks.delete(id);
      if (track?.decoder && track.decoder.state !== "closed") {
        track.decoder.close();
        metrics.decoderCloses++;
        closeReasons[reason] = (closeReasons[reason] ?? 0) + 1;
      }
    };
    const createDecoder = (id: string, track: Track) => {
      const generation = ++track.generation;
      metrics.decoderCreations++;
      return new VideoDecoder({
        error() {
          if (tracks.get(id) === track && generation === track.generation) fail(track);
        },
        output(frame) {
          metrics.decoderOutputs++;
          try {
            const canvas = group ? remoteCanvasesRef.current.get(id) : remoteRef.current;
            if (
              disposed ||
              tracks.get(id) !== track ||
              generation !== track.generation ||
              (group ? !sources.has(id) : !remoteEnabled) ||
              !canvas ||
              frame.displayWidth > 1280 ||
              frame.displayHeight > 1280 ||
              frame.displayWidth * frame.displayHeight > 1280 * 720
            )
              return;
            const width = track.rotation % 2 ? frame.displayHeight : frame.displayWidth;
            const height = track.rotation % 2 ? frame.displayWidth : frame.displayHeight;
            if (canvas.width !== width) canvas.width = width;
            if (canvas.height !== height) canvas.height = height;
            const context = canvas.getContext("2d");
            if (!context) return;
            context.setTransform(1, 0, 0, 1, 0, 0);
            context.translate(canvas.width / 2, canvas.height / 2);
            context.rotate((track.rotation * Math.PI) / 2);
            context.drawImage(frame, -frame.displayWidth / 2, -frame.displayHeight / 2);
            metrics.canvasRenders++;
            if (group)
              setRemoteImages((current) => (current.has(id) ? current : new Set([...current, id])));
            else setHasImage(true);
          } finally {
            frame.close();
          }
        },
      });
    };
    ws.onmessage = (event) => {
      if (disposed) return;
      if (typeof event.data === "string") {
        metrics.wsStateRx++;
        try {
          const message = JSON.parse(event.data);
          if (message.type === "state" && message.video) {
            const state = message.video as CallVideoState;
            if (
              [state.available, state.localEnabled, state.remoteEnabled].some(
                (v) => typeof v !== "boolean",
              )
            )
              return;
            if (localEnabled !== state.localEnabled || remoteEnabled !== state.remoteEnabled)
              metrics.videoStateChanges++;
            localEnabled = state.localEnabled;
            setVideo(state);
            remoteEnabled = state.remoteEnabled;
            if (group) {
              const members = readCallParticipants(message.participants);
              if (members) {
                sources = new Set(members.filter((m) => m.hasVideoStream).map((m) => m.mid));
                for (const id of tracks.keys())
                  if (!sources.has(id)) closeTrack(id, "track_removed");
                setRemoteImages((current) =>
                  [...current].every((id) => sources.has(id))
                    ? current
                    : new Set([...current].filter((id) => sources.has(id))),
                );
              }
            } else if (!remoteEnabled) {
              setHasImage(false);
              closeTrack("", "source_pause");
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
      metrics.wsBinaryRx++;
      if (!(event.data instanceof ArrayBuffer) || !globalThis.VideoDecoder) {
        metrics.droppedFrames++;
        return;
      }
      try {
        const frame = decodeCallVideoFrame(new Uint8Array(event.data));
        if (frame.key) metrics.keyFramesRx++;
        else metrics.deltaFramesRx++;
        const id = frame.sourceMid ?? "";
        if (group ? !sources.has(id) : id !== "" || !remoteEnabled) {
          metrics.droppedFrames++;
          return;
        }
        let track = tracks.get(id);
        if (!track) {
          if (!frame.key || tracks.size >= 30) {
            metrics.droppedFrames++;
            if (!frame.key) metrics.keyframeWaitDrops++;
            return;
          }
          track = { needsKey: true, rotation: 0, generation: 0 };
          tracks.set(id, track);
        }
        if (track.needsKey && !frame.key) {
          metrics.droppedFrames++;
          metrics.keyframeWaitDrops++;
          return;
        }
        if (frame.key && track.decoder?.state !== "configured") {
          if (track.decoder?.state !== "closed") {
            track.decoder?.close();
            metrics.decoderCloses++;
            closeReasons.keyframe_reconfigure = (closeReasons.keyframe_reconfigure ?? 0) + 1;
          }
          track.decoder = createDecoder(id, track);
          track.decoder.configure({ codec: "vp8", optimizeForLatency: true });
          track.needsKey = true;
        }
        const decoder = track.decoder;
        if (!decoder || decoder.state !== "configured") {
          metrics.droppedFrames++;
          return;
        }
        metrics.decodeQueueHighWater = Math.max(metrics.decodeQueueHighWater, decoder.decodeQueueSize);
        if (decoder.decodeQueueSize > 2 && !frame.key) {
          metrics.decoderQueueDrops++;
          metrics.droppedFrames++;
          track.needsKey = true;
          return;
        }
        track.rotation = frame.rotation ?? 0;
        metrics.decodeCalls++;
        decoder.decode(
          new EncodedVideoChunk({
            type: frame.key ? "key" : "delta",
            timestamp: Math.round((frame.timestamp * 1000) / 90),
            data: frame.data,
          }),
        );
        track.needsKey = false;
      } catch {
        metrics.droppedFrames++;
        fail();
      }
    };
    ws.onerror = () => {
      if (wsRef.current === ws) metrics.wsErrors++;
    };
    ws.onclose = (event) => {
      if (disposed) return;
      metrics.wsCloses++;
      metrics.wsCloseCode = event.code;
      metrics.wsCloseWasClean = event.wasClean ? 1 : 0;
      dispose("websocket_close");
      setVideo(EMPTY_VIDEO);
      setHasImage(false);
      setRemoteImages(new Set());
      setBusy(false);
      pendingRef.current = null;
      setError("映像接続が切断されました。音声通話は継続します");
    };
    const heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
    }, 25_000);
    const dispose = (reason = "call_end") => {
      if (disposed) return;
      disposed = true;
      clearInterval(heartbeat);
      clearInterval(diagnosticTimer);
      stopCamera();
      for (const id of tracks.keys()) closeTrack(id, reason);
      reportDiagnostics();
      ws.close();
      if (wsRef.current === ws) wsRef.current = null;
    };
    disposeRef.current = dispose;
    return () => {
      dispose();
      if (disposeRef.current === dispose) disposeRef.current = null;
    };
  }, [accountId, sessionId, group, stopCamera]);

  const startCamera = useCallback(async () => {
    const ws = wsRef.current;
    const metrics = metricsRef.current;
    if (!video.available || !ws || ws.readyState !== WebSocket.OPEN || call?.state !== "in-call")
      return;
    let stage = "support_check";
    metrics.cameraRequests++;
    stopCamera();
    const attempt = ++attemptRef.current;
    setBusy(true);
    pendingRef.current = true;
    setError(undefined);
    try {
      if (!globalThis.VideoEncoder || !navigator.mediaDevices?.getUserMedia) {
        throw new Error("このブラウザはビデオ通話に対応していません");
      }
      const defaultConfig: VideoEncoderConfig = {
        codec: "vp8",
        width: 640,
        height: 360,
        bitrate: 450_000,
        framerate: 15,
        latencyMode: "realtime",
      };
      // Leave the device's hardware encoder available for a simultaneous MediaRecorder.
      let config: VideoEncoderConfig = {
        ...defaultConfig,
        hardwareAcceleration: "prefer-software",
      };
      metrics.encoderConfigChecks++;
      let support = await VideoEncoder.isConfigSupported(config);
      if (
        attempt !== attemptRef.current ||
        ws !== wsRef.current ||
        ws.readyState !== WebSocket.OPEN
      )
        return;
      if (!support.supported) {
        metrics.encoderSoftwarePreferenceFallbacks++;
        config = defaultConfig;
        metrics.encoderConfigChecks++;
        support = await VideoEncoder.isConfigSupported(config);
        if (
          attempt !== attemptRef.current ||
          ws !== wsRef.current ||
          ws.readyState !== WebSocket.OPEN
        )
          return;
      }
      if (!support.supported) {
        metrics.encoderUnsupported++;
        throw new Error("このブラウザではVP8映像を送信できません");
      }
      stage = "get_user_media";
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
      metrics.cameraSuccesses++;
      const preview = localRef.current;
      if (!preview) throw new Error("プレビューを表示できませんでした");
      preview.srcObject = stream;
      stage = "preview_play";
      await preview.play();
      metrics.previewPlaySuccesses++;
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
          metrics.encoderErrors++;
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
          metrics.encoderOutputs++;
          metrics.encoderOutputBytes += chunk.byteLength;
          if (chunk.type === "key") metrics.encoderKeyFrames++;
          metrics.videoWsBufferedHighWater = Math.max(metrics.videoWsBufferedHighWater, ws.bufferedAmount);
          if (ws.bufferedAmount > 256 * 1024) {
            metrics.videoWsBufferDrops++;
            waitingKey = true;
            forceKeyRef.current = true;
            return;
          }
          if (waitingKey && chunk.type !== "key") {
            metrics.droppedFrames++;
            return;
          }
          try {
            const data = new Uint8Array(chunk.byteLength);
            chunk.copyTo(data);
            ws.send(
              encodeCallVideoFrame({
                data,
                key: chunk.type === "key",
                timestamp: Math.round((chunk.timestamp * 90) / 1000) >>> 0,
              }),
            );
            metrics.videoWsTxFrames++;
            metrics.videoWsTxBytes += chunk.byteLength;
            waitingKey = false;
          } catch {
            metrics.droppedFrames++;
            waitingKey = true;
            forceKeyRef.current = true;
          }
        },
      });
      encoder.configure(config);
      metrics.encoderConfigureSuccesses++;
      encoderRef.current = encoder;
      wantCameraRef.current = true;
      pendingRef.current = true;
      metrics.videoEnableRequests++;
      ws.send(JSON.stringify({ type: "video", enabled: true }));
      const pump = (now: number) => {
        if (attempt !== attemptRef.current || !wantCameraRef.current) return;
        animationRef.current = requestAnimationFrame(pump);
        if (
          pendingRef.current !== null ||
          now - lastTime < 1000 / 15
        )
          return;
        metrics.encodeQueueHighWater = Math.max(metrics.encodeQueueHighWater, encoder.encodeQueueSize);
        if (encoder.encodeQueueSize >= 2) {
          metrics.encodeQueueSkips++;
          return;
        }
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
          metrics.encodeCalls++;
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
      metrics.cameraStartFailures++;
      lastCameraErrorRef.current = cause instanceof DOMException ? cause.name : "Error";
      if (stage === "get_user_media") metrics.cameraFailures++;
      if (stage === "preview_play") metrics.previewPlayFailures++;
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
    setRemoteImages(new Set());
    setVideo(EMPTY_VIDEO);
  }, [stopCamera]);

  return {
    ...video,
    localRef,
    remoteRef,
    remoteCanvasesRef,
    remoteImages,
    hasImage: hasImage || remoteImages.size > 0,
    busy,
    error,
    toggleCamera,
    switchCamera,
    stopVideo,
  };
}
