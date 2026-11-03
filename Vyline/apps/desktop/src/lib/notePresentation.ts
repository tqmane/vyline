import type { SticonResource } from "../utils/lineSticon";
import { lineCdnProxy } from "../utils/lineMedia";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const records = (value: unknown): RecordValue[] => Array.isArray(value) ? value.filter(item => item && typeof item === "object" && !Array.isArray(item)) as RecordValue[] : [];
const text = (value: unknown): string => typeof value === "string" || typeof value === "number" ? String(value) : "";

export function assertNoteResponse(value: unknown): void {
  const root = record(value);
  if (root.ok === false) throw new Error(text(root.error) || "ノートの操作に失敗しました");
}

export function noteView(value: unknown, selfMid?: string) {
  assertNoteResponse(value);
  const root = record(value);
  const result = root.result === undefined ? root : record(root.result);
  const post = result.post === undefined ? result : record(result.post);
  const contents = post.contents === undefined ? post : record(post.contents);
  const info = post.postInfo === undefined ? post : record(post.postInfo);
  const writer = record(post.writer ?? post.userInfo ?? info.writer);
  const authorMid = text(info.writerMid ?? info.mid ?? writer.mid);
  const owner = !!selfMid && authorMid === selfMid;
  const permissions = record(info.permissions ?? post.permissions);
  const sticons: SticonResource[] = records(contents.sticonMetas).flatMap(item => {
    const productId = text(item.productId);
    const sticonId = text(item.sticonId ?? item.id);
    if (!productId || !sticonId) return [];
    return [{ productId, sticonId, ...(typeof item.S === "number" ? { S: item.S } : {}), ...(typeof item.E === "number" ? { E: item.E } : {}) }];
  });
  const media = records(contents.media).map(item => {
    const id = text(item.objectId ?? item.id);
    const service = text(item.serviceName) || "myhome";
    const namespace = text(item.obsNamespace) || (service === "privnote" ? "post" : "h");
    return { id, type: text(item.type).toUpperCase() === "VIDEO" ? "VIDEO" as const : "PHOTO" as const,
      url: id ? lineCdnProxy(`https://obs.line-apps.com/r/${encodeURIComponent(service)}/${encodeURIComponent(namespace)}/${encodeURIComponent(id)}`) : "" };
  }).filter(item => item.id);
  const comments = records(result.comments ?? result.commentList ?? post.comments ?? post.commentList).map(item => {
    const author = record(item.writer ?? item.userInfo);
    return { id: text(item.commentId ?? item.id), author: text(author.displayName ?? item.displayName) || "メンバー", text: text(item.text ?? record(item.contents).text) };
  });
  return {
    id: text(info.postId ?? post.postId ?? post.id ?? contents.postId), text: text(contents.text ?? post.text), sticons, media, comments,
    stickers: records(contents.stickers).map(item => ({ id: text(item.id ?? item.stickerId), packageId: text(item.packageId) })).filter(item => item.id),
    sharedPostId: text(contents.sharedPostId), authorMid,
    canEdit: permissions.canEdit !== false && info.editable !== false && (permissions.canEdit === true || info.editable === true || owner),
    canDelete: permissions.canDelete !== false && info.deletable !== false && (permissions.canDelete === true || info.deletable === true || owner),
    commentCount: Number(info.commentCount ?? post.commentCount ?? comments.length) || 0,
    reactionCount: Number(info.likeCount ?? post.likeCount ?? 0) || 0,
  };
}

export type NoteView = ReturnType<typeof noteView>;
