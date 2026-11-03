export type AlbumEntry = { id: string; title: string };
export type AlbumPhoto = { id: string; oid: string; sid: "a" | "o" | "v"; kind: "image" | "video" };
export type AlbumPage<T> = { items: T[]; cursor: string | null; hasMore: boolean };
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const id = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value) : "";

function result(value: unknown) {
  const root = record(value);
  if (root.ok === false || (root.code !== undefined && Number(root.code) !== 0))
    throw new Error(id(root.error ?? root.message) || "アルバムを読み込めませんでした");
  return root.result === undefined ? root : record(root.result);
}
function page<T>(body: Record<string, unknown>, items: T[]): AlbumPage<T> {
  const cursor = id(body.nextCursor ?? body.cursor) || null;
  if (body.hasMore === true && !cursor) throw new Error("アルバムの応答が正しくありません");
  return { items, cursor, hasMore: Boolean(cursor) && body.hasMore !== false };
}

export function albumListPage(value: unknown): AlbumPage<AlbumEntry> {
  const body = result(value);
  const items = body.albums ?? body.items ?? body.albumList;
  if (!Array.isArray(items)) throw new Error("アルバムの応答が正しくありません");
  return page(body, items.flatMap(value => {
    const item = record(value);
    const albumId = id(item.albumId ?? item.cafeId ?? item.id);
    return albumId ? [{ id: albumId, title: id(item.title ?? item.name) || "アルバム" }] : [];
  }));
}

export function albumPhotosPage(value: unknown): AlbumPage<AlbumPhoto> {
  const body = result(value);
  if (!Array.isArray(body.photos)) throw new Error("アルバムの応答が正しくありません");
  return page(body, body.photos.flatMap(value => {
    const item = record(value);
    const resource = record(item.obsResourceId);
    const oid = id(resource.oid ?? item.oid);
    if (!oid) return [];
    if (resource.svc !== undefined && resource.svc !== "album") throw new Error("アルバムのメディアを読み込めませんでした");
    const video = String(item.resourceType).toUpperCase() === "VIDEO" || String(item.resourceType).toLowerCase() === "v" || resource.sid === "v";
    const sid = resource.sid === "o" ? "o" : video ? "v" : "a";
    return [{ id: id(item.photoId ?? item.id) || oid, oid, sid, kind: video ? "video" : "image" } satisfies AlbumPhoto];
  }));
}

export function mergeAlbumPage<T extends { id: string }>(previous: T[], incoming: T[]): T[] {
  return [...new Map([...previous, ...incoming].map(item => [item.id, item])).values()];
}
