import { useLayoutEffect, useRef, type ReactNode } from "react";
import { IconClose } from "@/components/icons";

export function ActionDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current!;
    // The native top layer escapes transformed chat parents and manages focus/inertness.
    dialog.showModal();
    return () => dialog.close();
  }, []);
  const close = () => {
    ref.current?.close();
    onClose();
  };

  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          close();
      }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-hidden rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface)] p-0 text-[var(--vy-text)] shadow-xl backdrop:bg-black/50"
    >
      <div className="flex max-h-[calc(100dvh-2rem-2px)] flex-col">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--vy-border)] px-4 py-2">
          <h3 className="line-clamp-2 min-w-0 break-words text-sm font-semibold">{title}</h3>
          <button
            type="button"
            onClick={close}
            aria-label="閉じる"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded text-[var(--vy-text-dim)] hover:bg-[var(--vy-surface-2)]"
          >
            <IconClose size={16} />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain px-4 py-3 text-sm">
          {children}
        </div>
      </div>
    </dialog>
  );
}
