export const SUPPORT_REPOSITORY = "https://github.com/tqmane/vyline";
export const SUPPORT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const SUPPORT_IMAGES_MAX_BYTES = 25 * 1024 * 1024;
const SECRET_KEY = /token|cookie|authorization|csrf|crumb|password|secret|session|private.?key|proxy|account|mid$|email|phone|display.?name|^(?:text|body|content|message|history|drafts)$/i;

export function redactSupportValue(value: unknown, key = "", depth = 0, seen = new WeakSet<object>()): unknown {
  if (SECRET_KEY.test(key)) return "[REDACTED]";
  if (depth > 8) return "[TRUNCATED]";
  if (typeof value === "string") return value.slice(0, 20_000)
    .replace(/(["'])(?:(?:access|refresh|auth|id)?[_-]?token|cookies?|authorization|csrf|crumb|password|secret|session|api[_-]?key|private[_-]?key)\1\s*:\s*(?:"(?:\\.|[^"\\])*(?:"|$)|'(?:\\.|[^'\\])*(?:'|$)|[^\s,}\]]+)/gi, '"credential":"[REDACTED]"')
    .replace(/(?:set-cookie|cookie|authorization)\s*[:=][^\r\n]*/gi, "[REDACTED]")
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "[REDACTED]")
    .replace(/(?:access[_-]?token|auth[_-]?token|refresh[_-]?token|token|csrf|crumb|password|secret|session|api[_-]?key)\s*[:=]\s*["']?[^\s,"'};]+/gi, "[REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED]")
    .replace(/https?:\/\/[^\s<>"']+/gi, "[URL]")
    .replace(/\b[ucr][0-9a-f]{32}\b/gi, "[MID]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[EMAIL]")
    .replace(/(?:\+?\d[\d ()-]{8,}\d)/g, "[PHONE]")
    .replace(/[A-Z]:\\[^\s"']+|\/(?:home|Users|data|tmp|var)\/[^\s"']+/gi, "[PATH]")
    .slice(0, 20_000);
  if (value && typeof value === "object") {
    if (seen.has(value)) return "[CIRCULAR]";
    seen.add(value);
    const result = Array.isArray(value) ? value.slice(0, 1000).map(item => redactSupportValue(item, "", depth + 1, seen)) :
      Object.fromEntries(Object.entries(value).slice(0, 200).map(([name, child]) => [String(redactSupportValue(name)), redactSupportValue(child, name, depth + 1, seen)]));
    seen.delete(value);
    return result;
  }
  return value;
}

export function supportIssuePreview(input: { summary: string; steps: string; expected: string; actual: string; version: string }) {
  const clean = (v: string) => String(redactSupportValue(v)).slice(0, 12_000);
  const title = clean(input.summary).slice(0, 160) || "Vyline issue";
  const body = ["## 症状", clean(input.actual), "## 再現手順", clean(input.steps), "## 期待した結果", clean(input.expected), "## バージョン", clean(input.version),
    "", "診断ZIP・画像は内容を確認し、必要なファイルだけ手動で添付してください。"].join("\n\n");
  const url = `${SUPPORT_REPOSITORY}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
  return { title, body, url: url.length <= 7500 ? url : `${SUPPORT_REPOSITORY}/issues/new`, copyRequired: url.length > 7500 };
}

export function validateSupportImages(files: readonly Pick<File, "size" | "type">[]) {
  if (files.length > 10 || files.some(f => !["image/png", "image/jpeg", "image/webp"].includes(f.type) || f.size <= 0 || f.size > SUPPORT_IMAGE_MAX_BYTES))
    throw new Error("画像はPNG/JPEG/WebP、1枚10MiB・10枚までです");
  if (files.reduce((size, f) => size + f.size, 0) > SUPPORT_IMAGES_MAX_BYTES) throw new Error("画像は合計25MiBまでです");
}

/** Re-encode pixels so EXIF and filenames never enter the bundle. */
export async function prepareSupportImage(file: File): Promise<Blob> {
  validateSupportImages([file]);
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 16_777_216) throw new Error("画像は約1600万画素までです");
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("画像の読み込みに対応していません");
    context.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error("画像を変換できません")), "image/png"));
    validateSupportImages([blob]);
    return blob;
  } finally { bitmap.close(); }
}

type BundleFile = { name: string; data: Uint8Array };
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  let crc = n;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

/** Stored ZIP entries keep generation local without adding a browser dependency. */
export function createSupportZip(files: BundleFile[]): Blob {
  if (files.length > 20 || files.reduce((n, f) => n + f.data.byteLength, 0) > 30 * 1024 * 1024) throw new Error("診断ZIPは20ファイル・30MiBまでです");
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  const names = new Set<string>();
  let offset = 0;
  for (const file of files) {
    if (!/^[a-zA-Z0-9_-]+\.(?:json|md|png)$/.test(file.name) || names.has(file.name)) throw new Error("診断ZIPのファイル名が不正です");
    names.add(file.name);
    const name = new TextEncoder().encode(file.name);
    const data = file.data;
    let crc = 0xffffffff;
    for (const byte of data) crc = crcTable[(crc ^ byte) & 255]! ^ (crc >>> 8);
    crc = (crc ^ 0xffffffff) >>> 0;
    const part = new Uint8Array(30 + name.length + data.length);
    const view = new DataView(part.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true);
    view.setUint32(14, crc, true); view.setUint32(18, data.length, true); view.setUint32(22, data.length, true); view.setUint16(26, name.length, true);
    part.set(name, 30); part.set(data, 30 + name.length); local.push(part);
    const entry = new Uint8Array(46 + name.length);
    const cv = new DataView(entry.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true);
    entry.set(name, 46); central.push(entry); offset += part.length;
  }
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true); view.setUint16(8, files.length, true); view.setUint16(10, files.length, true);
  view.setUint32(12, central.reduce((n, p) => n + p.length, 0), true); view.setUint32(16, offset, true);
  return new Blob([...local, ...central, end].map(part => new Uint8Array(part).buffer as ArrayBuffer), { type: "application/zip" });
}

export function downloadLocalFile(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
