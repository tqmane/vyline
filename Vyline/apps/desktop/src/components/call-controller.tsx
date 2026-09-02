/**
 * CallController — 発信 UI（CallOverlay + useCall）と着信通知をアプリ全体に1つだけ配置する。
 */

import { useEffect } from "react";
import { useStore, displayName } from "@/lib/store";
import { useCall } from "@/hooks/useCall";
import { CallOverlay } from "@/components/call-overlay";
import { Avatar } from "@/components/vy-ui";
import { IconPhone, IconVideo, IconClose } from "@/components/icons";

export function CallController() {
  const accountId = useStore((s) => s.accountId);
  const chats = useStore((s) => s.chats);
  const streamerMode = useStore((s) => s.settings.streamerMode);
  const callRequest = useStore((s) => s.callRequest);
  const clearCallRequest = useStore((s) => s.clearCallRequest);
  const incomingCall = useStore((s) => s.incomingCall);
  const dismissIncomingCall = useStore((s) => s.dismissIncomingCall);
  const showNotice = useStore((s) => s.showNotice);
  const { call, startCall, answerCall, endCall, setMuted } = useCall(accountId);

  useEffect(() => {
    if (!callRequest) return;
    clearCallRequest();
    if (call) {
      showNotice("すでに通話中です");
      return;
    }
    void startCall(callRequest.to, callRequest.kind).then((res) => {
      if (!res?.ok) showNotice(res?.error ?? "発信に失敗しました");
    });
  }, [call, callRequest, clearCallRequest, showNotice, startCall]);

  const peer = call ? chats.find((c) => c.id === call.to) : null;
  const caller = incomingCall ? chats.find((c) => c.id === incomingCall.callerMid) : null;

  return (
    <>
      {call && (
        <CallOverlay
          kind={call.kind}
          name={peer ? displayName(peer, streamerMode) : call.to}
          glyph={streamerMode ? "•" : (peer?.avatar ?? "?")}
          color={peer?.color ?? "#888"}
          imageUrl={streamerMode ? undefined : peer?.avatarUrl}
          state={call.state}
          error={call.error}
          transport={call.transport}
          onClose={() => void endCall()}
          onMutedChange={setMuted}
        />
      )}

      {incomingCall && !call && (
        <div
          role="alert"
          className="vy-fade-in fixed left-1/2 top-4 z-[70] flex w-[min(26rem,calc(100vw-1.5rem))] -translate-x-1/2 items-center gap-3 rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface)] px-4 py-3 shadow-2xl"
        >
          <Avatar
            glyph={streamerMode ? "•" : (caller?.avatar ?? "?")}
            color={caller?.color ?? "#888"}
            size={40}
            imageUrl={streamerMode ? undefined : caller?.avatarUrl}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">
              {caller ? displayName(caller, streamerMode) : incomingCall.callerMid}
            </p>
            <p className="flex items-center gap-1 text-xs text-[var(--vy-text-dim)]">
              {incomingCall.callType === "video" ? (
                <IconVideo size={13} />
              ) : (
                <IconPhone size={13} />
              )}
              着信中
            </p>
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
            className="vy-touch-target flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--vy-text-dim)] transition-colors hover:bg-[var(--vy-surface-2)] hover:text-[var(--vy-text)]"
          >
            <IconClose size={16} />
          </button>
        </div>
      )}
    </>
  );
}
