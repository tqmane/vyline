import { useEffect, useMemo, useState } from "react";
import {
  fetchLinkPreview,
  fetchLinkPreviewImage,
  type FetchedLinkPreview,
} from "../api/linkPreview";
import {
  canRequestUrlPreviews,
  previewUrlsForText,
  type UrlPreviewSettings,
} from "../lib/messageUrls";

/** Bounded shared work prevents a history render from fetching every URL at once. */
export function createLinkPreviewLoader(load = fetchLinkPreview, now = Date.now) {
  type Result = FetchedLinkPreview | null;
  type Task = {
    accountId: string;
    url: string;
    key: string;
    refs: number;
    controller: AbortController;
    resolve: (result: Result) => void;
    promise: Promise<Result>;
  };
  const cache = new Map<string, { result: Result; expiresAt: number }>();
  const pending = new Map<string, Task>();
  const queue: Task[] = [];
  let active = 0;
  function pump() {
    while (active < 4 && queue.length) {
      const task = queue.shift()!;
      if (task.controller.signal.aborted) continue;
      active++;
      void load(task.accountId, task.url, task.controller.signal)
        .catch(() => null)
        .then((result) => {
          if (!task.controller.signal.aborted) {
            while (cache.size >= 256) cache.delete(cache.keys().next().value!);
            cache.set(task.key, {
              result,
              expiresAt: now() + (result ? 4 * 60 * 60_000 : 5 * 60_000),
            });
          }
          task.resolve(task.controller.signal.aborted ? null : result);
        })
        .finally(() => {
          active--;
          if (pending.get(task.key) === task) pending.delete(task.key);
          pump();
        });
    }
  }
  return function acquire(accountId: string, url: string) {
    const key = JSON.stringify([accountId, url]);
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now())
      return { promise: Promise.resolve(cached.result), release() {} };
    let task = pending.get(key);
    if (!task) {
      if (pending.size >= 64) return { promise: Promise.resolve(null), release() {} };
      let resolve!: (result: Result) => void;
      const promise = new Promise<Result>((done) => {
        resolve = done;
      });
      task = { accountId, url, key, refs: 0, controller: new AbortController(), resolve, promise };
      pending.set(key, task);
      queue.push(task);
    }
    task.refs++;
    pump();
    let released = false;
    return {
      promise: task.promise,
      release() {
        if (released) return;
        released = true;
        if (--task.refs === 0) {
          task.controller.abort();
          task.resolve(null);
          if (pending.get(key) === task) pending.delete(key);
          const index = queue.indexOf(task);
          if (index >= 0) queue.splice(index, 1);
        }
      },
    };
  };
}

const acquirePreview = createLinkPreviewLoader();
export type MessageUrlPreview = FetchedLinkPreview & { url: string; thumb: string };

export function useLinkPreviews(
  accountId: string | null,
  text: string,
  settings: UrlPreviewSettings,
  excludeUrl?: string,
): MessageUrlPreview[] {
  const enabled = canRequestUrlPreviews(settings);
  const limit = settings.linkPreviewMaxUrls;
  const urls = useMemo(
    () =>
      accountId && enabled
        ? previewUrlsForText(text, 3)
            .filter((url) => url !== previewUrlsForText(excludeUrl ?? "")[0])
            .slice(0, Math.max(0, Math.min(3, Math.floor(limit ?? 1)) - (excludeUrl ? 1 : 0)))
        : [],
    [accountId, enabled, text, limit, excludeUrl],
  );
  const key = JSON.stringify([accountId, urls]);
  const [state, setState] = useState<{ key: string; values: MessageUrlPreview[] }>({
    key: "",
    values: [],
  });
  useEffect(() => {
    if (!accountId || !urls.length) return;
    let cancelled = false;
    const work = urls.map((url) => acquirePreview(accountId, url));
    void Promise.all(work.map((item) => item.promise)).then((results) => {
      if (!cancelled)
        setState({
          key,
          values: results.flatMap((result, index) =>
            result ? [{ ...result, url: urls[index]!, thumb: "🔗" }] : [],
          ),
        });
    });
    return () => {
      cancelled = true;
      work.forEach((item) => item.release());
    };
  }, [accountId, urls, key]);
  return state.key === key ? state.values : [];
}

export function useLinkPreviewImage(
  accountId: string | null,
  imageId?: string,
): string | undefined {
  const key = JSON.stringify([accountId, imageId]);
  const [image, setImage] = useState<{ key: string; url: string } | null>(null);
  useEffect(() => {
    if (!accountId || !imageId) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    void fetchLinkPreviewImage(accountId, imageId, controller.signal)
      .then((blob) => {
        if (!blob || controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setImage({ key, url: objectUrl });
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [accountId, imageId, key]);
  return image?.key === key ? image.url : undefined;
}
