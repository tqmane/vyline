import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { fileExtensionLabel, formatFileSize, isExternalFileDrag } from "@/lib/fileDrop";
import {
  IconBellOff,
  IconClose,
  IconPaperclip,
  IconPhoto,
  IconPlay,
  IconPlus,
  IconSend,
  IconTrash,
} from "@/components/icons";

export type PendingMediaItem = {
  id: string;
  file: File;
  url: string;
  kind: "image" | "video" | "file";
};

type MediaSendModalProps = {
  items: PendingMediaItem[];
  caption: string;
  onCaptionChange: (value: string) => void;
  compressImages: boolean;
  onCompressImagesChange: (compress: boolean) => void;
  sendAsFiles: boolean;
  onSendAsFilesChange: (asFiles: boolean) => void;
  mute: boolean;
  onMuteChange: (mute: boolean) => void;
  sending: boolean;
  enterToSend: boolean;
  onAddFiles: (files: File[], forceFile?: boolean) => void;
  onPickMore: (kind: "media" | "file") => void;
  onRemove: (id: string) => void;
  onCancel: () => void;
  onSend: () => void;
};

export function MediaSendModal({
  items,
  caption,
  onCaptionChange,
  compressImages,
  onCompressImagesChange,
  sendAsFiles,
  onSendAsFilesChange,
  mute,
  onMuteChange,
  sending,
  enterToSend,
  onAddFiles,
  onPickMore,
  onRemove,
  onCancel,
  onSend,
}: MediaSendModalProps) {
  const captionRef = useRef<HTMLTextAreaElement>(null);
  const [modalDragging, setModalDragging] = useState(false);
  const dragDepthRef = useRef(0);

  const hasImages = items.some((item) => item.kind === "image");
  const hasVisualMedia = items.some((item) => item.kind === "image" || item.kind === "video");

  const title = (() => {
    if (items.length === 1) {
      if (sendAsFiles || items[0]!.kind === "file") return "ファイルを送信";
      return items[0]!.kind === "video" ? "動画を送信" : "写真を送信";
    }
    if (sendAsFiles) return `${items.length} 件のファイルを送信`;
    if (items.every((item) => item.kind === "image")) return `${items.length} 枚の写真を送信`;
    return `${items.length} 件のメディアを送信`;
  })();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !sending) {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel, sending]);

  useEffect(() => {
    const el = captionRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [caption]);

  useEffect(() => {
    requestAnimationFrame(() => captionRef.current?.focus());
  }, []);

  const totalBytes = items.reduce((sum, item) => sum + (item.file.size || 0), 0);

  return createPortal(
    <div
      className="vy-viewport-overlay vy-fade-in z-50 flex items-center justify-center bg-black/65 p-3 backdrop-blur-sm md:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !sending) onCancel();
      }}
    >
      <div
        className={cn(
          "vy-scale-in relative flex max-h-[min(90dvh,720px)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border bg-[var(--vy-surface)] text-[var(--vy-text)] shadow-2xl transition-colors",
          modalDragging ? "border-[var(--vy-accent)] ring-2 ring-[var(--vy-accent)]" : "border-[var(--vy-border)]",
        )}
        onDragEnter={(event) => {
          if (!isExternalFileDrag(event.dataTransfer)) return;
          event.preventDefault();
          event.stopPropagation();
          dragDepthRef.current += 1;
          setModalDragging(true);
        }}
        onDragOver={(event) => {
          if (!isExternalFileDrag(event.dataTransfer)) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={(event) => {
          if (!isExternalFileDrag(event.dataTransfer)) return;
          event.preventDefault();
          event.stopPropagation();
          dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
          if (dragDepthRef.current === 0) setModalDragging(false);
        }}
        onDrop={(event) => {
          if (!isExternalFileDrag(event.dataTransfer)) return;
          event.preventDefault();
          event.stopPropagation();
          dragDepthRef.current = 0;
          setModalDragging(false);
          const dropped = Array.from(event.dataTransfer.files ?? []);
          if (dropped.length > 0 && !sending) onAddFiles(dropped, sendAsFiles);
        }}
      >
        <header className="flex items-center justify-between gap-3 border-b border-[var(--vy-border)] px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">{title}</h2>
            <p className="text-[0.7rem] text-[var(--vy-text-dim)]">
              合計 {formatFileSize(totalBytes)} ・ ドラッグ&ドロップでさらに追加可能
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={sending}
              onClick={() => onPickMore(sendAsFiles ? "file" : "media")}
              className="flex items-center gap-1 rounded-full border border-[var(--vy-border)] bg-[var(--vy-surface-2)] px-3 py-1.5 text-xs font-medium text-[var(--vy-text)] transition-colors hover:border-[var(--vy-accent)] hover:text-[var(--vy-accent)] disabled:opacity-50"
            >
              <IconPlus size={14} />
              追加
            </button>
            <button
              type="button"
              disabled={sending}
              onClick={onCancel}
              aria-label="閉じる"
              className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--vy-text-dim)] transition-colors hover:bg-[var(--vy-surface-2)] hover:text-[var(--vy-text)] disabled:opacity-40"
            >
              <IconClose size={18} />
            </button>
          </div>
        </header>

        <div className="vy-scroll min-h-0 flex-1 overflow-y-auto p-4">
          {items.length === 1 && !sendAsFiles && items[0]!.kind !== "file" ? (
            <div className="relative flex items-center justify-center overflow-hidden rounded-xl border border-[var(--vy-border)] bg-black/30">
              {items[0]!.kind === "video" ? (
                <video
                  src={items[0]!.url}
                  controls
                  preload="metadata"
                  className="max-h-[300px] w-full object-contain"
                />
              ) : (
                <img
                  src={items[0]!.url}
                  alt={items[0]!.file.name}
                  className="max-h-[300px] w-full object-contain"
                />
              )}
              <button
                type="button"
                disabled={sending}
                onClick={() => onRemove(items[0]!.id)}
                aria-label={`${items[0]!.file.name} を削除`}
                className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/65 text-white transition hover:bg-black/85 disabled:opacity-40"
              >
                <IconClose size={14} />
              </button>
              <div className="pointer-events-none absolute bottom-2 left-2 rounded-md bg-black/65 px-2 py-0.5 text-[0.7rem] text-white">
                {items[0]!.file.name} ({formatFileSize(items[0]!.file.size)})
              </div>
            </div>
          ) : (
            <div
              className={cn(
                "grid gap-2.5",
                sendAsFiles || items.every((item) => item.kind === "file")
                  ? "grid-cols-1"
                  : items.length === 2
                    ? "grid-cols-2"
                    : "grid-cols-2 sm:grid-cols-3",
              )}
            >
              {items.map((item) => {
                const asFileCard = sendAsFiles || item.kind === "file";
                if (asFileCard) {
                  return (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface-2)] p-2.5"
                    >
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_oklab,var(--vy-accent)_16%,transparent)] text-[0.68rem] font-bold tracking-tight text-[var(--vy-accent)]">
                        {fileExtensionLabel(item.file.name)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{item.file.name || "ファイル"}</p>
                        <p className="text-[0.7rem] text-[var(--vy-text-dim)]">
                          {formatFileSize(item.file.size)}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={sending}
                        onClick={() => onRemove(item.id)}
                        aria-label={`${item.file.name} を削除`}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--vy-text-dim)] transition-colors hover:bg-[var(--vy-surface)] hover:text-[var(--vy-danger)] disabled:opacity-40"
                      >
                        <IconTrash size={15} />
                      </button>
                    </div>
                  );
                }

                return (
                  <div
                    key={item.id}
                    className="group relative aspect-square overflow-hidden rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface-2)]"
                  >
                    {item.kind === "video" ? (
                      <>
                        <video
                          src={item.url}
                          muted
                          preload="metadata"
                          className="h-full w-full object-cover"
                        />
                        <span className="pointer-events-none absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/65 px-2 py-0.5 text-[0.65rem] font-medium text-white">
                          <IconPlay size={11} />
                          動画
                        </span>
                      </>
                    ) : (
                      <img
                        src={item.url}
                        alt={item.file.name}
                        className="h-full w-full object-cover"
                      />
                    )}
                    <button
                      type="button"
                      disabled={sending}
                      onClick={() => onRemove(item.id)}
                      aria-label={`${item.file.name} を削除`}
                      className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/65 text-white transition hover:bg-black/85 disabled:opacity-40"
                    >
                      <IconClose size={12} />
                    </button>
                    <span className="pointer-events-none absolute inset-x-1.5 bottom-1.5 truncate rounded-md bg-black/60 px-1.5 py-0.5 text-[0.65rem] text-white">
                      {formatFileSize(item.file.size)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface-2)]/70 px-3 py-2 text-xs">
            {hasVisualMedia && (
              <label className="flex cursor-pointer items-center gap-2 select-none">
                <input
                  type="checkbox"
                  checked={sendAsFiles}
                  disabled={sending}
                  onChange={(e) => onSendAsFilesChange(e.target.checked)}
                  className="h-4 w-4 rounded accent-[var(--vy-accent)]"
                />
                <IconPaperclip size={14} className="text-[var(--vy-text-dim)]" />
                <span>ファイルとして送信（無圧縮）</span>
              </label>
            )}
            {hasImages && !sendAsFiles && (
              <label className="flex cursor-pointer items-center gap-2 select-none">
                <input
                  type="checkbox"
                  checked={compressImages}
                  disabled={sending}
                  onChange={(e) => onCompressImagesChange(e.target.checked)}
                  className="h-4 w-4 rounded accent-[var(--vy-accent)]"
                />
                <IconPhoto size={14} className="text-[var(--vy-text-dim)]" />
                <span>画像を圧縮して高速送信</span>
              </label>
            )}
            <button
              type="button"
              disabled={sending}
              onClick={() => onMuteChange(!mute)}
              aria-pressed={mute}
              className={cn(
                "ml-auto flex items-center gap-1 rounded-full px-2.5 py-1 text-xs transition-colors",
                mute
                  ? "bg-[color-mix(in_oklab,var(--vy-accent)_18%,transparent)] font-medium text-[var(--vy-accent)]"
                  : "text-[var(--vy-text-dim)] hover:bg-[var(--vy-surface)] hover:text-[var(--vy-text)]",
              )}
            >
              <IconBellOff size={13} />
              <span>{mute ? "ミュート送信 ON" : "通知あり"}</span>
            </button>
          </div>
        </div>

        <footer className="border-t border-[var(--vy-border)] bg-[var(--vy-surface)] px-4 py-3">
          <div className="flex items-end gap-2 rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface-2)] px-3 py-2 focus-within:border-[var(--vy-accent)]">
            <textarea
              ref={captionRef}
              rows={1}
              value={caption}
              disabled={sending}
              onChange={(e) => onCaptionChange(e.target.value)}
              onKeyDown={(e) => {
                const composing = e.nativeEvent.isComposing || e.keyCode === 229;
                if (composing || sending) return;
                if (
                  e.key === "Enter" &&
                  ((enterToSend && !e.shiftKey) || e.ctrlKey || e.metaKey)
                ) {
                  e.preventDefault();
                  onSend();
                }
              }}
              placeholder="コメントを追加（任意）"
              aria-label="メディアと一緒に送信するコメント"
              className="vy-scroll max-h-28 w-full resize-none bg-transparent text-sm leading-relaxed outline-none placeholder:text-[var(--vy-text-dim)]"
            />
          </div>
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={sending}
              onClick={onCancel}
              className="rounded-full border border-[var(--vy-border)] px-4 py-1.5 text-xs font-medium text-[var(--vy-text-dim)] transition-colors hover:bg-[var(--vy-surface-2)] hover:text-[var(--vy-text)] disabled:opacity-40"
            >
              キャンセル
            </button>
            <button
              type="button"
              disabled={sending || items.length === 0}
              onClick={onSend}
              className="flex items-center gap-1.5 rounded-full bg-[var(--vy-accent)] px-5 py-1.5 text-xs font-semibold text-[var(--vy-accent-contrast)] shadow-sm transition-transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-60"
            >
              <IconSend size={14} />
              <span>{sending ? "送信中…" : `送信 (${items.length}件)`}</span>
            </button>
          </div>
        </footer>

        {modalDragging && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-[color-mix(in_oklab,var(--vy-accent)_16%,rgba(0,0,0,0.45))] backdrop-blur-[2px]">
            <div className="rounded-2xl border-2 border-dashed border-[var(--vy-accent)] bg-[var(--vy-surface)]/95 px-6 py-4 text-center shadow-xl">
              <p className="text-sm font-semibold text-[var(--vy-text)]">
                ドロップして送信リストに追加
              </p>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
