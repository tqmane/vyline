/**
 * CallController — 発信 UI（CallOverlay + useCall）と着信通知をアプリ全体に1つだけ配置する。
 */

import { useEffect } from "react";
import { useStore, displayName } from "@/lib/store";
import { useCall } from "@/hooks/useCall";
import { CallOverlay } from "@/components/call-overlay";
import { Avatar } from "@/components/vy-ui";
import { IconPhone, IconClose } from "@/components/icons";

export function CallController() {
  const accountId = useStore((s) => s.accountId);
  const chats = useStore((s) => s.chats);
  const streamerMode = useStore((s) => s.settings.streamerMode);
  const callRequest = useStore((s) => s.callRequest);
  const clearCallRequest = useStore((s) => s.clearCallRequest);
  const incomingCall = useStore((s) => s.incomingCall);
  const dismissIncomingCall = useStore((s) => s.dismissIncomingCall);
  const openChat = useStore((s) => s.openChat);
  const showNotice = useStore((s) => s.showNotice);
  const { call, startCall, endCall, setMuted } = useCall(accountId);

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
  // NOTIFIED_RECEIVED_CALL only proves param1=chatId. Do not display
  // param2/param3 as caller/type; LINE delivers those details via VoIP push.
  const incomingChat = incomingCall ? chats.find((c) => c.id === incomingCall.chatMid) : null;

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

      {incomingCall && (
        <div
          role="alert"
          className="vy-fade-in fixed left-1/2 top-4 z-[70] flex w-[min(26rem,calc(100vw-1.5rem))] -translate-x-1/2 items-center gap-3 rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface)] px-4 py-3 shadow-2xl"
        >
          <Avatar
            glyph={streamerMode ? "•" : (incomingChat?.avatar ?? "?")}
            color={incomingChat?.color ?? "#888"}
            size={40}
            imageUrl={streamerMode ? undefined : incomingChat?.avatarUrl}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">
              {incomingChat ? displayName(incomingChat, streamerMode) : "LINE 通話"}
            </p>
            <p className="flex items-center gap-1 text-xs text-[var(--vy-text-dim)]">
              <IconPhone size={13} />
              着信中 · 応答は LINE アプリから
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              openChat(incomingCall.chatMid);
              dismissIncomingCall();
            }}
            className="shrink-0 rounded-lg px-2 py-1 text-xs text-[var(--vy-accent)] transition-colors hover:bg-[var(--vy-surface-2)]"
          >
            トークを開く
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
