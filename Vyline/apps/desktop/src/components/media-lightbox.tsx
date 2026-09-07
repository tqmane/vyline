import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { IconClose } from "@/components/icons";
import { hideBrokenMedia } from "@/utils/lineMedia";

export function MediaLightbox({
  src,
  fullSrc,
  kind = "image",
  alt = "メディア",
  onClose,
}: {
  src: string;
  /** フル解像度（無ければ src） */
  fullSrc?: string;
  kind?: "image" | "video";
  alt?: string;
  onClose: () => void;
}) {
  const url = fullSrc || src.replace(/([?&])preview=1/, "$1preview=0").replace(/\?preview=0$/, "");
  const dialogRef = useRef<HTMLDialogElement>(null);

  useLayoutEffect(() => {
    const dialog = dialogRef.current!;
    dialog.showModal();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = prev;
    };
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <dialog
      ref={dialogRef}
      className="vy-fade-in fixed inset-0 m-0 flex h-dvh max-h-none w-screen max-w-none items-center justify-center border-0 bg-black/85 p-4 backdrop-blur-sm backdrop:bg-transparent"
      aria-label={alt}
      onClick={onClose}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="閉じる"
        className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
      >
        <IconClose size={20} />
      </button>
      <div
        className="vy-scale-in max-h-[90dvh] max-w-[min(960px,96vw)]"
        onClick={(e) => e.stopPropagation()}
      >
        {kind === "video" ? (
          <video src={url} controls autoPlay className="max-h-[92dvh] max-w-full bg-black" />
        ) : (
          <img
            src={url}
            alt={alt}
            onError={hideBrokenMedia}
            className="max-h-[92dvh] max-w-full object-contain"
          />
        )}
      </div>
    </dialog>,
    document.body,
  );
}
