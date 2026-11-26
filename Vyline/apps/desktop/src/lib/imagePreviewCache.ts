const MAX_PREVIEW_EDGE = 480;
const MAX_PREVIEW_ENTRIES = 200;
const MAX_DIMENSION_ENTRIES = 600;
const MIN_BYTES_TO_DOWNSCALE = 90_000;

export type CachedImagePreview = {
  url: string;
  width: number;
  height: number;
  downscaled: boolean;
};

const previewCache = new Map<string, CachedImagePreview>();
const dimensionCache = new Map<string, { width: number; height: number }>();
const inflight = new Map<string, Promise<CachedImagePreview | null>>();

function touchPreview(src: string, entry: CachedImagePreview): void {
  if (previewCache.has(src)) previewCache.delete(src);
  previewCache.set(src, entry);
  while (previewCache.size > MAX_PREVIEW_ENTRIES) {
    const oldest = previewCache.entries().next().value;
    if (!oldest) break;
    const [oldKey, oldValue] = oldest;
    previewCache.delete(oldKey);
    if (oldValue.downscaled && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
      URL.revokeObjectURL(oldValue.url);
    }
  }
}

export function getCachedImagePreview(src: string): CachedImagePreview | undefined {
  const entry = previewCache.get(src);
  if (!entry) return undefined;
  previewCache.delete(src);
  previewCache.set(src, entry);
  return entry;
}

export function rememberImageDimensions(src: string, width: number, height: number): void {
  if (!src || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return;
  }
  if (dimensionCache.has(src)) dimensionCache.delete(src);
  dimensionCache.set(src, { width, height });
  while (dimensionCache.size > MAX_DIMENSION_ENTRIES) {
    const oldest = dimensionCache.keys().next().value;
    if (oldest === undefined) break;
    dimensionCache.delete(oldest);
  }
}

export function getCachedImageDimensions(src: string): { width: number; height: number } | undefined {
  const dims = dimensionCache.get(src);
  if (dims) return dims;
  const preview = previewCache.get(src);
  return preview ? { width: preview.width, height: preview.height } : undefined;
}

export function computePreviewBox(
  naturalWidth: number,
  naturalHeight: number,
  maxWidth = 240,
  maxHeight = 360,
): { width: number; height: number } {
  if (
    !Number.isFinite(naturalWidth) ||
    !Number.isFinite(naturalHeight) ||
    naturalWidth <= 0 ||
    naturalHeight <= 0
  ) {
    return { width: maxWidth, height: 180 };
  }
  const scale = Math.min(1, maxWidth / naturalWidth, maxHeight / naturalHeight);
  return {
    width: Math.max(1, Math.round(naturalWidth * scale)),
    height: Math.max(1, Math.round(naturalHeight * scale)),
  };
}

export async function loadDownscaledPreview(
  src: string,
  signal?: AbortSignal,
): Promise<CachedImagePreview | null> {
  if (
    !src ||
    src.startsWith("blob:") ||
    src.startsWith("data:") ||
    /\.gif(?:[?#]|$)/i.test(src)
  ) {
    return null;
  }
  if (
    typeof fetch !== "function" ||
    typeof createImageBitmap !== "function" ||
    typeof document === "undefined"
  ) {
    return null;
  }
  const cached = getCachedImagePreview(src);
  if (cached) return cached;

  const existing = inflight.get(src);
  if (existing) return existing;

  const task = (async (): Promise<CachedImagePreview | null> => {
    try {
      const res = await fetch(src, { credentials: "same-origin", signal });
      if (!res.ok) return null;
      const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
      if (contentType.includes("image/gif") || contentType.includes("image/svg")) {
        return null;
      }
      const blob = await res.blob();
      if (blob.size <= MIN_BYTES_TO_DOWNSCALE) return null;

      const bitmap = await createImageBitmap(blob);
      try {
        const naturalWidth = bitmap.width;
        const naturalHeight = bitmap.height;
        if (naturalWidth <= 0 || naturalHeight <= 0) return null;
        rememberImageDimensions(src, naturalWidth, naturalHeight);

        const maxDim = Math.max(naturalWidth, naturalHeight);
        if (maxDim <= MAX_PREVIEW_EDGE) {
          return null;
        }
        const scale = MAX_PREVIEW_EDGE / maxDim;
        const targetWidth = Math.max(1, Math.round(naturalWidth * scale));
        const targetHeight = Math.max(1, Math.round(naturalHeight * scale));

        const canvas = document.createElement("canvas");
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);

        const outBlob = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob(resolve, "image/jpeg", 0.82);
        });
        if (!outBlob) return null;

        const url = URL.createObjectURL(outBlob);
        const entry: CachedImagePreview = {
          url,
          width: naturalWidth,
          height: naturalHeight,
          downscaled: true,
        };
        touchPreview(src, entry);
        return entry;
      } finally {
        bitmap.close();
      }
    } catch {
      return null;
    } finally {
      inflight.delete(src);
    }
  })();

  inflight.set(src, task);
  return task;
}
