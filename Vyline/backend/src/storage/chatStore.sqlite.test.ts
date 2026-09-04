import { afterAll, describe, expect, test } from "bun:test";
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

  afterAll(async () => {
    for (const id of [
      accountId,
      "sqlite-schema-v1",
      "sqlite-local-reader",
      "sqlite-other-reader",
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
