import { afterAll, afterEach, expect, mock, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = await mkdtemp(join(tmpdir(), "vyline-line-media-errors-"));
process.env.VYLINE_DATA_DIR = join(root, "data");
process.env.VYLINE_STORAGE_DIR = join(root, "storage");
process.env.VYLINE_MEDIA_STORAGE_DIR = join(root, "storage", "saved-media");
process.env.VYLINE_MEDIA_INDEX_PATH = join(root, "storage", "media-index.sqlite");

const mediaStorage = await import("../storage/mediaStorage.js");
const lineService = await import("../service/lineService.js");
const { lineRouter } = await import("./line.js");

afterEach(() => mock.restore());
afterAll(async () => {
  await mediaStorage.closeMediaStorage();
  await rm(root, { recursive: true, force: true });
});

const mediaUrl = "http://localhost/account/media/c-media/message";

test("media GET exposes retryable storage saturation instead of a terminal 422", async () => {
  spyOn(lineService, "fetchMessageMedia").mockRejectedValue(new mediaStorage.MediaStorageBusyError());

  const response = await lineRouter.request(mediaUrl);

  expect(response.status).toBe(429);
  expect(response.headers.get("retry-after")).toBe("5");
  expect(await response.json()).toMatchObject({ ok: false, code: "MEDIA_STORAGE_BUSY" });
});

test("media GET distinguishes storage capacity and object-size limits", async () => {
  const fetchMedia = spyOn(lineService, "fetchMessageMedia");
  fetchMedia.mockRejectedValueOnce(new mediaStorage.MediaStorageCapacityError());
  let response = await lineRouter.request(`${mediaUrl}-capacity`);
  expect(response.status).toBe(507);
  expect(await response.json()).toMatchObject({ ok: false, code: "MEDIA_STORAGE_CAPACITY" });

  fetchMedia.mockRejectedValueOnce(new mediaStorage.MediaStorageObjectLimitError());
  response = await lineRouter.request(`${mediaUrl}-object-limit`);
  expect(response.status).toBe(413);
  expect(await response.json()).toMatchObject({ ok: false, code: "MEDIA_STORAGE_OBJECT_LIMIT" });
});

test("media GET preserves retryable upstream failures while keeping decrypt failures at 422", async () => {
  const fetchMedia = spyOn(lineService, "fetchMessageMedia");
  fetchMedia.mockRejectedValueOnce(new Error("obsDownload timed out after 15000ms"));
  let response = await lineRouter.request(`${mediaUrl}-timeout`);
  expect(response.status).toBe(504);

  fetchMedia.mockRejectedValueOnce(new Error("connect ECONNRESET"));
  response = await lineRouter.request(`${mediaUrl}-network`);
  expect(response.status).toBe(502);

  fetchMedia.mockRejectedValueOnce(new Error("authenticated media decrypt failed"));
  response = await lineRouter.request(`${mediaUrl}-decrypt`);
  expect(response.status).toBe(422);
  expect(await response.json()).toEqual({ ok: false, error: "media unavailable" });
});
