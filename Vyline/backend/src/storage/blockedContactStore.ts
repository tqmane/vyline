import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import { accountFile } from "./accountDirs.js";

export type BlockedSnapshot = { mids: string[]; syncedAt: number | null };
export const USER_MID = /^u[0-9a-f]{32}$/i;

/** Only blocked MIDs and the last complete sync time are persisted. */
export class BlockedContactStore {
  constructor(private readonly path = (accountId: string) => accountFile(accountId, "blocked-contacts.sqlite")) {}

  private withDb<T>(accountId: string, action: (db: Database) => T): T {
    if (!accountId) throw new Error("accountId required");
    const path = this.path(accountId);
    mkdirSync(dirname(path), { recursive: true });
    const db = new Database(path, { create: true });
    try {
      db.exec("PRAGMA busy_timeout=1000; CREATE TABLE IF NOT EXISTS blocked(mid TEXT PRIMARY KEY); CREATE TABLE IF NOT EXISTS sync(id INTEGER PRIMARY KEY CHECK(id=1), at INTEGER);");
      return action(db);
    } finally { db.close(); }
  }

  read(accountId: string): BlockedSnapshot {
    return this.withDb(accountId, db => ({
      mids: (db.query("SELECT mid FROM blocked ORDER BY mid").all() as { mid: string }[]).map(row => row.mid),
      syncedAt: (db.query("SELECT at FROM sync WHERE id=1").get() as { at: number | null } | null)?.at ?? null,
    }));
  }

  sync(accountId: string, mids: string[], at = Date.now()): BlockedSnapshot {
    if (mids.some(mid => !USER_MID.test(mid))) throw new Error("Invalid blocked MID response");
    this.withDb(accountId, db => db.transaction(() => {
      const desired = new Set(mids.map(mid => mid.toLowerCase()));
      for (const row of db.query("SELECT mid FROM blocked").all() as { mid: string }[])
        if (!desired.has(row.mid)) db.query("DELETE FROM blocked WHERE mid=?").run(row.mid);
      for (const mid of desired) db.query("INSERT OR IGNORE INTO blocked VALUES(?)").run(mid);
      db.query("INSERT OR REPLACE INTO sync VALUES(1,?)").run(at);
    })());
    return this.read(accountId);
  }

  setBlocked(accountId: string, inputMid: string, blocked: boolean): void {
    if (!USER_MID.test(inputMid)) throw new Error("Invalid user MID");
    const mid = inputMid.toLowerCase();
    this.withDb(accountId, db => db.transaction(() => {
      db.query(blocked ? "INSERT OR IGNORE INTO blocked VALUES(?)" : "DELETE FROM blocked WHERE mid=?").run(mid);
      // A single mutation does not certify the completeness of an older snapshot.
      db.query("INSERT OR REPLACE INTO sync VALUES(1,NULL)").run();
    })());
  }
}
