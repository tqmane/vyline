import { afterAll, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

if (process.env.VYLINE_REVOKE_HISTORY_TEST_CHILD !== "1") {
  test("unsend history and delta preserve originals in an isolated process", async () => {
    const root = await mkdtemp(join(tmpdir(), "vyline-revoke-history-"));
    try {
      const child = Bun.spawn([process.execPath, "test", fileURLToPath(import.meta.url)], {
        env: {
          ...process.env,
          VYLINE_REVOKE_HISTORY_TEST_CHILD: "1",
          VYLINE_REVOKE_HISTORY_TEST_ROOT: root,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
      expect(code).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
} else {
  const root = process.env.VYLINE_REVOKE_HISTORY_TEST_ROOT!;
  process.env.VYLINE_DATA_DIR = join(root, "data");
  process.env.VYLINE_STORAGE_DIR = join(root, "storage");
  process.env.VYLINE_MEDIA_STORAGE_DIR = join(root, "storage", "saved-media");
  process.env.VYLINE_MEDIA_INDEX_PATH = join(root, "storage", "media-index.sqlite");
  process.env.VYLINE_BACKUP_DIR = join(root, "data", "backups");

  const accountId = "revoke-history";
  const clientManager = await import("../line/clientManager.js");
  const chatStore = await import("../storage/chatStore.js");
  let rawMessages: Array<Record<string, unknown>> = [];
  const requestedMethods: string[] = [];
  const getClientSpy = spyOn(clientManager, "getClient").mockReturnValue({
    base: {
      profile: { mid: "u-self" },
      talk: {
        protocolType: 4,
        requestPath: "/S4",
        client: {
          request: {
            request: async (_args: unknown, method: string) => {
              requestedMethods.push(method);
              if (method !== "getPreviousMessagesV2WithRequest") {
                throw new Error(`unexpected RPC: ${method}`);
              }
              return rawMessages;
            },
          },
        },
      },
    },
  } as never);
  const fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(
    new Error("network access is forbidden in this test"),
  );
  const { fetchMessages, fetchMessagesSince } = await import("./lineService.js");
  const original = (chatMid: string, id: number) => ({
    id: String(id),
    chatMid,
    from: "u-peer",
    to: chatMid,
    text: `original-${id}`,
    contentType: "NONE",
    contentMetadata: { MENTION: "original-metadata" },
    createdTime: id,
    isMyMessage: false,
    savedAt: new Date().toISOString(),
  });
  const tombstone = (chatMid: string, id: number) => ({
    ...original(chatMid, id),
    text: null,
    contentMetadata: { UNSENT: "1" },
  });

  afterAll(async () => {
    getClientSpy.mockRestore();
    fetchSpy.mockRestore();
    await chatStore.closeAccountChatDb(accountId);
  });

  test("returns the requested older revoked page with saved originals, outside the newest rows", async () => {
    const chatMid = "c-old-page";
    await chatStore.upsertMessages(accountId, chatMid, [
      ...[1, 2, 101, 102, 103, 104, 105].map((id) => original(chatMid, id)),
    ]);
    rawMessages = [tombstone(chatMid, 2), tombstone(chatMid, 1)];
    const page = await fetchMessages(accountId, chatMid, 2, {
      force: true,
      lite: true,
      beforeMessageId: "3",
      beforeDeliveredTime: 3,
    });
    expect(page.map((message) => message.id)).toEqual(["2", "1"]);
    for (const message of page) {
      expect(message).toMatchObject({
        messageState: "revoked-by-other",
        contentType: "UNSENT",
        text: null,
        revokedSnapshot: {
          text: `original-${message.id}`,
          contentType: "NONE",
          contentMetadata: { MENTION: "original-metadata" },
        },
      });
    }
  });

  test("passes a newly learned cancellation of an existing ID through the delta cursor filter", async () => {
    const chatMid = "c-delta";
    await chatStore.upsertMessages(accountId, chatMid, [
      original(chatMid, 50),
      original(chatMid, 51),
    ]);
    rawMessages = [original(chatMid, 51), tombstone(chatMid, 50)];
    const changes = await fetchMessagesSince(accountId, chatMid, "51", 2);
    expect(changes.map((message) => message.id)).toEqual(["50"]);
    expect(changes[0]).toMatchObject({
      messageState: "revoked-by-other",
      contentType: "UNSENT",
      revokedSnapshot: { text: "original-50" },
    });
    expect(requestedMethods).toEqual([
      "getPreviousMessagesV2WithRequest",
      "getPreviousMessagesV2WithRequest",
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
}
