import { captureBackendFetch } from "./client";
import { albumListPage, albumPhotosPage, type AlbumPhoto } from "../lib/albumPresentation";

async function read(accountId: string, chatId: string, albumId: string | null, cursor: string | null, signal: AbortSignal) {
  if (!accountId || !chatId || albumId === "") throw new Error("アルバムを読み込めませんでした");
  const query = new URLSearchParams({ chatId, ...(cursor ? { cursor } : {}), ...(albumId ? { pageSize: "100" } : {}) });
  const response = await captureBackendFetch()(`/line/${encodeURIComponent(accountId)}/albums${albumId ? `/${encodeURIComponent(albumId)}/photos` : ""}?${query}`, { signal });
  const value = await response.json() as { error?: string };
  if (!response.ok) throw new Error(value.error || "アルバムを読み込めませんでした");
  const next = albumId ? albumPhotosPage(value) : albumListPage(value);
  if (next.hasMore && next.cursor === cursor) throw new Error("アルバムの応答が正しくありません");
  return value;
}
export async function readAlbumList(accountId: string, chatId: string, cursor: string | null, signal: AbortSignal) {
  return albumListPage(await read(accountId, chatId, null, cursor, signal));
}
export async function readAlbumPhotos(accountId: string, chatId: string, albumId: string, cursor: string | null, signal: AbortSignal) {
  return albumPhotosPage(await read(accountId, chatId, albumId, cursor, signal));
}
export function albumMediaUrl(accountId: string, chatId: string, albumId: string, photo: AlbumPhoto, full = false) {
  const query = new URLSearchParams({ chatId, mediaType: photo.kind, sid: photo.sid, ...(full ? { full: "1" } : {}) });
  return `/api/line/${encodeURIComponent(accountId)}/albums/${encodeURIComponent(albumId)}/media/${encodeURIComponent(photo.oid)}?${query}`;
}
