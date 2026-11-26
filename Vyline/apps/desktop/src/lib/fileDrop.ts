import { CHAT_PANE_DRAG_TYPE } from "@/lib/chatPanes";

const VYLINE_STICKER_DRAG_TYPE = "application/x-vyline-sticker";

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "avif",
  "heic",
  "heif",
  "svg",
]);

const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm", "m4v", "mkv", "avi"]);

export type DropMediaKind = "image" | "video" | "file";

export function isExternalFileDrag(
  dataTransfer: Pick<DataTransfer, "types"> | null | undefined,
): boolean {
  if (!dataTransfer?.types) return false;
  const types = Array.from(dataTransfer.types);
  if (types.includes(CHAT_PANE_DRAG_TYPE) || types.includes(VYLINE_STICKER_DRAG_TYPE)) {
    return false;
  }
  return types.includes("Files");
}

function fileExtension(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

export function detectFileMediaKind(
  file: Pick<File, "name" | "type">,
  forceFile = false,
): DropMediaKind {
  if (forceFile) return "file";
  const mime = (file.type || "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (!mime || mime === "application/octet-stream") {
    const ext = fileExtension(file.name);
    if (IMAGE_EXTENSIONS.has(ext)) return "image";
    if (VIDEO_EXTENSIONS.has(ext)) return "video";
  }
  return "file";
}

export function hasVisualMediaFiles(files: readonly Pick<File, "name" | "type">[]): boolean {
  return files.some((file) => {
    const kind = detectFileMediaKind(file);
    return kind === "image" || kind === "video";
  });
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function fileExtensionLabel(name: string): string {
  const ext = fileExtension(name);
  if (!ext) return "FILE";
  return ext.slice(0, 5).toUpperCase();
}
