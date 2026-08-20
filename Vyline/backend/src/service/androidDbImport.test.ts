import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readAndroidLineDatabase } from "./androidDbImport.js";
import { sniffRestoredMediaType } from "./androidZipImport.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixturePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "vyline-android-db-"));
  dirs.push(dir);
  return join(dir, "naver_line.sqlite");
}

describe("Android LINE database import", () => {
  test("maps LEINs chat and chat_history rows without modifying the source", async () => {
    const path = await fixturePath();
    const db = new Database(path, { create: true, strict: true });
    db.exec(`
      CREATE TABLE chat (
        chat_id TEXT PRIMARY KEY,
        chat_name TEXT,
        last_message TEXT,
        last_created_time INTEGER,
        message_count INTEGER,
        read_message_count INTEGER
      );
      CREATE TABLE chat_history (
        id INTEGER PRIMARY KEY,
        server_id TEXT,
        type INTEGER,
        chat_id TEXT,
        from_mid TEXT,
        content TEXT,
        created_time INTEGER,
        read_count INTEGER,
        parameter TEXT,
        chunks BLOB
      );
    `);
    const myMid = `u${"1".repeat(32)}`;
    const otherMid = `u${"2".repeat(32)}`;
    const chatMid = `c${"3".repeat(32)}`;
    db.query("INSERT INTO chat VALUES (?, ?, ?, ?, ?, ?)").run(
      chatMid,
      "imported group",
      "latest",
      1_700_000_002_000,
      2,
      1,
    );
    db.query("INSERT INTO chat_history VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      10,
      "9007199254740993123",
      0,
      chatMid,
      otherMid,
      "hello",
      1_700_000_001_000,
      0,
      null,
      null,
    );
    db.query("INSERT INTO chat_history VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      11,
      "9007199254740993124",
      7,
      chatMid,
      myMid,
      null,
      1_700_000_002_000,
      1,
      "STKID\t123\tSTKPKGID\t456",
      null,
    );
    db.close(false);

    const imported = readAndroidLineDatabase(path, myMid);
    expect(imported.sourceChats).toBe(1);
    expect(imported.sourceMessages).toBe(2);
    expect(imported.chats[chatMid]?.kind).toBe("group");
    expect(imported.chats[chatMid]?.unreadCount).toBe(1);
    expect(imported.chats[chatMid]?.lastMessageId).toBe("9007199254740993124");
    expect(imported.messages[chatMid]?.["9007199254740993123"]?.text).toBe("hello");
    expect(imported.messages[chatMid]?.["9007199254740993124"]?.isMyMessage).toBe(true);
    expect(
      imported.messages[chatMid]?.["9007199254740993124"]?.contentMetadata?.STKID,
    ).toBe("123");

    const verify = new Database(path, { readonly: true });
    expect((verify.query("SELECT COUNT(*) AS count FROM chat_history").get() as { count: number }).count).toBe(2);
    verify.close(false);
  });

  test("rejects a SQLite file without the required LINE tables", async () => {
    const path = await fixturePath();
    const db = new Database(path);
    db.exec("CREATE TABLE unrelated (value TEXT)");
    db.close(false);

    expect(() => readAndroidLineDatabase(path, `u${"1".repeat(32)}`)).toThrow(
      "unsupported Android LINE database",
    );
  });

  test("enforces a bounded message count before materializing rows", async () => {
    const path = await fixturePath();
    const db = new Database(path);
    db.exec(`
      CREATE TABLE chat (chat_id TEXT PRIMARY KEY);
      CREATE TABLE chat_history (
        id INTEGER PRIMARY KEY,
        server_id TEXT,
        chat_id TEXT,
        from_mid TEXT,
        created_time INTEGER
      );
    `);
    const myMid = `u${"1".repeat(32)}`;
    const chatMid = `u${"2".repeat(32)}`;
    db.query("INSERT INTO chat VALUES (?)").run(chatMid);
    const insert = db.query("INSERT INTO chat_history VALUES (?, ?, ?, ?, ?)");
    insert.run(1, "1", chatMid, myMid, 1);
    insert.run(2, "2", chatMid, myMid, 2);
    db.close(false);

    expect(() => readAndroidLineDatabase(path, myMid, { maxMessages: 1 })).toThrow(
      "import limit",
    );
  });
});

describe("LEINs media validation", () => {
  test("detects supported media from magic bytes instead of archive names", () => {
    expect(sniffRestoredMediaType(Uint8Array.from([0xff, 0xd8, 0xff, ...Array(9).fill(0)]), "1")).toBe(
      "image/jpeg",
    );
    expect(
      sniffRestoredMediaType(
        Uint8Array.from([0, 0, 0, 24, ...new TextEncoder().encode("ftypisom")]),
        "2",
      ),
    ).toBe("video/mp4");
    expect(sniffRestoredMediaType(new Uint8Array(12), "0")).toBeNull();
  });
});
