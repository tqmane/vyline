import { lineCdnProxy, lineStickerUrl } from "./lineMedia.js";

export type CombinationStickerItem = {
  packageId: string;
  stickerId: string;
  url: string;
  name?: string;
};

export type CombinationStickerPlacement = CombinationStickerItem & {
  x: number;
  y: number;
  size: number;
};

/**
 * コンボエディタの正規座標空間 (240x240)。
 * backend buildCombinationStickerLayouts が scale = 512 / 240 で
 * LINE の 512x512 キャンバスへ変換する前提値と同期している。
 * エディタの表示枠もこのサイズで固定すること。
 */
export const COMBO_EDITOR_SIZE = 240;

/** エディタ上でのスタンプ1枚のサイズ範囲 (正規座標系) */
export const COMBO_ITEM_MIN_SIZE = 48;
export const COMBO_ITEM_MAX_SIZE = 168;

export type CombinationStickerMetadata = {
  canvasWidth: number;
  canvasHeight: number;
  stickerLayouts: Array<{
    layoutInfo: {
      width: number;
      height: number;
      rotation: number;
      x: number;
      y: number;
    };
    stickerInfo: {
      stickerId: string;
      productId: string;
      stickerVersion?: number;
    };
  }>;
};

export function combinationStickerMetadataUrl(comboId: string): string {
  return `https://stickershop.line-scdn.net/combination-sticker/meta/${encodeURIComponent(comboId)}`;
}

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseCombinationStickerMetadata(value: unknown): CombinationStickerMetadata | null {
  if (!value || typeof value !== "object") return null;
  const root = value as Record<string, unknown>;
  const canvasWidth = finiteNumber(root.canvasWidth);
  const canvasHeight = finiteNumber(root.canvasHeight);
  if (!canvasWidth || !canvasHeight || canvasWidth <= 0 || canvasHeight <= 0) return null;
  if (!Array.isArray(root.stickerLayouts)) return null;

  const stickerLayouts = root.stickerLayouts.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const entry = raw as Record<string, unknown>;
    if (!entry.layoutInfo || typeof entry.layoutInfo !== "object") return [];
    if (!entry.stickerInfo || typeof entry.stickerInfo !== "object") return [];
    const layout = entry.layoutInfo as Record<string, unknown>;
    const sticker = entry.stickerInfo as Record<string, unknown>;
    const width = finiteNumber(layout.width);
    const height = finiteNumber(layout.height);
    const rotation = finiteNumber(layout.rotation) ?? 0;
    const x = finiteNumber(layout.x);
    const y = finiteNumber(layout.y);
    const stickerId = String(sticker.stickerId ?? "").trim();
    const productId = String(sticker.productId ?? "").trim();
    if (!width || !height || width <= 0 || height <= 0 || x == null || y == null || !stickerId) {
      return [];
    }
    const stickerVersion = finiteNumber(sticker.stickerVersion);
    return [
      {
        layoutInfo: { width, height, rotation, x, y },
        stickerInfo: {
          stickerId,
          productId,
          ...(stickerVersion == null ? {} : { stickerVersion }),
        },
      },
    ];
  });

  if (stickerLayouts.length === 0) return null;
  return { canvasWidth, canvasHeight, stickerLayouts };
}

const STORAGE_KEY = (accountId: string) => `vyline:combinationStickerPreviews:${accountId}`;

function loadPreviewStore(accountId: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY(accountId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function savePreviewStore(accountId: string, store: Record<string, string>): void {
  try {
    localStorage.setItem(STORAGE_KEY(accountId), JSON.stringify(store));
  } catch {
    /* ignore quota/private mode */
  }
}

export function getCombinationStickerPreview(accountId: string, comboId: string): string | null {
  const store = loadPreviewStore(accountId);
  return store[comboId] ?? null;
}

export function setCombinationStickerPreview(
  accountId: string,
  comboId: string,
  dataUrl: string,
): void {
  const store = loadPreviewStore(accountId);
  store[comboId] = dataUrl;
  savePreviewStore(accountId, store);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load image: ${src}`));
    img.src = src.startsWith("http") ? `/api/cdn/line?u=${encodeURIComponent(src)}` : src;
  });
}

export async function renderCombinationStickerPreview(
  items: CombinationStickerPlacement[],
  targetSize = 360,
): Promise<string> {
  if (items.length === 0) return "";
  // COMBO_EDITOR_SIZE (240x240) 空間の配置をバウンディングボックスでクロップする。
  // クロップにより気泡表示 (128px object-contain) でもクラスタが枠を満たし、
  // 相対的な配置比率は LINE 側のレンダリングと一致する。
  const minX = Math.min(...items.map((i) => i.x));
  const minY = Math.min(...items.map((i) => i.y));
  const maxX = Math.max(...items.map((i) => i.x + i.size));
  const maxY = Math.max(...items.map((i) => i.y + i.size));
  const pad = Math.max(8, Math.round(Math.max(maxX - minX, maxY - minY) * 0.08));
  const w = maxX - minX + pad * 2;
  const h = maxY - minY + pad * 2;
  const scale = Math.min(3, Math.max(1, targetSize / Math.max(w, h)));

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.scale(scale, scale);
  ctx.translate(pad - minX, pad - minY);

  const loaded = await Promise.all(
    items.map(async (item) => {
      try {
        const img = await loadImage(item.url);
        return { item, img };
      } catch {
        return null;
      }
    }),
  );

  for (const entry of loaded) {
    if (!entry) continue;
    const { item, img } = entry;
    const box = item.size;
    const x = item.x;
    const y = item.y;
    const fit = Math.min(box / img.naturalWidth, box / img.naturalHeight, 1);
    const dw = img.naturalWidth * fit;
    const dh = img.naturalHeight * fit;
    const dx = x + (box - dw) / 2;
    const dy = y + (box - dh) / 2;
    ctx.drawImage(img, dx, dy, dw, dh);
  }

  return canvas.toDataURL("image/png");
}

async function renderReceivedCombinationStickerPreview(
  metadata: CombinationStickerMetadata,
  targetSize = 360,
): Promise<string> {
  const scale = Math.min(2, Math.max(0.25, targetSize / Math.max(metadata.canvasWidth, metadata.canvasHeight)));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(metadata.canvasWidth * scale));
  canvas.height = Math.max(1, Math.round(metadata.canvasHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.scale(scale, scale);

  const loaded = await Promise.all(
    metadata.stickerLayouts.map(async (item) => {
      try {
        const img = await loadImage(lineStickerUrl(item.stickerInfo.stickerId));
        return { item, img };
      } catch {
        return null;
      }
    }),
  );

  for (const entry of loaded) {
    if (!entry) continue;
    const { item, img } = entry;
    const { width, height, rotation, x, y } = item.layoutInfo;
    const fit = Math.min(width / img.naturalWidth, height / img.naturalHeight);
    const dw = img.naturalWidth * fit;
    const dh = img.naturalHeight * fit;
    ctx.save();
    ctx.translate(x + width / 2, y + height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  }

  return canvas.toDataURL("image/png");
}

export async function resolveCombinationStickerPreview(
  accountId: string,
  comboId: string,
): Promise<string | null> {
  const cached = getCombinationStickerPreview(accountId, comboId);
  if (cached) return cached;
  try {
    const response = await fetch(lineCdnProxy(combinationStickerMetadataUrl(comboId)));
    if (!response.ok) return null;
    const metadata = parseCombinationStickerMetadata(await response.json());
    if (!metadata) return null;
    const rendered = await renderReceivedCombinationStickerPreview(metadata);
    if (!rendered) return null;
    setCombinationStickerPreview(accountId, comboId, rendered);
    return rendered;
  } catch {
    return null;
  }
}
