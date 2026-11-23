/**
 * utils/videoMetadata.ts — 送信動画のサムネイル JPEG と再生時間(ms)をブラウザで抽出する
 *
 * サーバ環境に ffmpeg が無い構成でも LINE 公式アプリが動画バブルのプレビューと
 * 再生時間を表示できるよう、ブラウザの <video> + <canvas> で生成する。
 */

export const VIDEO_PREVIEW_MAX_DIMENSION = 480;
export const VIDEO_PREVIEW_QUALITY = 0.8;
const VIDEO_METADATA_TIMEOUT_MS = 4_000;

export interface ExtractedVideoMetadata {
  durationMs?: number;
  preview?: Blob;
}

export async function extractVideoMetadata(file: File): Promise<ExtractedVideoMetadata> {
  if (typeof document === "undefined" || typeof URL === "undefined" || !URL.createObjectURL) {
    return {};
  }
  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "metadata";

  return new Promise<ExtractedVideoMetadata>((resolve) => {
    let settled = false;
    let durationMs: number | undefined;

    const cleanup = (result: ExtractedVideoMetadata) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.onloadedmetadata = null;
      video.onseeked = null;
      video.onloadeddata = null;
      video.onerror = null;
      video.removeAttribute("src");
      try {
        video.load();
      } catch {
        /* ignore */
      }
      URL.revokeObjectURL(objectUrl);
      resolve(result);
    };

    const timer = setTimeout(() => cleanup(durationMs != null ? { durationMs } : {}), VIDEO_METADATA_TIMEOUT_MS);

    const captureFrame = () => {
      try {
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        if (!vw || !vh) {
          cleanup(durationMs != null ? { durationMs } : {});
          return;
        }
        const scale = Math.min(1, VIDEO_PREVIEW_MAX_DIMENSION / Math.max(vw, vh));
        const width = Math.max(1, Math.round(vw * scale));
        const height = Math.max(1, Math.round(vh * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          cleanup(durationMs != null ? { durationMs } : {});
          return;
        }
        ctx.drawImage(video, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            cleanup({
              ...(durationMs != null ? { durationMs } : {}),
              ...(blob && blob.size > 0 ? { preview: blob } : {}),
            });
          },
          "image/jpeg",
          VIDEO_PREVIEW_QUALITY,
        );
      } catch {
        cleanup(durationMs != null ? { durationMs } : {});
      }
    };

    video.onerror = () => cleanup({});
    video.onloadedmetadata = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        durationMs = Math.round(video.duration * 1000);
      }
      const targetTime =
        Number.isFinite(video.duration) && video.duration > 0
          ? Math.min(0.1, video.duration * 0.1)
          : 0;
      if (targetTime > 0) {
        video.onseeked = captureFrame;
        try {
          video.currentTime = targetTime;
        } catch {
          video.onloadeddata = captureFrame;
        }
      } else {
        video.onloadeddata = captureFrame;
      }
    };

    video.src = objectUrl;
  });
}
