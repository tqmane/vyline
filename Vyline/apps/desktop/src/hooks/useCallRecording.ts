import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { RecordingKind } from "@vyline/types";
import { recordingClient } from "@/api/recordings";
import { useStore } from "@/lib/store";
import type { ActiveCall } from "@/utils/callAllowlist";
import {
  recordAndUpload,
  recordingHasOtherParticipant,
  recordingMime,
  recordingStream,
  type RecordingTile,
} from "@/utils/callRecording";

type Input = {
  accountId: string | null;
  call: ActiveCall | null;
  selfMid?: string;
  title: string;
  getAudio: () => { stream: MediaStream; release: () => void };
  getTiles: () => RecordingTile[];
  beforeMediaCleanupRef: RefObject<(() => void) | null>;
};
type Status = {
  state: "idle" | "starting" | "recording" | "saving" | "saved" | "error";
  startedAt?: number;
  error?: string;
};
export type RecordingSessionHandle = {
  stop: () => void;
  scope: string;
  cancelled: boolean;
};

/**
 * Detach the recording session that belongs to a finished call or a different
 * account.
 *
 * `active` otherwise keeps the previous session until its upload drains, which
 * leaves `operationActive` stuck (a disabled 記録 button with no explanation) and
 * makes `start()` bail out, so an automatic recording of the next call captures
 * zero bytes without any error. The detached session's own `finally` only clears
 * `active` when it still owns it, so a session that starts meanwhile is kept.
 */
export function releaseRecordingSession(
  active: { current: RecordingSessionHandle | null },
  setOperationActive: (value: boolean) => void,
): void {
  active.current?.stop();
  active.current = null;
  setOperationActive(false);
}

export function useCallRecording(input: Input) {
  const scope =
    input.accountId && input.call?.sessionId ? `${input.accountId}:${input.call.sessionId}` : null;
  const latest = useRef({ ...input, scope });
  latest.current = { ...input, scope };
  const active = useRef<{ stop: () => void; scope: string; cancelled: boolean } | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [automatic, setAutomaticState] = useState(false);
  const [kind, setKind] = useState<RecordingKind>("audio");
  const consent = useRef(false);
  const [consentAction, setConsentAction] = useState<"manual" | "automatic" | null>(null);
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [seconds, setSeconds] = useState(0);
  const [operationActive, setOperationActive] = useState(false);
  const hasOthers = recordingHasOtherParticipant(input.call, input.selfMid);

  const stop = useCallback(() => active.current?.stop(), []);
  useEffect(() => {
    input.beforeMediaCleanupRef.current = stop;
    window.addEventListener("pagehide", stop);
    return () => {
      stop();
      if (input.beforeMediaCleanupRef.current === stop) input.beforeMediaCleanupRef.current = null;
      window.removeEventListener("pagehide", stop);
    };
  }, [input.beforeMediaCleanupRef, stop]);
  useEffect(() => {
    releaseRecordingSession(active, setOperationActive);
    setLoaded(null);
    setAutomaticState(false);
    setConsentAction(null);
    setStatus({ state: "idle" });
    consent.current = false;
    if (!scope || !input.accountId) return;
    let cancelled = false;
    void recordingClient(input.accountId)
      .settings()
      .then(({ preferences }) => {
        if (cancelled) return;
        consent.current = preferences.consentAccepted;
        setAutomaticState(preferences.automatic && preferences.consentAccepted);
        setKind(preferences.kind);
        setLoaded(scope);
      })
      .catch((error: Error) => {
        if (!cancelled) setStatus({ state: "error", error: error.message });
      });
    return () => {
      cancelled = true;
      stop();
    };
  }, [scope, input.accountId, stop]);

  const start = useCallback(async () => {
    const current = latest.current;
    if (
      active.current ||
      !current.scope ||
      !current.accountId ||
      current.call?.state !== "in-call" ||
      loaded !== current.scope
    )
      return;
    if (!consent.current) {
      setConsentAction("manual");
      return;
    }
    const client = recordingClient(current.accountId);
    let capture: ReturnType<typeof recordingStream> | undefined;
    let upload: ReturnType<typeof recordAndUpload> | undefined;
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        capture?.release();
      }
    };
    const session = {
      scope: current.scope,
      cancelled: false,
      stop() {
        session.cancelled = true;
        if (upload) upload.stop();
        else release();
      },
    };
    active.current = session;
    setOperationActive(true);
    setStatus({ state: "starting" });
    try {
      const mimeType = recordingMime(kind);
      capture = recordingStream(current.getAudio(), kind, () => latest.current.getTiles());
      const recorder = new MediaRecorder(capture.stream, {
        mimeType,
        audioBitsPerSecond: 64_000,
        ...(kind === "video" ? { videoBitsPerSecond: 1_500_000 } : {}),
      });
      const row = await client.start({
        sessionId: current.call.sessionId,
        title: current.title,
        kind,
        mimeType,
        consentAccepted: true,
      });
      if (
        session.cancelled ||
        latest.current.scope !== current.scope ||
        latest.current.call?.state !== "in-call"
      ) {
        release();
        await client.finish(row.id, 0, true);
        if (latest.current.scope === current.scope) setStatus({ state: "saved" });
        return;
      }
      upload = recordAndUpload(
        recorder,
        row,
        client,
        (progress) => {
          if (latest.current.scope === current.scope)
            setStatus({ state: progress.state, startedAt: progress.startedAt });
        },
        release,
      );
      const result = await upload.finished;
      if (latest.current.scope === current.scope) {
        if (result.error) setAutomaticState(false);
        // Unexpected native stop should not create an endless series of empty recordings.
        if (!session.cancelled && !result.segmentLimit) setAutomaticState(false);
        setStatus(result.error ? { state: "error", error: result.error } : { state: "saved" });
      }
      if (useStore.getState().accountId === current.accountId)
        useStore
          .getState()
          .showNotice(
            result.error ??
              "通話記録を保存しました。設定の「通話記録」から再生・ダウンロードできます",
          );
    } catch (error) {
      if (latest.current.scope === current.scope) {
        setAutomaticState(false);
        setStatus({
          state: "error",
          error: error instanceof Error ? error.message : "記録を開始できませんでした",
        });
      }
    } finally {
      release();
      if (active.current === session) {
        active.current = null;
        setOperationActive(false);
      }
    }
  }, [kind, loaded]);

  useEffect(() => {
    if (input.call?.state !== "in-call" || (automatic && !hasOthers)) stop();
    else if (automatic && loaded === scope && !active.current) void start();
  }, [
    automatic,
    hasOthers,
    input.call?.state,
    loaded,
    scope,
    start,
    status.state,
    operationActive,
    stop,
  ]);
  useEffect(() => {
    if (status.state !== "recording" || status.startedAt === undefined) return;
    const started = status.startedAt;
    const tick = () => setSeconds(Math.floor((performance.now() - started) / 1000));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [status.state, status.startedAt]);
  return {
    ...status,
    automatic,
    kind,
    seconds,
    ready: loaded === scope && scope !== null,
    busy: operationActive,
    waiting: automatic && !hasOthers,
    consentPrompt: consentAction !== null,
    setKind,
    setAutomatic(value: boolean) {
      if (value && !consent.current) {
        setConsentAction("automatic");
        return;
      }
      setConsentAction(null);
      setAutomaticState(value);
    },
    start: () => {
      setAutomaticState(false);
      void start();
    },
    acceptConsent: () => {
      const action = consentAction;
      if (!action) return;
      consent.current = true;
      setConsentAction(null);
      if (action === "automatic") setAutomaticState(true);
      else void start();
    },
    cancelConsent: () => setConsentAction(null),
    stop: () => {
      setAutomaticState(false);
      setConsentAction(null);
      stop();
    },
    stopForCallEnd: stop,
  };
}
