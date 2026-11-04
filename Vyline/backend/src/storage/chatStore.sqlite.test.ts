import { afterAll, describe, expect, mock, spyOn, test } from "bun:test";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { Database } from "bun:sqlite";

// Storage modules cache paths/connections at module scope. Isolate this suite in
// a child process so VYLINE_DATA_DIR can never point at a developer's real data.
if (process.env.VYLINE_SQLITE_CHAT_TEST_CHILD !== "1") {
  test("SQLite chat store integration in an isolated process", async () => {
    const child = Bun.spawn([process.execPath, "test", fileURLToPath(import.meta.url)], {
      env: { ...process.env, VYLINE_SQLITE_CHAT_TEST_CHILD: "1" },
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
  }, 120_000);
} else {
  const root = await fs.mkdtemp(join(tmpdir(), "vyline-sqlite-chat-test-"));
  process.env.VYLINE_DATA_DIR = root;
  const {
    warmAccountCache,
    upsertChats,
    upsertMessages,
    markStoredMessagesReadThrough,
    recordMemberReadThrough,
    markMessageRevoked,
    deleteLocalRevokedMessage,
    restoreRevokedMessage,
    getStoredChats,
    getStoredMessages,
    exportChatDb,
    mergeImportedChatDb,
    mergeAccountChatSnapshot,
    createAccountChatSnapshot,
    getChatDbLogicalStorageBytes,
    flushAccountChatDb,
    closeAccountChatDb,
  } = await import("./chatStore.js");
  const { accountFile } = await import("./accountDirs.js");

  const accountId = "sqlite-test";
  const now = new Date().toISOString();

  test("latest preview follows message IDs across different creation/delivery clocks", async () => {
    const account = "sqlite-preview-cursor";
    const chat = { mid: "u-peer", name: "Fixture", kind: "direct" as const, hasMessages: true, updatedAt: now };
    await upsertChats(account, [{ ...chat, lastMessageId: "100", lastMessageTime: 1500, lastMessagePreview: "old incoming" }]);
    await upsertMessages(account, chat.mid, [{ id: "101", chatMid: chat.mid, from: "u-self", to: chat.mid, contentType: "TEXT", text: "latest sent", isMyMessage: true, createdTime: 1200, savedAt: now }]);
    expect((await getStoredChats(account))[0]).toMatchObject({ lastMessageId: "101", lastMessagePreview: "あなた: latest sent" });
    await upsertChats(account, [{ ...chat, lastMessageId: "100", lastMessageTime: 1600, lastMessagePreview: "old incoming" }]);
    expect((await getStoredChats(account))[0]).toMatchObject({ lastMessageId: "101", lastMessagePreview: "あなた: latest sent" });
  });

  afterAll(async () => {
    for (const id of [
      accountId,
      "sqlite-schema-v1",
      "sqlite-local-reader",
      "sqlite-other-reader",
      "sqlite-retired-operations",
      "sqlite-preview-cursor",
      "sqlite-revoke-originals",
      "sqlite-pending-revoke",
      "sqlite-local-deletions",
      "sqlite-local-deletions-clone",
      "retention-late-original",
      "retention-selected-source",
      "retention-selected-target",
      "retention-empty-preview",
      "retention-restored-preview",
      "retention-pending-source",
      "retention-pending-marker",
      "retention-pending-target",
      "retention-own-read-refresh",
      "retention-stale-empty-chat",
      "retention-stale-nonempty-chat",
      "retention-stale-missing-chat",
      "retention-staged-original-source",
      "retention-staged-placeholder-source",
      "retention-staged-original-target",
      "snapshot-target",
      "snapshot-legacy-target",
      "snapshot-over-quota",
      "sqlite-large-source",
      "sqlite-large-target",
      "sqlite-large-over-quota",
    ]) {
      await flushAccountChatDb(id).catch(() => undefined);
      await closeAccountChatDb(id).catch(() => undefined);
    }
    await fs.rm(root, { recursive: true, force: true });
  });

  describe("SQLite chat persistence", () => {
    test("retention follow-up: stale chat metadata cannot restore a deleted preview or replace a newer valid cursor", async () => {
      for (const initial of ["missing", "empty", "nonempty"]) {
        const keepOlder = initial === "nonempty";
        const account = `retention-stale-${initial}-chat`;
        const chatMid = "c-retention-stale-chat";
        const chat = { mid: chatMid, name: "fixture", kind: "group" as const, hasMessages: true, unreadCount: 7, updatedAt: now };
        const original = { id: "100", chatMid, from: "u-peer", to: chatMid, text: "deleted private text",
          contentType: "NONE", createdTime: 1000, isMyMessage: false, savedAt: now };
        if (initial !== "missing") await upsertChats(account, [chat]);
        await upsertMessages(account, chatMid, [...(keepOlder ? [{ ...original, id: "99", text: "remaining older text", createdTime: 900 }] : []), original]);
        await markMessageRevoked(account, chatMid, original.id);
        expect(await deleteLocalRevokedMessage(account, chatMid, original.id)).toBe(true);
        await closeAccountChatDb(account);
        await upsertChats(account, [{ ...chat, name: "updated name", unreadCount: 9,
          lastMessageId: original.id, lastMessageTime: 1000, lastMessagePreview: original.text }]);
        const [afterStaleSync] = await getStoredChats(account);
        expect(afterStaleSync).toMatchObject({ name: "updated name", unreadCount: 9, hasMessages: keepOlder });
        expect(afterStaleSync?.lastMessageId).toBe(keepOlder ? "99" : undefined);
        expect(afterStaleSync?.lastMessagePreview).toBe(keepOlder ? "remaining older text" : undefined);
        expect((await getStoredMessages(account, chatMid, 10)).map(message => message.id)).toEqual(keepOlder ? ["99"] : []);

        await upsertChats(account, [{ ...chat, unreadCount: 11, lastMessageId: "200", lastMessageTime: 2000, lastMessagePreview: "newer server message" }]);
        await upsertChats(account, [{ ...chat, unreadCount: 12, lastMessageId: original.id,
          lastMessageTime: 1000, lastMessagePreview: original.text }]);
        expect((await getStoredChats(account))[0]).toMatchObject({ lastMessageId: "200", lastMessageTime: 2000,
          lastMessagePreview: "newer server message", unreadCount: 12 });
      }
    });

    test("retention follow-up: only a genuine staged original fills an UNSENT snapshot and its media metadata", async () => {
      const source = "retention-staged-original-source";
      const placeholders = "retention-staged-placeholder-source";
      const target = "retention-staged-original-target";
      const chatMid = "c-retention-staged-original";
      const original = { id: "100", chatMid, from: "u-peer", to: chatMid, text: "original image caption",
        contentType: "IMAGE", createdTime: 1000, isMyMessage: false, savedAt: now,
        contentMetadata: { OID: "fixture-object", SID: "fixture-service", keyMaterial: "fixture-key" },
        relatedMessageId: "99", readBy: ["u-reader"], readByAt: { "u-reader": 1234 } };
      const own = { ...original, id: "200", from: "u-self", isMyMessage: true, text: "restored own image", createdTime: 900 };
      const lateOwn = { ...own, id: "300", text: "late own original", createdTime: 800 };
      const placeholder = { ...original, text: null, contentType: "UNSENT", contentMetadata: null };
      await upsertChats(source, [{ mid: chatMid, name: "fixture", kind: "group", hasMessages: true, unreadCount: 7, updatedAt: now }]);
      await upsertChats(target, [{ mid: chatMid, name: "fixture", kind: "group", hasMessages: true, unreadCount: 7, updatedAt: now }]);
      await upsertMessages(source, chatMid, [original, own, lateOwn]);
      await upsertMessages(placeholders, chatMid, [placeholder]);
      await markMessageRevoked(target, chatMid, lateOwn.id);
      await upsertMessages(target, chatMid, [{ ...placeholder, readByAt: { "u-reader": 1000 } }, own]);
      await upsertMessages(target, chatMid, [{ ...lateOwn, text: null, contentType: "UNSENT", contentMetadata: null }]);
      await markMessageRevoked(target, chatMid, own.id);
      await restoreRevokedMessage(target, chatMid, own.id);
      const ownBefore = (await getStoredMessages(target, chatMid, 10)).find(message => message.id === own.id);
      const originalSnapshot = join(root, "retention-staged-original.sqlite");
      const placeholderSnapshot = join(root, "retention-staged-placeholder.sqlite");
      await createAccountChatSnapshot(source, originalSnapshot);
      await createAccountChatSnapshot(placeholders, placeholderSnapshot);
      await mergeAccountChatSnapshot(target, placeholderSnapshot);
      expect((await getStoredMessages(target, chatMid, 10)).find(message => message.id === original.id)?.revokedSnapshot).toBeUndefined();
      const revokedSnapshot = join(root, "retention-staged-revoked-with-original-type.sqlite");
      await fs.copyFile(originalSnapshot, revokedSnapshot);
      const revokedDb = new Database(revokedSnapshot);
      try {
        revokedDb.query("UPDATE staged_messages SET message_state = 'revoked-by-other' WHERE id = ?").run(original.id);
      } finally {
        revokedDb.close();
      }
      await mergeAccountChatSnapshot(target, revokedSnapshot);
      expect((await getStoredMessages(target, chatMid, 10)).find(message => message.id === original.id)?.revokedSnapshot).toBeUndefined();
      await closeAccountChatDb(target);
      await mergeAccountChatSnapshot(target, originalSnapshot);
      await closeAccountChatDb(target);

      const messages = await getStoredMessages(target, chatMid, 10);
      const retained = messages.find(message => message.id === original.id);
      expect(retained).toMatchObject({ messageState: "revoked-by-other", contentType: "UNSENT", text: null,
        contentMetadata: original.contentMetadata, relatedMessageId: "99", readByAt: { "u-reader": 1000 },
        revokedSnapshot: { text: original.text, contentType: "IMAGE", contentMetadata: original.contentMetadata, relatedMessageId: "99" } });
      expect(retained?.history).toHaveLength(1);
      expect(messages.find(message => message.id === own.id)).toMatchObject({ messageState: "normal", text: own.text,
        contentType: "IMAGE", revokedSnapshot: ownBefore?.revokedSnapshot, readByAt: { "u-reader": 1234 } });
      expect((await getStoredChats(target))[0]).toMatchObject({ unreadCount: 7, lastMessageId: original.id,
        lastMessagePreview: `取り消し済み: ${original.text}` });
      await mergeAccountChatSnapshot(target, originalSnapshot);
      expect((await getStoredMessages(target, chatMid, 10)).find(message => message.id === original.id)).toEqual(retained);
      await restoreRevokedMessage(target, chatMid, lateOwn.id);
      const restoredOwn = (await getStoredMessages(target, chatMid, 10)).find(message => message.id === lateOwn.id);
      await upsertMessages(target, chatMid, [{ ...lateOwn, messageState: "normal", revokedSnapshot: restoredOwn?.revokedSnapshot }]);
      expect((await getStoredMessages(target, chatMid, 10)).find(message => message.id === lateOwn.id)).toMatchObject({
        messageState: "normal", text: lateOwn.text, contentType: "IMAGE", readByAt: { "u-reader": 1234 },
      });
    });

    test("retention regression: an original arriving after UNSENT and restart is captured once", async () => {
      const account = "retention-late-original";
      const chatMid = "c-retention-late-original";
      const original = { id: "100", chatMid, from: "u-peer", to: chatMid, text: "late original image",
        contentType: "IMAGE", createdTime: 1000, isMyMessage: false, savedAt: now,
        contentMetadata: { OID: "fixture-object", keyMaterial: "fixture-key" }, relatedMessageId: "99",
        readBy: ["u-reader"], readByAt: { "u-reader": 1234 } };
      await upsertMessages(account, chatMid, [{ ...original, text: null, contentType: "UNSENT", contentMetadata: null }]);
      await closeAccountChatDb(account);
      await upsertMessages(account, chatMid, [original]);
      await upsertMessages(account, chatMid, [{ ...original, readByAt: { "u-reader": 5678 } }]);
      await closeAccountChatDb(account);

      const [retained] = await getStoredMessages(account, chatMid, 10);
      expect(retained).toMatchObject({ messageState: "revoked-by-other", text: null,
        revokedSnapshot: { text: original.text, contentType: "IMAGE", contentMetadata: original.contentMetadata,
          relatedMessageId: "99" }, readByAt: { "u-reader": 1234 } });
      expect(retained?.history).toHaveLength(1);
    });

    test("retention regression: selected-chat snapshots carry local deletion markers into a fresh DB", async () => {
      const source = "retention-selected-source";
      const target = "retention-selected-target";
      const chatMid = "c-retention-selected";
      const original = { id: "100", chatMid, from: "u-peer", to: chatMid, text: "selected deleted original",
        contentType: "NONE", createdTime: 1000, isMyMessage: false, savedAt: now };
      await upsertChats(source, [{ mid: chatMid, name: "fixture", kind: "group", hasMessages: true, updatedAt: now }]);
      await upsertMessages(source, chatMid, [original]);
      await markMessageRevoked(source, chatMid, original.id);
      expect(await deleteLocalRevokedMessage(source, chatMid, original.id)).toBe(true);
      const snapshot = join(root, "retention-selected-deleted.sqlite");
      await createAccountChatSnapshot(source, snapshot, [chatMid]);
      await mergeAccountChatSnapshot(target, snapshot, [chatMid]);
      await closeAccountChatDb(target);
      await upsertMessages(target, chatMid, [original]);
      await markMessageRevoked(target, chatMid, original.id);
      expect(await getStoredMessages(target, chatMid, 10)).toEqual([]);
    });

    test("retention regression: deleting the only message clears its chat preview and cursor", async () => {
      const account = "retention-empty-preview";
      const chatMid = "c-retention-empty-preview";
      const original = { id: "100", chatMid, from: "u-peer", to: chatMid, text: "deleted private text",
        contentType: "NONE", createdTime: 1000, isMyMessage: false, savedAt: now };
      await upsertChats(account, [{ mid: chatMid, name: "fixture", kind: "group", hasMessages: true, updatedAt: now }]);
      await upsertMessages(account, chatMid, [original]);
      await markMessageRevoked(account, chatMid, original.id);
      expect(await deleteLocalRevokedMessage(account, chatMid, original.id)).toBe(true);
      await closeAccountChatDb(account);
      expect(await getStoredMessages(account, chatMid, 10)).toEqual([]);
      const chat = (await getStoredChats(account)).find(item => item.mid === chatMid);
      expect(chat?.lastMessagePreview ?? "").not.toContain(original.text);
      expect(chat?.lastMessageId).not.toBe(original.id);
    });

    test("retention regression: an older snapshot cannot restore a deleted last-message preview", async () => {
      const account = "retention-restored-preview";
      const chatMid = "c-retention-restored-preview";
      const original = { id: "100", chatMid, from: "u-peer", to: chatMid, text: "deleted newer text",
        contentType: "NONE", createdTime: 1000, isMyMessage: false, savedAt: now };
      await upsertChats(account, [{ mid: chatMid, name: "fixture", kind: "group", hasMessages: true, updatedAt: now }]);
      await upsertMessages(account, chatMid, [{ ...original, id: "99", text: "remaining older text", createdTime: 900 }, original]);
      await markMessageRevoked(account, chatMid, original.id);
      const snapshot = join(root, "retention-deleted-preview.sqlite");
      await createAccountChatSnapshot(account, snapshot);
      expect(await deleteLocalRevokedMessage(account, chatMid, original.id)).toBe(true);
      await mergeAccountChatSnapshot(account, snapshot);
      await closeAccountChatDb(account);

      expect((await getStoredMessages(account, chatMid, 10)).map(message => message.id)).toEqual(["99"]);
      expect((await getStoredChats(account)).find(item => item.mid === chatMid)).toMatchObject({
        lastMessageId: "99", lastMessageTime: 900, lastMessagePreview: "remaining older text",
      });
    });

    test("retention regression: restoring a pending revoke before an older original snapshot keeps it revoked", async () => {
      const source = "retention-pending-source";
      const marker = "retention-pending-marker";
      const target = "retention-pending-target";
      const chatMid = "c-retention-pending";
      const original = { id: "100", chatMid, from: "u-peer", to: chatMid, text: "original from older snapshot",
        contentType: "IMAGE", createdTime: 1000, isMyMessage: false, savedAt: now,
        contentMetadata: { OID: "fixture-object", keyMaterial: "fixture-key" },
        readBy: ["u-reader"], readByAt: { "u-reader": 1234 } };
      await upsertChats(source, [{ mid: chatMid, name: "fixture", kind: "group", hasMessages: true, updatedAt: now }]);
      await upsertMessages(source, chatMid, [original]);
      const originalSnapshot = join(root, "retention-pending-original.sqlite");
      const pendingSnapshot = join(root, "retention-pending-marker.sqlite");
      await createAccountChatSnapshot(source, originalSnapshot);
      await markMessageRevoked(marker, chatMid, original.id);
      await createAccountChatSnapshot(marker, pendingSnapshot);
      await mergeAccountChatSnapshot(target, pendingSnapshot);
      await closeAccountChatDb(target);
      await mergeAccountChatSnapshot(target, originalSnapshot);
      await closeAccountChatDb(target);

      expect((await getStoredMessages(target, chatMid, 10))[0]).toMatchObject({
        messageState: "revoked-by-other", text: null, contentType: "UNSENT",
        revokedSnapshot: { text: original.text, contentType: "IMAGE", contentMetadata: original.contentMetadata },
        readByAt: { "u-reader": 1234 },
      });
    });

    test("retention regression: refreshing read receipts keeps an explicitly restored own message normal", async () => {
      const account = "retention-own-read-refresh";
      const chatMid = "c-retention-own-read-refresh";
      const original = { id: "100", chatMid, from: "u-self", to: chatMid, text: "restored own original",
        contentType: "NONE", createdTime: 1000, isMyMessage: true, savedAt: now,
        readBy: ["u-reader"], readByAt: { "u-reader": 1234 } };
      await upsertMessages(account, chatMid, [original]);
      await markMessageRevoked(account, chatMid, original.id);
      await restoreRevokedMessage(account, chatMid, original.id);
      expect((await getStoredMessages(account, chatMid, 10))[0]?.messageState).toBe("normal");
      const manager = await import("../line/clientManager.js");
      const { AuthService } = await import("../auth/mod.js");
      const { getReadReceiptsForChat } = await import("../service/lineService.js");
      const client = { base: { profile: { mid: "u-self" },
        talk: { getMessageReadRange: async () => ({ readRanges: [] }) } } } as never;
      spyOn(manager, "getClient").mockReturnValue(client);
      spyOn(AuthService, "tryRefreshToken").mockResolvedValue(undefined);
      try {
        const receipts = await getReadReceiptsForChat(account, chatMid, [original.id]);
        expect(receipts.receipts[original.id]?.readByAt).toEqual({ "u-reader": 1234 });
        await closeAccountChatDb(account);
        expect((await getStoredMessages(account, chatMid, 10))[0]).toMatchObject({
          messageState: "normal", text: original.text, contentType: "NONE", readByAt: { "u-reader": 1234 },
        });
      } finally {
        mock.restore();
      }
    });

    test("explicit local deletion survives replay, restart and restoring an older snapshot", async () => {
      const accountId = "sqlite-local-deletions";
      const chatMid = "c-local-deletions";
      const original = { id: "100", chatMid, from: "u-peer", to: chatMid, text: "delete only by request",
        contentType: "NONE", createdTime: 1000, isMyMessage: false, savedAt: now };
      await upsertChats(accountId, [{ mid: chatMid, name: "fixture", kind: "group", hasMessages: true, updatedAt: now }]);
      await upsertMessages(accountId, chatMid, [original]);
      expect(await deleteLocalRevokedMessage(accountId, chatMid, "100")).toBe(false);
      await markMessageRevoked(accountId, chatMid, "100");
      const snapshot = join(root, "before-local-delete.sqlite");
      await createAccountChatSnapshot(accountId, snapshot);
      expect(await deleteLocalRevokedMessage(accountId, chatMid, "100")).toBe(true);
      await closeAccountChatDb(accountId);
      await upsertMessages(accountId, chatMid, [original]);
      await markMessageRevoked(accountId, chatMid, "100");
      expect(await getStoredMessages(accountId, chatMid, 10)).toEqual([]);
      await mergeAccountChatSnapshot(accountId, snapshot);
      expect(await getStoredMessages(accountId, chatMid, 10)).toEqual([]);
      const deletedSnapshot = join(root, "after-local-delete.sqlite");
      await createAccountChatSnapshot(accountId, deletedSnapshot);
      const clone = "sqlite-local-deletions-clone";
      await mergeAccountChatSnapshot(clone, deletedSnapshot);
      await upsertMessages(clone, chatMid, [original]);
      expect(await getStoredMessages(clone, chatMid, 10)).toEqual([]);
      await upsertMessages(accountId, "c-local-delete-other", [{ ...original, chatMid: "c-local-delete-other" }]);
      expect(await getStoredMessages(accountId, "c-local-delete-other", 10)).toHaveLength(1);
    });
    test("unsent history placeholders preserve original attachments and duplicate revokes are idempotent", async () => {
      const accountId = "sqlite-revoke-originals";
      const chatMid = "c-revoke-originals";
      for (const contentType of ["NONE", "STICKER", "IMAGE", "VIDEO", "AUDIO", "FILE"]) {
        const id = `retained-${contentType}`;
        const original = { id, chatMid, from: "u-peer", to: chatMid, text: `original ${contentType}`,
          contentType, createdTime: 1000, isMyMessage: false, savedAt: now,
          contentMetadata: { OID: "fixture-object", keyMaterial: "fixture-key" }, relatedMessageId: "99",
          readBy: ["u-reader"], readByAt: { "u-reader": 1234 } };
        await upsertMessages(accountId, chatMid, [original]);
        await upsertMessages(accountId, chatMid, [{ ...original, text: null, contentType: "UNSENT", contentMetadata: null }]);
        await markMessageRevoked(accountId, chatMid, id);
        await markMessageRevoked(accountId, chatMid, id);
        await upsertMessages(accountId, chatMid, [original]);
        const stored = (await getStoredMessages(accountId, chatMid, 100)).find(message => message.id === id);
        expect(stored?.messageState).toBe("revoked-by-other");
        expect(stored?.revokedSnapshot).toMatchObject({ text: original.text, contentType,
          contentMetadata: original.contentMetadata, relatedMessageId: "99" });
        expect(stored?.history).toHaveLength(1);
        expect(stored?.readByAt).toEqual({ "u-reader": 1234 });
      }
      await closeAccountChatDb(accountId);
      expect((await getStoredMessages(accountId, chatMid, 100)).every(message => message.revokedSnapshot?.text?.startsWith("original"))).toBe(true);
    });

    test("a revoke before the original is durable and scoped to account and chat", async () => {
      const accountId = "sqlite-pending-revoke";
      const chatMid = "c-pending-revoke";
      await markMessageRevoked(accountId, chatMid, "101");
      await closeAccountChatDb(accountId);
      const original = { id: "101", chatMid, from: "u-peer", to: chatMid, text: "late original", contentType: "NONE",
        createdTime: 1000, isMyMessage: false, savedAt: now };
      await upsertMessages(accountId, chatMid, [original]);
      expect((await getStoredMessages(accountId, chatMid, 10))[0]?.revokedSnapshot?.text).toBe("late original");
      await upsertMessages(accountId, "c-another", [{ ...original, chatMid: "c-another" }]);
      expect((await getStoredMessages(accountId, "c-another", 10))[0]?.revokedSnapshot).toBeUndefined();
    });
    test("retired operation ownership prevents message, read and revoke writes after opening the DB", async () => {
      const scopedAccount = "sqlite-retired-operations";
      const chatMid = "c-retired-operation";
      const message = { id: "100", chatMid, from: "u-peer", to: "u-self", text: "kept",
        contentType: "NONE", createdTime: Date.now(), isMyMessage: false, savedAt: now };
      let current = true;
      const insert = upsertMessages(scopedAccount, chatMid, [message], () => current);
      current = false;
      await insert;
      expect(await getStoredMessages(scopedAccount, chatMid, 10)).toEqual([]);
      await upsertMessages(scopedAccount, chatMid, [message]);
      current = true;
      const read = recordMemberReadThrough(scopedAccount, chatMid, "u-reader", "100", Date.now(), () => current);
      current = false;
      await read;
      const revoke = markMessageRevoked(scopedAccount, chatMid, "100", () => current);
      await revoke;
      const stored = (await getStoredMessages(scopedAccount, chatMid, 10))[0];
      if (!stored) throw new Error("the active session message disappeared");
      expect(stored.text).toBe("kept");
      expect(stored.readBy ?? []).toEqual([]);
      expect(stored.revokedSnapshot).toBeUndefined();
    });
    test("ignores legacy chatdb.json and opens WAL SQLite without hydrating it", async () => {
      await fs.mkdir(join(root, "accounts", accountId), { recursive: true });
      await fs.writeFile(
        accountFile(accountId, "chatdb.json"),
        JSON.stringify({
          meta: {},
          chats: {
            "u-legacy": {
              mid: "u-legacy",
              name: "legacy",
              kind: "direct",
              hasMessages: true,
              updatedAt: now,
            },
          },
          messages: {},
        }),
      );

      await warmAccountCache(accountId);
      expect(await getStoredChats(accountId)).toEqual([]);

      const sqlitePath = accountFile(accountId, "chatdb.sqlite");
      expect((await fs.stat(sqlitePath)).size).toBeGreaterThan(0);
      const db = new Database(sqlitePath, { readonly: true });
      expect((db.query("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode).toBe(
        "wal",
      );
      db.close();
    });

    test("persists messages and pages history from the indexed store", async () => {
      await upsertChats(accountId, [
        {
          mid: "u-peer",
          name: "Peer",
          kind: "direct",
          hasMessages: true,
          lastMessageTime: 3,
          lastMessageId: "3",
          lastMessagePreview: "three",
          updatedAt: now,
        },
      ]);
      await upsertMessages(accountId, "u-peer", [
        {
          id: "1",
          chatMid: "u-peer",
          from: "u-peer",
          to: "u-self",
          text: "one",
          contentType: "NONE",
          createdTime: 1,
          isMyMessage: false,
          savedAt: now,
        },
        {
          id: "2",
          chatMid: "u-peer",
          from: "u-peer",
          to: "u-self",
          text: "two",
          contentType: "NONE",
          createdTime: 2,
          isMyMessage: false,
          savedAt: now,
        },
        {
          id: "3",
          chatMid: "u-peer",
          from: "u-self",
          to: "u-peer",
          text: "three",
          contentType: "NONE",
          createdTime: 3,
          isMyMessage: true,
          readBy: ["u-reader"],
          readByAt: { "u-reader": 10_000 },
          readCount: 1,
          savedAt: now,
        },
      ]);

      expect((await getStoredMessages(accountId, "u-peer", 2)).map((m) => m.id)).toEqual([
        "3",
        "2",
      ]);
      expect(
        (
          await getStoredMessages(accountId, "u-peer", 10, {
            beforeDeliveredTime: 2,
            beforeMessageId: "2",
          })
        ).map((m) => m.id),
      ).toEqual(["1"]);
      expect((await exportChatDb(accountId)).messages["u-peer"]?.["3"]?.text).toBe("three");
      expect((await exportChatDb(accountId)).messages["u-peer"]?.["3"]?.readByAt).toEqual({
        "u-reader": 10_000,
      });
    });

    test("migrates an existing v1 messages table without losing history", async () => {
      const legacyAccountId = "sqlite-schema-v1";
      await fs.mkdir(join(root, "accounts", legacyAccountId), { recursive: true });
      const legacyDb = new Database(accountFile(legacyAccountId, "chatdb.sqlite"), {
        create: true,
      });
      legacyDb.exec(`
        CREATE TABLE messages (
          id TEXT NOT NULL,
          chat_mid TEXT NOT NULL,
          from_mid TEXT NOT NULL,
          to_mid TEXT NOT NULL,
          text TEXT,
          content_type TEXT NOT NULL,
          created_time INTEGER NOT NULL,
          is_my_message INTEGER NOT NULL,
          content_metadata TEXT,
          read_count INTEGER,
          read_by TEXT,
          seen INTEGER,
          related_message_id TEXT,
          sticker_animated INTEGER,
          sticker_sticky INTEGER,
          reactions TEXT,
          saved_at TEXT NOT NULL,
          message_state TEXT,
          history TEXT,
          revoked_snapshot TEXT,
          PRIMARY KEY (chat_mid, id)
        ) WITHOUT ROWID;
        INSERT INTO messages (
          id, chat_mid, from_mid, to_mid, text, content_type, created_time,
          is_my_message, read_count, read_by, saved_at
        ) VALUES (
          '10', 'c-legacy', 'u-sender', 'c-legacy', 'legacy', 'NONE', 10,
          0, 1, '["u-reader"]', '${now}'
        );
        PRAGMA user_version = 1;
      `);
      legacyDb.close();

      await warmAccountCache(legacyAccountId);
      const migrated = await getStoredMessages(legacyAccountId, "c-legacy", 10);
      expect(migrated[0]).toMatchObject({ id: "10", readBy: ["u-reader"], readCount: 1 });
      expect(migrated[0]?.readByAt).toBeUndefined();

      await upsertMessages(legacyAccountId, "c-legacy", [
        {
          id: "10",
          chatMid: "c-legacy",
          from: "u-sender",
          to: "c-legacy",
          text: "legacy",
          contentType: "NONE",
          createdTime: 10,
          isMyMessage: false,
          readBy: ["u-reader"],
          readByAt: { "u-reader": 10_000 },
          readCount: 1,
          savedAt: now,
        },
      ]);
      expect((await getStoredMessages(legacyAccountId, "c-legacy", 10))[0]?.readByAt).toEqual({
        "u-reader": 10_000,
      });
    });

    test("records the local member's first read time only for newly read group messages", async () => {
      const localReaderAccountId = "sqlite-local-reader";
      const chatMid = "c-local-reader";
      await upsertMessages(localReaderAccountId, chatMid, [
        {
          id: "100",
          chatMid,
          from: "u-sender",
          to: chatMid,
          text: "A",
          contentType: "NONE",
          createdTime: 1_000,
          isMyMessage: false,
          savedAt: now,
        },
        {
          id: "200",
          chatMid,
          from: "u-sender",
          to: chatMid,
          text: "B",
          contentType: "NONE",
          createdTime: 2_000,
          isMyMessage: false,
          savedAt: now,
        },
      ]);

      await markStoredMessagesReadThrough(localReaderAccountId, chatMid, "100", {
        readerMid: "u-self",
        readAt: 10_000,
      });
      await markStoredMessagesReadThrough(localReaderAccountId, chatMid, "200", {
        readerMid: "u-self",
        readAt: 11_000,
      });

      const messages = new Map(
        (await getStoredMessages(localReaderAccountId, chatMid, 10)).map((message) => [
          message.id,
          message,
        ]),
      );
      expect(messages.get("100")?.readByAt).toEqual({ "u-self": 10_000 });
      expect(messages.get("200")?.readByAt).toEqual({ "u-self": 11_000 });

      await markStoredMessagesReadThrough(localReaderAccountId, chatMid, "200", {
        readerMid: "u-self",
        readAt: 12_000,
      });
      expect(
        (await getStoredMessages(localReaderAccountId, chatMid, 10)).find(
          (message) => message.id === "100",
        )?.readByAt,
      ).toEqual({ "u-self": 10_000 });
    });

    test("preserves earliest readByAt for other members on other-authored messages when a later read notification arrives", async () => {
      const testAccountId = "sqlite-other-reader";
      const chatMid = "c-group-test-read-protection";
      const now = new Date().toISOString();
      await upsertChats(testAccountId, [
        {
          mid: chatMid,
          name: "Group Read Test",
          kind: "group",
          hasMessages: true,
          updatedAt: now,
        },
      ]);
      await upsertMessages(testAccountId, chatMid, [
        {
          id: "100",
          chatMid,
          from: "u-sender-other",
          to: chatMid,
          text: "Message A",
          contentType: "NONE",
          createdTime: 1_000,
          isMyMessage: false,
          savedAt: now,
        },
        {
          id: "200",
          chatMid,
          from: "u-sender-other",
          to: chatMid,
          text: "Message B",
          contentType: "NONE",
          createdTime: 2_000,
          isMyMessage: false,
          savedAt: now,
        },
      ]);

      // メンバーXが 10:00 (10_000ms) に メッセージA(100) を読んだ
      await recordMemberReadThrough(testAccountId, chatMid, "u-member-x", "100", 10_000);

      let messages = new Map(
        (await getStoredMessages(testAccountId, chatMid, 10)).map((m) => [m.id, m]),
      );
      expect(messages.get("100")?.readByAt).toEqual({ "u-member-x": 10_000 });
      expect(messages.get("100")?.readBy).toEqual(["u-member-x"]);

      // メンバーXが 11:00 (11_000ms) に メッセージB(200) を読んだ
      await recordMemberReadThrough(testAccountId, chatMid, "u-member-x", "200", 11_000);

      messages = new Map(
        (await getStoredMessages(testAccountId, chatMid, 10)).map((m) => [m.id, m]),
      );
      // メッセージA の既読時刻は 10_000 のまま保持され、11_000 に上書きされない！
      expect(messages.get("100")?.readByAt).toEqual({ "u-member-x": 10_000 });
      // メッセージB の既読時刻は 11_000
      expect(messages.get("200")?.readByAt).toEqual({ "u-member-x": 11_000 });

      // さらに別の同期で メッセージA に 12_000 の readByAt を含む upsert が来ても保護される！
      await upsertMessages(testAccountId, chatMid, [
        {
          id: "100",
          chatMid,
          from: "u-sender-other",
          to: chatMid,
          text: "Message A",
          contentType: "NONE",
          createdTime: 1_000,
          isMyMessage: false,
          savedAt: now,
          readBy: ["u-member-x"],
          readByAt: { "u-member-x": 12_000 },
        },
      ]);
      messages = new Map(
        (await getStoredMessages(testAccountId, chatMid, 10)).map((m) => [m.id, m]),
      );
      expect(messages.get("100")?.readByAt).toEqual({ "u-member-x": 10_000 });
    });

    test("rolls back an imported restore when its SQLite page budget is exceeded", async () => {
      const before = await exportChatDb(accountId);
      const incoming = {
        chats: {},
        messages: {
          "u-peer": {
            "99": {
              id: "99",
              chatMid: "u-peer",
              from: "u-peer",
              to: "u-self",
              text: "must roll back",
              contentType: "NONE",
              createdTime: 99,
              isMyMessage: false,
              savedAt: now,
            },
          },
        },
      };
      await expect(mergeImportedChatDb(accountId, incoming, 1)).rejects.toThrow("10GB");
      expect(await exportChatDb(accountId)).toEqual(before);
    });

    test("round-trips a normalized SQLite snapshot and keeps quota failure atomic", async () => {
      const snapshotPath = join(root, "chat-snapshot.sqlite");
      const progress: Array<{ phase: string; current: number; total: number }> = [];
      expect(
        await createAccountChatSnapshot(accountId, snapshotPath, undefined, (entry) =>
          progress.push(entry),
        ),
      ).toEqual({ chats: 1, messages: 3 });
      expect(progress.some((entry) => entry.phase === "messages" && entry.current === 3)).toBe(
        true,
      );
      const snapshotDb = new Database(snapshotPath, { readonly: true });
      const snapshotIndexes = snapshotDb
        .query("PRAGMA index_list(staged_messages)")
        .all() as Array<{
        name: string;
      }>;
      snapshotDb.close();
      expect(snapshotIndexes.some((index) => index.name === "idx_staged_messages_chat_time")).toBe(
        false,
      );

      expect(await mergeAccountChatSnapshot("snapshot-target", snapshotPath, ["u-peer"])).toEqual({
        importedChats: 1,
        skippedChats: 0,
        importedMessages: 3,
        skippedMessages: 0,
      });
      expect(
        (await getStoredMessages("snapshot-target", "u-peer", 10)).map((row) => row.id),
      ).toEqual(["3", "2", "1"]);
      expect(
        (await getStoredMessages("snapshot-target", "u-peer", 10)).find((row) => row.id === "3")
          ?.readByAt,
      ).toEqual({ "u-reader": 10_000 });

      const legacySnapshotPath = join(root, "legacy-chat-snapshot.sqlite");
      await fs.copyFile(snapshotPath, legacySnapshotPath);
      const legacySnapshotDb = new Database(legacySnapshotPath);
      legacySnapshotDb.exec("ALTER TABLE staged_messages DROP COLUMN read_by_at");
      legacySnapshotDb.close();
      expect(
        await mergeAccountChatSnapshot("snapshot-legacy-target", legacySnapshotPath, ["u-peer"]),
      ).toEqual({
        importedChats: 1,
        skippedChats: 0,
        importedMessages: 3,
        skippedMessages: 0,
      });
      expect(
        (await getStoredMessages("snapshot-legacy-target", "u-peer", 10)).map((row) => row.id),
      ).toEqual(["3", "2", "1"]);
      expect(
        await fs
          .stat(`${accountFile("snapshot-target", "chatdb.sqlite")}-wal`)
          .then((entry) => entry.size)
          .catch(() => 0),
      ).toBe(0);
      expect(await mergeAccountChatSnapshot("snapshot-target", snapshotPath, ["u-peer"])).toEqual({
        importedChats: 0,
        skippedChats: 1,
        importedMessages: 0,
        skippedMessages: 3,
      });

      await expect(
        mergeAccountChatSnapshot("snapshot-over-quota", snapshotPath, undefined, 1),
      ).rejects.toThrow("10GB");
      expect(await getStoredChats("snapshot-over-quota")).toEqual([]);
    });

    test("keeps 100k-row storage accounting constant-time and yields between snapshot batches", async () => {
      const largeSource = "sqlite-large-source";
      await warmAccountCache(largeSource);
      await closeAccountChatDb(largeSource);
      const seed = new Database(accountFile(largeSource, "chatdb.sqlite"));
      seed.exec(`
          INSERT INTO chats (
            mid, name, kind, has_messages, last_message_time, last_message_id,
            last_message_preview, updated_at
          ) VALUES ('u-large', 'Large', 'direct', 1, 100000, '100000', 'last', '${now}');
          WITH RECURSIVE sequence(value) AS (
            VALUES(1)
            UNION ALL
            SELECT value + 1 FROM sequence WHERE value < 100000
          )
          INSERT INTO messages (
            id, chat_mid, from_mid, to_mid, text, content_type, created_time,
            is_my_message, saved_at
          )
          SELECT
            printf('%d', value), 'u-large', 'u-large', 'u-self', 'message',
            'NONE', value, 0, '${now}'
          FROM sequence;
        `);
      seed.close();

      const startedAt = performance.now();
      expect(await getChatDbLogicalStorageBytes(largeSource)).toBeGreaterThan(0);
      expect(performance.now() - startedAt).toBeLessThan(1_000);

      let timerTicks = 0;
      let maximumTimerGapMs = 0;
      let previousTimerAt = performance.now();
      const timer = setInterval(() => {
        const currentTimerAt = performance.now();
        maximumTimerGapMs = Math.max(maximumTimerGapMs, currentTimerAt - previousTimerAt);
        previousTimerAt = currentTimerAt;
        timerTicks++;
      }, 1);
      const snapshotPath = join(root, "large-chat-snapshot.sqlite");
      const progress: number[] = [];
      try {
        expect(
          await createAccountChatSnapshot(largeSource, snapshotPath, undefined, (entry) => {
            if (entry.phase === "messages") progress.push(entry.current);
          }),
        ).toEqual({ chats: 1, messages: 100000 });
        expect(await mergeAccountChatSnapshot("sqlite-large-target", snapshotPath)).toEqual({
          importedChats: 1,
          skippedChats: 0,
          importedMessages: 100000,
          skippedMessages: 0,
        });

        const quotaProgress: number[] = [];
        await expect(
          mergeAccountChatSnapshot(
            "sqlite-large-over-quota",
            snapshotPath,
            undefined,
            1024 * 1024,
            (entry) => {
              if (entry.phase === "messages") quotaProgress.push(entry.current);
            },
          ),
        ).rejects.toThrow("10GB");
        expect(Math.max(...quotaProgress)).toBeGreaterThan(0);
        expect(Math.max(...quotaProgress)).toBeLessThanOrEqual(10_000);
        expect(await getStoredChats("sqlite-large-over-quota")).toEqual([]);
      } finally {
        clearInterval(timer);
      }
      expect(progress.length).toBeGreaterThanOrEqual(200);
      expect(timerTicks).toBeGreaterThan(10);
      expect(maximumTimerGapMs).toBeLessThan(1_000);
    }, 60_000);
  });
}
