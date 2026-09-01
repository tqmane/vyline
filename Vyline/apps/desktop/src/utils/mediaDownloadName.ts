function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

function sanitizeMessageId(messageId: string): string {
  const sanitized = messageId
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 16);
  return sanitized || "message";
}

function sanitizeExtension(extension: string): string {
  return (
    extension
      .replace(/^\.+/, "")
      .replace(/[^a-zA-Z0-9]/g, "")
      .toLowerCase()
      .slice(0, 8) || "bin"
  );
}

export function mediaDownloadName(createdAt: number, messageId: string, extension: string): string {
  const candidate = new Date(Number.isFinite(createdAt) ? createdAt : 0);
  const date = Number.isNaN(candidate.getTime()) ? new Date(0) : candidate;
  const datePart = `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
  const timePart = `${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
  return `vyline_${datePart}_${timePart}_${sanitizeMessageId(messageId)}.${sanitizeExtension(extension)}`;
}
