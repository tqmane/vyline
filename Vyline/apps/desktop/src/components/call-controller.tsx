import { NativeControllerSurface } from "@/ui/native-controller-surface";
import { publishControllerCall } from "@/ui/controller-call";
import { isComposeMode, useDesignSystemStore } from "@/ui/design-system-store";
/**
 * CallController — 発信 UI（CallOverlay + useCall）と着信通知をアプリ全体に1つだけ配置する。
 */

import { useEffect, useMemo, useState } from "react";
import { useStore, displayName } from "@/lib/store";
import { api } from "@/api/client";
import { useCall } from "@/hooks/useCall";
import { useCallVideo } from "@/hooks/useCallVideo";
import { useCallRecording } from "@/hooks/useCallRecording";
import { CallRecordingControls } from "@/components/call-recording-controls";
import { CallPanel } from "@/components/call-panel";
import { CallOverlay } from "@/components/call-overlay";
import { Avatar } from "@/components/vy-ui";
import { IconClose } from "@/components/icons";
import { CallIcon } from "@/ui/call-icon";

export function CallController() {
  const mode = useDesignSystemStore((state) => state.mode);
  const accountId = useStore((s) => s.accountId);
  const chats = useStore((s) => s.chats);
  const streamerMode = useStore((s) => s.settings.streamerMode);
  const callRequest = useStore((s) => s.callRequest);
  const clearCallRequest = useStore((s) => s.clearCallRequest);
  const incomingCall = useStore((s) => s.incomingCall);
  const self = useStore((s) => s.self);
  const selfMid = self?.mid;
  const dismissIncomingCall = useStore((s) => s.dismissIncomingCall);
  const showNotice = useStore((s) => s.showNotice);
  const {
    call,
    startCall,
    answerCall,
    endCall,
    setMuted,
    getRecordingAudioTap,
    beforeMediaCleanupRef,
  } = useCall(accountId);
  const video = useCallVideo(accountId, call);
  const [callerProfile, setCallerProfile] = useState<{
    displayName?: string;
    thumbnailUrl?: string;
  } | null>(null);

  // CANCEL 取りこぼし時も「着信中」が残り続けないよう、受信から一定時間で自動消去
  //（store の pollIncoming 側の expiry と二重化。ポーリング停止時も UI が残らない）。
  useEffect(() => {
    if (!incomingCall || call) return;
    const elapsed = Date.now() - incomingCall.receivedAt;
    const ttl = 90_000 - elapsed;
    if (ttl <= 0) {
      dismissIncomingCall();
      showNotice("着信は終了しました");
      return;
    }
    const t = setTimeout(() => {
      dismissIncomingCall();
      showNotice("着信は終了しました");
    }, ttl);
    return () => clearTimeout(t);
  }, [incomingCall, call, dismissIncomingCall, showNotice]);

  useEffect(() => {
    if (!callRequest) return;
    clearCallRequest();
    if (call) {
      showNotice("すでに通話中です");
      return;
    }
    void startCall(callRequest.to, callRequest.kind, callRequest.joinOnly).then((res) => {
      if (!res?.ok) showNotice(res?.error ?? "発信に失敗しました");
    });
  }, [call, callRequest, clearCallRequest, showNotice, startCall]);

  const peer = call ? chats.find((c) => c.id === call.to) : null;
  const participants = useMemo(() => {
    if (!call?.to.startsWith("c")) return;
    const members = new Map(peer?.members?.map((member) => [member.id, member]) ?? []);
    const friends = new Map(chats.map((chat) => [chat.id, chat]));
    return (call.participants ?? []).map((participant, index) => {
      const isSelf = participant.mid === self?.mid;
      const member = members.get(participant.mid);
      const friend = friends.get(participant.mid);
      return {
        id: participant.mid,
        hasVideoStream: participant.hasVideoStream,
        self: isSelf,
        name: isSelf
          ? "自分"
          : streamerMode
            ? `参加者 ${index + 1}`
            : friend
              ? displayName(friend, false)
              : member?.name || "LINEユーザー",
        glyph: streamerMode
          ? "•"
          : isSelf
            ? self.avatar
            : (member?.avatar ?? friend?.avatar ?? "?"),
        color: member?.color ?? friend?.color ?? "var(--vy-accent)",
        imageUrl: streamerMode
          ? undefined
          : isSelf
            ? self.avatarUrl
            : (member?.avatarUrl ?? friend?.avatarUrl),
      };
    });
  }, [call?.to, call?.participants, chats, peer?.members, self, streamerMode]);
  const callName = peer
    ? displayName(peer, streamerMode)
    : call?.to.startsWith("c")
      ? "グループ通話"
      : "LINEユーザー";
  const recording = useCallRecording({
    accountId,
    call,
    selfMid,
    title: callName,
    getAudio: getRecordingAudioTap,
    beforeMediaCleanupRef,
    getTiles: () => [
      { name: "自分", image: video.localEnabled ? video.localRef.current : null },
      ...(participants
        ? participants
            .filter((p) => !p.self)
            .map((p) => ({
              name: p.name,
              image: video.remoteImages.has(p.id)
                ? video.remoteCanvasesRef.current.get(p.id)
                : null,
            }))
        : [{ name: callName, image: video.hasImage ? video.remoteRef.current : null }]),
    ],
  });
  const caller = incomingCall ? chats.find((c) => c.id === incomingCall.callerMid) : null;
  useEffect(() => {
    setCallerProfile(null);
    if (!incomingCall || caller || !accountId || streamerMode) return;
    if (!incomingCall.callerMid.startsWith("u")) return;
    let cancelled = false;
    void api.line
      .contactProfile(accountId, incomingCall.callerMid)
      .then((res) => {
        if (cancelled || !res.ok || !res.profile) return;
        setCallerProfile({
          displayName: res.profile.displayName || undefined,
          thumbnailUrl: res.profile.thumbnailUrl || undefined,
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [accountId, caller, incomingCall, streamerMode]);
  const callerName = caller
    ? displayName(caller, streamerMode)
    : streamerMode
      ? "LINEユーザー"
      : callerProfile?.displayName || "LINEユーザー";
  const callerGlyph = caller?.avatar ?? callerProfile?.displayName?.trim().slice(0, 1) ?? "?";
  const callerImageUrl = caller?.avatarUrl ?? callerProfile?.thumbnailUrl;
  const closeCall = () => {
    recording.stopForCallEnd();
    video.stopVideo();
    void endCall();
  };

  const presentation = (
    <>
      {call && (
        <CallPanel
          name={callName}
          onClose={closeCall}
          recordingSummary={
            recording.state === "recording"
              ? `${recording.kind === "audio" ? "録音" : "録画"}中 · ${Math.floor(recording.seconds / 60)}:${String(recording.seconds % 60).padStart(2, "0")}`
              : recording.state === "saving"
                ? "記録を保存中…"
                : recording.error
          }
        >
          <CallOverlay
            modal={false}
            kind={call.kind}
            name={callName}
            glyph={streamerMode ? "•" : (peer?.avatar ?? "?")}
            color={peer?.color ?? "#888"}
            imageUrl={streamerMode ? undefined : peer?.avatarUrl}
            state={call.state}
            error={call.error}
            transport={call.transport}
            onClose={closeCall}
            onMutedChange={setMuted}
            video={video}
            participants={participants}
            recordingControls={
              <CallRecordingControls recording={recording} connected={call.state === "in-call"} />
            }
          />
        </CallPanel>
      )}

      {incomingCall && !call && !callRequest && incomingCall.callerMid !== selfMid && (
        <div
          role="alert"
          className="vy-fade-in fixed left-1/2 top-4 z-[70] flex w-[min(26rem,calc(100vw-1.5rem))] -translate-x-1/2 items-center gap-3 rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface)] px-4 py-3 shadow-2xl"
        >
          <div className="contents" data-native-call-summary data-call-name={callerName}
            data-call-glyph={streamerMode ? "•" : callerGlyph} data-call-avatar={streamerMode ? undefined : callerImageUrl}
            data-call-status={incomingCall.callType === "video" ? "ビデオ通話の着信" : "音声通話の着信"}>
          <Avatar
            glyph={streamerMode ? "•" : callerGlyph}
            color={caller?.color ?? "#888"}
            size={40}
            imageUrl={streamerMode ? undefined : callerImageUrl}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{callerName}</p>
            <p className="flex items-center gap-1 text-xs text-[var(--vy-text-dim)]">
              {incomingCall.callType === "video" ? (
                <CallIcon name="video" size={13} />
              ) : (
                <CallIcon name="phone" size={13} />
              )}
              着信中
            </p>
          </div>
          </div>
          <button
            type="button"
            onClick={() => {
              const current = incomingCall;
              void answerCall(
                current.callMid,
                current.callerMid,
                current.callType === "video" ? "video" : "voice",
              ).then((res) => {
                if (res?.ok) dismissIncomingCall();
                else showNotice(res?.error ?? "着信への応答に失敗しました");
              });
            }}
            className="vy-touch-target shrink-0 rounded-lg bg-[var(--vy-accent)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
          >
            応答
          </button>
          <button
            type="button"
            onClick={dismissIncomingCall}
            aria-label="着信通知を閉じる"
            data-native-caption="閉じる"
            className="vy-touch-target flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--vy-text-dim)] transition-colors hover:bg-[var(--vy-surface-2)] hover:text-[var(--vy-text)]"
          >
            <span data-call-icon="close"><IconClose size={16} /></span>
          </button>
        </div>
      )}
    </>
  );
  if (call || incomingCall && !callRequest && incomingCall.callerMid !== selfMid) {
    return <NativeControllerSurface key={call?.sessionId ?? incomingCall?.callMid} persistent native={isComposeMode(mode)}
      onSnapshot={(snapshot, retiredId) => publishControllerCall(accountId, snapshot, retiredId)}
      title={call ? `${callName}との通話` : "着信"} onClose={call ? closeCall : dismissIncomingCall}>{presentation}</NativeControllerSurface>;
  }
  return presentation;

}
