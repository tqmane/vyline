import { captureBackendFetch } from "./client";

export type FetchedLinkPreview = {
  title: string;
  description: string;
  site: string;
  imageId?: string;
};

export async function fetchLinkPreview(
  accountId: string,
  url: string,
  signal: AbortSignal,
): Promise<FetchedLinkPreview | null> {
  const response = await captureBackendFetch()(
    `/line/${encodeURIComponent(accountId)}/link-preview`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, requestUrlPreviews: true, linkPreviewMaxUrls: 1 }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
    },
  );
  if (!response.ok) return null;
  const body = (await response.json()) as { ok?: boolean; preview?: FetchedLinkPreview | null };
  const preview = body.ok && body.preview;
  if (
    !preview ||
    typeof preview.title !== "string" ||
    typeof preview.description !== "string" ||
    typeof preview.site !== "string"
  )
    return null;
  return {
    title: preview.title.slice(0, 200),
    description: preview.description.slice(0, 320),
    site: preview.site.slice(0, 100),
    ...(typeof preview.imageId === "string" && /^[a-f0-9]{64}$/.test(preview.imageId)
      ? { imageId: preview.imageId }
      : {}),
  };
}

export async function fetchLinkPreviewImage(
  accountId: string,
  imageId: string,
  signal: AbortSignal,
): Promise<Blob | null> {
  if (!/^[a-f0-9]{64}$/.test(imageId)) return null;
  const response = await captureBackendFetch()(
    `/line/${encodeURIComponent(accountId)}/link-preview/images/${imageId}`,
    {
      headers: { "X-Vyline-Url-Preview": "1" },
      signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
    },
  );
  if (
    !response.ok ||
    !/^image\/(?:png|jpeg|gif|webp)$/.test(response.headers.get("content-type") ?? "")
  )
    return null;
  return response.blob();
}
