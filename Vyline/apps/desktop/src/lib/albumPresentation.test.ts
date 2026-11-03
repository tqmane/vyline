import { expect, test } from "bun:test";
import { albumListPage, albumPhotosPage, mergeAlbumPage } from "./albumPresentation";
import { albumMediaUrl } from "../api/album";

test("Android 26.13 album IDs and legacy notification cafeId remain strings; cursor/hasMore are preserved", () => {
  expect(albumListPage({ code: 0, result: { albums: [{ albumId: "9000000123", title: "Fixture album" }], cursor: "next", hasMore: true } })).toEqual({ items: [{ id: "9000000123", title: "Fixture album" }], cursor: "next", hasMore: true });
  expect(albumListPage({ albumList: [{ cafeId: 123, name: "Legacy fixture" }] }).items[0]?.id).toBe("123");
  expect(albumListPage({ result: { albums: [], cursor: "old", hasMore: false } }).hasMore).toBe(false);
});
test("photoId is distinct from OBS oid; Android VIDEO and IMAGE_ORIGINAL preserve their sid", () => {
  const page = albumPhotosPage({ result: { photos: [
    { photoId: "photo-1", obsResourceId: { svc: "album", sid: "a", oid: "object/one" }, resourceType: "IMAGE" },
    { photoId: "photo-2", obsResourceId: { svc: "album", sid: "v", oid: "video-oid" }, resourceType: "VIDEO" },
    { photoId: "photo-3", obsResourceId: { svc: "album", sid: "o", oid: "original-oid" }, resourceType: "IMAGE_ORIGINAL" },
  ], nextCursor: "next-photo", hasMore: true } });
  expect(page.items).toEqual([
    { id: "photo-1", oid: "object/one", sid: "a", kind: "image" },
    { id: "photo-2", oid: "video-oid", sid: "v", kind: "video" },
    { id: "photo-3", oid: "original-oid", sid: "o", kind: "image" },
  ]);
  const url = new URL(albumMediaUrl("account/fixture", "c-chat", "9000000123", page.items[0]!, true), "http://127.0.0.1");
  expect(url.pathname).toContain("account%2Ffixture/albums/9000000123/media/object%2Fone");
  expect(Object.fromEntries(url.searchParams)).toEqual({ chatId: "c-chat", mediaType: "image", sid: "a", full: "1" });
});
test("failures never masquerade as empty albums and malformed pagination cannot loop", () => {
  expect(() => albumListPage({ ok: false, error: "denied" })).toThrow("denied");
  expect(() => albumPhotosPage({ code: 403, message: "denied" })).toThrow("denied");
  expect(() => albumPhotosPage({ result: { photos: [], hasMore: true } })).toThrow();
  expect(() => albumPhotosPage({ result: { photos: [{ oid: "x", obsResourceId: { svc: "other" } }] } })).toThrow();
  expect(albumPhotosPage({ result: { photos: [], hasMore: false } }).items).toEqual([]);
  expect(mergeAlbumPage([{ id: "one", title: "first" }], [{ id: "one", title: "fresh" }, { id: "two", title: "next" }])).toEqual([{ id: "one", title: "fresh" }, { id: "two", title: "next" }]);
});
