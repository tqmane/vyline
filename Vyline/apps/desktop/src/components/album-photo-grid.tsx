import { useState } from "react";
import { MediaLightbox } from "./media-lightbox";
import { albumMediaUrl } from "../api/album";
import type { AlbumPhoto } from "../lib/albumPresentation";

export function AlbumPhotoGrid({ accountId, chatId, albumId, photos, loading, onDelete }: { accountId: string; chatId: string; albumId: string; photos: AlbumPhoto[]; loading: boolean; onDelete?: (photoId: string) => void }) {
  const [zoom, setZoom] = useState<AlbumPhoto | null>(null);
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const [retries, setRetries] = useState<Record<string, number>>({});
  return <>
    <div className="mt-3 grid max-h-64 grid-cols-3 gap-2 overflow-y-auto rounded-lg border border-[var(--vy-border)] p-2">
      {!photos.length && <p role="status" className="col-span-3 py-4 text-center text-xs text-[var(--vy-text-dim)]">{loading ? "読み込み中…" : "写真がありません"}</p>}
      {photos.map((photo, index) => <div key={photo.id} className="relative">
        {photo.kind === "video" && !failed[photo.id] ? <video src={`${albumMediaUrl(accountId, chatId, albumId, photo, true)}${retries[photo.id] ? `&retry=${retries[photo.id]}` : ""}`} controls preload="none" playsInline onError={() => setFailed(previous => ({ ...previous, [photo.id]: true }))} className="aspect-square w-full rounded-md object-cover" /> : null}
        {failed[photo.id] ? <button type="button" aria-label={photo.kind === "video" ? "動画を再読み込み" : "写真を再読み込み"} onClick={() => { setFailed(previous => ({ ...previous, [photo.id]: false })); setRetries(previous => ({ ...previous, [photo.id]: (previous[photo.id] ?? 0) + 1 })); }} className="w-full p-2 text-xs">読み込めませんでした · 再読み込み</button> : <button type="button" aria-label={photo.kind === "video" ? "動画を表示" : "写真を表示"} onClick={() => setZoom(photo)} className="w-full rounded-md">
          {photo.kind === "video" ? "動画を表示" : <img src={`${albumMediaUrl(accountId, chatId, albumId, photo)}${retries[photo.id] ? `&retry=${retries[photo.id]}` : ""}`} alt="アルバム写真" loading="lazy" onError={() => setFailed(previous => ({ ...previous, [photo.id]: true }))} className="aspect-square w-full rounded-md object-cover" />}
        </button>}
        {onDelete && <button type="button" disabled={loading} aria-label={`写真 ${index + 1} を削除`} onClick={() => onDelete(photo.id)} className="absolute right-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">削除</button>}
      </div>)}
    </div>
    {zoom && <MediaLightbox src={albumMediaUrl(accountId, chatId, albumId, zoom, true)} kind={zoom.kind} alt="アルバム写真" onClose={() => setZoom(null)} />}
  </>;
}
