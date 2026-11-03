import type { VylineClient } from "@vyline/protocol";

type AlbumClient = {
  list(options: {
    chatId: string;
    cursor?: string;
    orderBy?: string;
    include?: string;
  }): Promise<unknown>;
  preview(options: {
    chatId: string;
    pageSize?: number;
    thumbnailCount?: number;
    viewType?: string;
  }): Promise<unknown>;
  create(options: {
    chatId: string;
    title: string;
    modifyDuplicateTitle?: boolean;
  }): Promise<unknown>;
  update(options: { chatId: string; albumId: string; title: string }): Promise<unknown>;
  delete(options: { chatId: string; albumId: string }): Promise<unknown>;
  share(options: { chatId: string; albumId: string }): Promise<unknown>;
  photos(options: {
    chatId: string;
    albumId: string;
    cursor?: string;
    pageSize?: number;
    orderBy?: string;
    include?: string;
    filterType?: string;
    targetUser?: string;
  }): Promise<unknown>;
  addPhotos(options: {
    chatId: string;
    albumId: string;
    photos: Array<{
      obsResourceId: { oid: string; sid?: string; svc?: string };
      width: number;
      height: number;
      shotTime?: number;
      resourceType?: string;
    }>;
  }): Promise<unknown>;
  deletePhotos(options: { chatId: string; albumId: string; photoIds: string[] }): Promise<unknown>;
  upload(options: {
    chatId: string;
    albumId: string;
    oid: string;
    data: Blob;
    contentType?: string;
  }): Promise<{ oid: string }>;
  download(options: {
    chatId: string;
    albumId: string;
    oid: string;
    mediaType?: "image" | "video";
  }): Promise<Response>;
};

const albumClient = (client: VylineClient) =>
  (client.base as typeof client.base & { album: AlbumClient }).album;

export function listAlbums(
  client: VylineClient,
  query: { chatId: string; cursor?: string; orderBy?: string; include?: string },
) {
  if (!query.chatId) throw new Error("chatId required");
  return albumClient(client).list(query);
}

export function previewAlbums(
  client: VylineClient,
  query: { chatId: string; pageSize?: string; thumbnailCount?: string; viewType?: string },
) {
  return albumClient(client).preview({
    chatId: query.chatId,
    ...(query.pageSize ? { pageSize: Number(query.pageSize) } : {}),
    ...(query.thumbnailCount ? { thumbnailCount: Number(query.thumbnailCount) } : {}),
    ...(query.viewType ? { viewType: query.viewType } : {}),
  });
}

export function createAlbum(
  client: VylineClient,
  input: { chatId: string; title: string; modifyDuplicateTitle?: boolean },
) {
  return albumClient(client).create(input);
}

export function updateAlbum(
  client: VylineClient,
  albumId: string,
  input: { chatId: string; title: string },
) {
  return albumClient(client).update({ albumId, ...input });
}

export function deleteAlbum(client: VylineClient, albumId: string, chatId: string) {
  return albumClient(client).delete({ albumId, chatId });
}

export function shareAlbum(client: VylineClient, albumId: string, chatId: string) {
  return albumClient(client).share({ albumId, chatId });
}

export function listAlbumPhotos(
  client: VylineClient,
  albumId: string,
  query: {
    chatId: string;
    cursor?: string;
    pageSize?: string;
    orderBy?: string;
    include?: string;
    filterType?: string;
    targetUser?: string;
  },
) {
  if (!query.chatId || !albumId) throw new Error("chatId and albumId required");
  if (query.pageSize !== undefined && (!Number.isInteger(Number(query.pageSize)) || Number(query.pageSize) < 1 || Number(query.pageSize) > 100)) throw new Error("invalid pageSize");
  return albumClient(client).photos({
    chatId: query.chatId,
    albumId,
    ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
    ...(query.pageSize !== undefined ? { pageSize: Number(query.pageSize) } : {}),
    ...(query.orderBy !== undefined ? { orderBy: query.orderBy } : {}),
    ...(query.include !== undefined ? { include: query.include } : {}),
    ...(query.filterType !== undefined ? { filterType: query.filterType } : {}),
    ...(query.targetUser !== undefined ? { targetUser: query.targetUser } : {}),
  });
}

export function addAlbumPhotos(
  client: VylineClient,
  albumId: string,
  input: Parameters<AlbumClient["addPhotos"]>[0],
) {
  return albumClient(client).addPhotos({ ...input, albumId });
}

export function deleteAlbumPhotos(
  client: VylineClient,
  albumId: string,
  chatId: string,
  photoIds: string[],
) {
  return albumClient(client).deletePhotos({ albumId, chatId, photoIds });
}

export async function uploadAlbumMedia(
  client: VylineClient,
  albumId: string,
  input: { chatId: string; data: Blob; oid?: string; contentType?: string },
): Promise<{ oid: string }> {
  const now = new Date();
  const yy = String(now.getUTCFullYear()).slice(-2);
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const oid = input.oid ?? `${crypto.randomUUID().replaceAll("-", "")}.${yy}${mm}${dd}${hh}`;
  return await albumClient(client).upload({
    albumId,
    chatId: input.chatId,
    oid,
    data: input.data,
  });
}

export class AlbumMediaError extends Error {
  constructor(readonly status: number, readonly retryAfter: string | null) {
    super(`Album media HTTP ${status}`);
    this.name = "AlbumMediaError";
  }
}

export async function downloadAlbumMedia(
  client: VylineClient,
  albumId: string,
  options: { chatId: string; oid: string; mediaType?: "image" | "video"; sid?: string; full?: boolean; signal?: AbortSignal; range?: string },
) {
  if (!options.chatId || !albumId || !options.oid) throw new Error("chatId, albumId and oid required");
  const sid = options.sid ?? (options.mediaType === "video" ? "v" : "a");
  if (!["a", "o", "v"].includes(sid)) throw new Error("invalid album resource sid");
  // Android b30/p builds OBS /r/{svc}/{sid}/{oid}/{optional tid}; channel/chat/album headers stay on the server.
  const suffix = options.full || sid === "v" ? "" : "/m1200";
  const url = `https://obs-jp.line-apps.com/r/album/${sid}/${encodeURIComponent(options.oid)}${suffix}`;
  const invoke = (token: string) => client.base.fetch(url, {
    method: "GET", ...(options.signal ? { signal: options.signal } : {}),
    headers: { ...client.base.request.getHeader("GET"), "X-Line-ChannelToken": token, "X-Line-Mid": options.chatId, "X-Line-Album": albumId, ...(options.range ? { Range: options.range } : {}) },
  });
  let response = await invoke(await client.base.channelTokens.get("1375220249", { approve: true }));
  if (response.status === 401) {
    await response.body?.cancel();
    response = await invoke(await client.base.channelTokens.reissue("1375220249", true));
  }
  if (!response.ok && response.status !== 416) {
    await response.body?.cancel();
    throw new AlbumMediaError(response.status, response.headers.get("Retry-After"));
  }
  return response;
}
