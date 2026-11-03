import { useState } from "react";
import { api } from "@/api/client";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { ActionDialog as Modal } from "@/components/action-dialog";
import { requestControllerPrompt } from "@/ui/controller-dialog";
import { captureAccountContext } from "@/lib/accountContext";
import { useAlbumBrowser } from "../hooks/useAlbumBrowser";
import { AlbumPhotoGrid } from "./album-photo-grid";
import { maskPrivacyText } from "../lib/settingsPreferences";

export function AlbumModal({
  accountId,
  chatId,
  onClose,
  initialAlbumId = "",
}: { accountId: string; chatId: string; onClose: () => void; initialAlbumId?: string }) {
  const browser = useAlbumBrowser(accountId, chatId, initialAlbumId, onClose);
  const { albums, photos, setPhotos, selectedId, setSelectedId, error, setError, refresh, openAlbum } = browser;
  const [actionBusy, setBusy] = useState(false);
  const busy = actionBusy || browser.busy;
  const settings = useStore(state => state.settings);

  const runAlbum = async (task: () => Promise<unknown>, reopen = false) => {
    if (busy || useStore.getState().accountId !== accountId) return;
    const context = captureAccountContext(useStore);
    setBusy(true);
    setError(null);
    try {
      await task();
      if (!context.isCurrent()) return;
      await refresh();
      if (context.isCurrent() && reopen && selectedId) await openAlbum(selectedId);
    } catch (e) {
      if (context.isCurrent()) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (context.isCurrent()) setBusy(false);
      context.dispose();
    }
  };

  const uploadAlbumImage = async (file: File) => {
    if (!selectedId) return;
    const objectUrl = URL.createObjectURL(file);
    try {
      const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => reject(new Error("画像サイズを取得できませんでした"));
        image.src = objectUrl;
      });
      await runAlbum(async () => {
        const uploaded = await api.line.albums.uploadMedia(accountId, selectedId, chatId, file);
        await api.line.albums.addPhotos(accountId, selectedId, chatId, [
          {
            obsResourceId: { oid: uploaded.oid, sid: "a", svc: "album" },
            width: dimensions.width,
            height: dimensions.height,
            shotTime: Date.now(),
            resourceType: "IMAGE",
          },
        ]);
      }, true);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  };

  return (
    <Modal title="アルバム" onClose={onClose}>
      <p role="alert" hidden={!error} className="mb-3 break-words text-xs text-red-400">{error ? maskPrivacyText(error, settings) : null}</p>
      {error && <button type="button" disabled={busy} className="mb-3 text-xs underline" onClick={browser.retry}>再読み込み</button>}
      <div className="mb-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={busy}
          className="rounded-lg border border-[var(--vy-border)] py-2 disabled:opacity-50"
          onClick={async () => {
            const title = await requestControllerPrompt("アルバム名");
            if (title?.trim())
              void runAlbum(() => api.line.albums.create(accountId, chatId, title.trim()));
          }}
        >
          新規作成
        </button>
        <button
          type="button"
          disabled={busy}
          className="rounded-lg border border-[var(--vy-border)] py-2 disabled:opacity-50"
          onClick={() =>
            void api.line.albums
              .preview(accountId, chatId)
              .catch((e) => setError(e instanceof Error ? e.message : String(e)))
          }
        >
          プレビュー確認
        </button>
      </div>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs text-[var(--vy-text-dim)]">アルバム一覧</span>
        <button
          type="button"
          disabled={busy}
          className="text-xs text-[var(--vy-accent)] disabled:opacity-50"
          onClick={() => void refresh()}
        >
          再読み込み
        </button>
      </div>
      <div role="region" aria-label="アルバム一覧" className="max-h-56 space-y-1 overflow-y-auto">
        {albums.length === 0 ? (
          <p className="py-5 text-center text-xs text-[var(--vy-text-dim)]">{browser.listLoading ? "読み込み中…" : "アルバムがありません"}</p>
        ) : (
          albums.map((album, index) => {
            const id = album.id;
            const title = maskPrivacyText(album.title || `アルバム ${index + 1}`, settings);
            return (
              <button
                key={id || index}
                type="button"
                disabled={actionBusy || browser.listLoading}
                className={cn(
                  "w-full rounded-lg border px-3 py-2 text-left",
                  selectedId === id ? "border-[var(--vy-accent)]" : "border-[var(--vy-border)]",
                )}
                onClick={() => id && void openAlbum(id)}
              >
                <span className="block truncate text-sm">{title}</span>
                <span className="block truncate text-[10px] text-[var(--vy-text-dim)]">{id}</span>
              </button>
            );
          })
        )}
        {browser.listLoading && <p role="status" className="text-xs">読み込み中…</p>}
        {browser.listMore && <button type="button" disabled={actionBusy || browser.listLoading} onClick={() => void browser.moreAlbums()} className="w-full p-2 text-xs">次のページ</button>}
      </div>
      {selectedId && (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={busy}
              className="rounded-lg border border-[var(--vy-border)] py-2 disabled:opacity-50"
              onClick={async () => {
                const title = await requestControllerPrompt("新しいアルバム名");
                if (title?.trim())
                  void runAlbum(() =>
                    api.line.albums.rename(accountId, selectedId, chatId, title.trim()),
                  );
              }}
            >
              名前変更
            </button>
            <button
              type="button"
              disabled={busy}
              className="rounded-lg border border-[var(--vy-border)] py-2 disabled:opacity-50"
              onClick={() =>
                void runAlbum(() => api.line.albums.share(accountId, selectedId, chatId), false)
              }
            >
              共有
            </button>
            <label className="relative cursor-pointer rounded-lg border border-[var(--vy-border)] py-2 text-center focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--vy-accent)] has-[:disabled]:opacity-50">
              写真追加
              <input
                className="sr-only"
                type="file"
                accept="image/*"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadAlbumImage(f);
                  e.currentTarget.value = "";
                }}
              />
            </label>
            <button
              type="button"
              disabled={busy}
              className="rounded-lg border border-red-500/40 py-2 text-red-400 disabled:opacity-50"
              onClick={() =>
                void runAlbum(async () => {
                  await api.line.albums.remove(accountId, selectedId, chatId);
                  setSelectedId("");
                  setPhotos([]);
                })
              }
            >
              アルバム削除
            </button>
          </div>
          <section aria-label="写真">
            <AlbumPhotoGrid key={`${accountId}:${chatId}:${selectedId}`} accountId={accountId} chatId={chatId} albumId={selectedId} photos={photos} loading={busy} onDelete={photoId => void runAlbum(() => api.line.albums.deletePhotos(accountId, selectedId, chatId, [photoId]), true)} />
            {browser.photoMore && <button type="button" disabled={busy} onClick={() => void browser.morePhotos()} className="w-full p-2 text-xs">次のページ</button>}
          </section>
        </>
      )}
    </Modal>
  );
}
