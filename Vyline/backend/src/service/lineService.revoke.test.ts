import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

// Module-level storage paths must be initialized in a separate, disposable process.
if (process.env.VYLINE_REVOKE_TEST_CHILD !== "1") {
  test("unsend operation and metadata integration", async () => {
    const child = Bun.spawn([process.execPath, "test", fileURLToPath(import.meta.url)], {
      env: { ...process.env, VYLINE_REVOKE_TEST_CHILD: "1" },
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
  }, 30_000);
} else {
  const root = await mkdtemp(join(tmpdir(), "vyline-revoke-test-"));
  process.env.VYLINE_DATA_DIR = root;
  const { processFetchedOperations, mapDecodedRawToMessage } = await import("./lineService.js");
  const { upsertMessages, getStoredMessages, closeAccountChatDb } = await import(
    "../storage/chatStore.js"
  );
  const { drainTalkEvents } = await import("../line/talkEventBuffer.js");
  test("keeps originals using param2 for self, received, and silent unsend; ignores unknown IDs", async () => {
    const accountId = "revoke-test";
    try {
      for (const [index, type] of [
        64,
        65,
        "DESTROY_MESSAGE",
        "NOTIFIED_DESTROY_MESSAGE",
      ].entries()) {
        const id = String(90071992547409930n + BigInt(index));
        await upsertMessages(accountId, "c-original", [
          {
            id,
            chatMid: "c-original",
            from: "u-author",
            to: "c-original",
            text: `original-${index}`,
            contentType: "NONE",
            createdTime: 1000,
            isMyMessage: index % 2 === 0,
            savedAt: new Date().toISOString(),
          },
        ]);
        await processFetchedOperations(accountId, [
          { type, param1: "c-wrong", param2: id, param3: "1" },
        ]);
        const message = (await getStoredMessages(accountId, "c-original", 10)).find(
          (m) => m.id === id,
        )!;
        expect(message.revokedSnapshot?.text).toBe(`original-${index}`);
        expect(message.messageState).toBe(index % 2 === 0 ? "revoked-by-self" : "revoked-by-other");
        expect(drainTalkEvents(accountId, 0).events.at(-1)).toMatchObject({
          kind: "revoke",
          chatMid: "c-original",
          messageId: id,
        });
        await processFetchedOperations(accountId, [{ type, param2: id }]);
        expect(
          (await getStoredMessages(accountId, "c-original", 10)).find((m) => m.id === id)?.history,
        ).toEqual(message.history);
      }
      const cursor = drainTalkEvents(accountId, 0).cursor;
      await processFetchedOperations(accountId, [
        { type: 65, param2: "999" },
        { type: 65, param2: "invalid" },
        { type: 7, param1: "90071992547409930", param2: "c-original" },
        { type: 8, param1: "90071992547409930", param2: "c-original" },
      ]);
      await processFetchedOperations("other-account", [{ type: 65, param2: "90071992547409930" }]);
      expect(drainTalkEvents(accountId, cursor).events).toEqual([]);
      expect(drainTalkEvents("other-account", 0).events).toEqual([]);
    } finally {
      await closeAccountChatDb(accountId);
      await closeAccountChatDb("other-account");
      await rm(root, { recursive: true, force: true });
    }
  });
  test("requires explicit true unsend metadata, including silent unsend", () => {
    const raw = {
      id: "1",
      from: "u-other",
      to: "u-self",
      createdTime: 1,
      contentType: "NONE",
      text: null,
    };
    for (const flag of ["UNSENT", "SILENTLY_UNSENT"]) {
      for (const value of ["true", "TRUE", "1"]) {
        expect(
          mapDecodedRawToMessage({ ...raw, contentMetadata: { [flag]: value } }, "u-self")
            .contentType,
        ).toBe("UNSENT");
      }
      for (const value of ["false", "0", "", "yes"]) {
        expect(
          mapDecodedRawToMessage({ ...raw, contentMetadata: { [flag]: value } }, "u-self")
            .contentType,
        ).toBe("NONE");
      }
    }
    expect(mapDecodedRawToMessage(raw, "u-self").contentType).toBe("NONE");
    expect(mapDecodedRawToMessage({ ...raw, chunks: ["encrypted"] }, "u-self").contentType).toBe(
      "E2EE_UNAVAILABLE",
    );
  });
}
