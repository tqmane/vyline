import { useEffect, useRef, useState } from "react";
import { useStore } from "../lib/store";
import { captureAccountContext } from "../lib/accountContext";
import { mergeAlbumPage, type AlbumEntry, type AlbumPhoto } from "../lib/albumPresentation";
import { readAlbumList, readAlbumPhotos } from "../api/album";

export function useAlbumBrowser(accountId: string, chatId: string, initialAlbumId: string, onClose: () => void) {
  const [albums, setAlbums] = useState<AlbumEntry[]>([]);
  const [photos, setPhotos] = useState<AlbumPhoto[]>([]);
  const [selectedId, setSelectedId] = useState(initialAlbumId);
  const [error, setError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const listAppend = useRef(false);
  const photoAppend = useRef(false);
  const [listCursor, setListCursor] = useState<string | null>(null);
  const [photoCursor, setPhotoCursor] = useState<string | null>(null);
  const [listMore, setListMore] = useState(false);
  const [photoMore, setPhotoMore] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [photoLoading, setPhotoLoading] = useState(false);
  const listRequest = useRef<AbortController | null>(null);
  const photoRequest = useRef<AbortController | null>(null);
  const scope = useRef<{ active: boolean; accountId: string; chatId: string; context: ReturnType<typeof captureAccountContext> } | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  const refresh = async (append = false) => {
    const current = scope.current;
    if (!current?.active || current.accountId !== accountId || current.chatId !== chatId || !current.context.isCurrent() || useStore.getState().accountId !== accountId) return;
    listRequest.current?.abort();
    const request = new AbortController();
    listRequest.current = request;
    listAppend.current = append;
    setListLoading(true); setListError(null);
    try {
      const page = await readAlbumList(accountId, chatId, append ? listCursor : null, request.signal);
      if (!current.active || !current.context.isCurrent() || request.signal.aborted) return;
      setAlbums(previous => append ? mergeAlbumPage(previous, page.items) : page.items);
      setListCursor(page.cursor); setListMore(page.hasMore);
    } catch (error) {
      if (current.active && current.context.isCurrent() && !request.signal.aborted) setListError(error instanceof Error ? error.message : String(error));
    } finally { if (current.active && !request.signal.aborted) setListLoading(false); }
  };
  const openAlbum = async (id: string, append = false) => {
    const current = scope.current;
    if (!current?.active || current.accountId !== accountId || current.chatId !== chatId || !current.context.isCurrent() || useStore.getState().accountId !== accountId) return;
    photoRequest.current?.abort();
    const request = new AbortController();
    photoRequest.current = request;
    photoAppend.current = append;
    setSelectedId(id); setPhotoLoading(true); setPhotoError(null);
    if (!append) { setPhotos([]); setPhotoMore(false); }
    try {
      const page = await readAlbumPhotos(accountId, chatId, id, append ? photoCursor : null, request.signal);
      if (!current.active || !current.context.isCurrent() || request.signal.aborted) return;
      setPhotos(previous => append ? mergeAlbumPage(previous, page.items) : page.items);
      setPhotoCursor(page.cursor); setPhotoMore(page.hasMore);
    } catch (error) {
      if (current.active && current.context.isCurrent() && !request.signal.aborted) setPhotoError(error instanceof Error ? error.message : String(error));
    } finally { if (current.active && !request.signal.aborted) setPhotoLoading(false); }
  };

  useEffect(() => {
    const current = { active: true, accountId, chatId, context: captureAccountContext(useStore) };
    scope.current = current;
    const chatScoped = useStore.getState().activeChatId === chatId;
    const cancel = () => { current.active = false; current.context.dispose(); listRequest.current?.abort(); photoRequest.current?.abort(); };
    const unsubscribe = useStore.subscribe(state => {
      if (current.active && (!current.context.isCurrent() || (chatScoped && state.activeChatId !== chatId))) { cancel(); close.current(); }
    });
    setAlbums([]); setPhotos([]); setSelectedId(initialAlbumId); setError(null); setListError(null); setPhotoError(null); setPhotoMore(false); setListMore(false);
    void refresh();
    if (initialAlbumId) void openAlbum(initialAlbumId);
    return () => { cancel(); unsubscribe(); };
  }, [accountId, chatId, initialAlbumId]);
  const retry = () => {
    if (listError) void refresh(listAppend.current);
    if (photoError && selectedId) void openAlbum(selectedId, photoAppend.current);
    if (error) { setError(null); void refresh(); if (selectedId) void openAlbum(selectedId); }
  };
  return { albums, photos, setPhotos, selectedId, setSelectedId, error: error ?? photoError ?? listError, setError, retry, busy: listLoading || photoLoading, photoLoading, listLoading, refresh, openAlbum, listMore, photoMore, moreAlbums: () => refresh(true), morePhotos: () => openAlbum(selectedId, true) };
}
