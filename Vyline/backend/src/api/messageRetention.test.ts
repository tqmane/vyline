import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { createRemoteAccessGuard } from "../remoteAccess.js";

// Keep account storage and lock files away from developer data and other suites.
if (process.env.VYLINE_RETENTION_API_TEST_CHILD !== "1") {
  test("message retention API in an isolated process", async () => {
    const child = Bun.spawn([process.execPath, "test", fileURLToPath(import.meta.url)], {
      env: { ...process.env, VYLINE_RETENTION_API_TEST_CHILD: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
    expect(code).toBe(0);
  }, 30_000);
} else {
  const root = await fs.mkdtemp(join(tmpdir(), "vyline-retention-api-"));
  process.env.VYLINE_DATA_DIR = root;
  const { messageRetentionRouter } = await import("./messageRetention.js");
  const storage = await import("../storage/chatStore.js");
  const { setChatLocked } = await import("../storage/chatLockStore.js");
  const owner = "retention-api-owner";
  const other = "retention-api-other";
  const aliases = ["/line", "/api/line"];
  const auth = { authorization: "Bearer fixture-session", "x-vyline-installation-id": "fixture-installation",
    "x-vyline-local-request": "0" };
  const app = new Hono();
  for (const prefix of aliases) {
    app.use(`${prefix}/:accountId/*`, createRemoteAccessGuard({
      remoteAuthRequired: true,
      mode: "subdevice",
      authenticateSubdevice: async (token, installation) =>
        token === "fixture-session" && installation === "fixture-installation" ? { accountId: owner } : null,
      // index.ts supplies account authorization outside the retention router.
      authorizeSubdevice: (c, session) => session.accountId === c.req.param("accountId") ? null : "subdevice account mismatch",
    }));
    app.route(prefix, messageRetentionRouter);
  }
  const path = (prefix: string, account: string, chat: string, id: string) =>
    `${prefix}/${account}/messages/${chat}/${id}/local`;

  async function seed(account: string, chatMid: string, id: string, revoked = true) {
    const now = new Date().toISOString();
    await storage.upsertChats(account, [{ mid: chatMid, name: "fixture", kind: "group", hasMessages: true, updatedAt: now }]);
    await storage.upsertMessages(account, chatMid, [{ id, chatMid, from: "u-peer", to: chatMid,
      text: "retained original", contentType: "IMAGE", createdTime: Number(id), isMyMessage: false,
      contentMetadata: { OID: "fixture-object", keyMaterial: "fixture-key" }, savedAt: now }]);
    if (revoked) await storage.markMessageRevoked(account, chatMid, id);
  }

  afterAll(async () => {
    for (const account of [owner, other]) await storage.closeAccountChatDb(account);
    await fs.rm(root, { recursive: true, force: true });
  });

  test("DELETE rejects missing, unbound and cookie-only credentials before changing retained data", async () => {
    const chat = `c${"1".repeat(32)}`;
    await seed(owner, chat, "100");
    const before = await storage.getStoredMessages(owner, chat, 10);
    const rejectedHeaders = [
      { "x-vyline-local-request": "0" },
      { ...auth, "x-vyline-installation-id": "wrong-installation" },
      { cookie: "vyline_subdevice_session=fixture-session; vyline_subdevice_installation=fixture-installation",
        "x-vyline-local-request": "0" },
    ];
    for (const prefix of aliases) for (const headers of rejectedHeaders) {
      const response = await app.request(path(prefix, owner, chat, "100"), { method: "DELETE", headers });
      expect(response.status).toBe(401);
      expect((await response.json()).ok).toBe(false);
    }
    expect(await storage.getStoredMessages(owner, chat, 10)).toEqual(before);
    expect(await storage.isMessageDeletedLocally(owner, chat, "100")).toBe(false);
  });

  test("DELETE rejects another account and deletes only the authorized account's matching message", async () => {
    const chat = `c${"2".repeat(32)}`;
    for (const [index, prefix] of aliases.entries()) {
      const id = String(200 + index);
      await seed(owner, chat, id);
      await seed(other, chat, id);
      const otherBefore = await storage.getStoredMessages(other, chat, 10);
      const rejected = await app.request(path(prefix, other, chat, id), { method: "DELETE", headers: auth });
      expect(rejected.status).toBe(403);
      expect(await storage.getStoredMessages(other, chat, 10)).toEqual(otherBefore);
      expect(await storage.isMessageDeletedLocally(other, chat, id)).toBe(false);
      const accepted = await app.request(path(prefix, owner, chat, id), { method: "DELETE", headers: auth });
      expect(accepted.status).toBe(200);
      expect(await accepted.json()).toEqual({ ok: true });
      expect((await storage.getStoredMessages(owner, chat, 10)).some(message => message.id === id)).toBe(false);
      expect(await storage.getStoredMessages(other, chat, 10)).toEqual(otherBefore);
      expect((await app.request(path(prefix, owner, chat, id), { method: "DELETE", headers: auth })).status).toBe(200);
    }
  });

  test("DELETE preserves the original and deletion marker while locked, then succeeds after unlock", async () => {
    const chat = `c${"3".repeat(32)}`;
    for (const [index, prefix] of aliases.entries()) {
      const id = String(300 + index);
      await seed(owner, chat, id);
      const before = await storage.getStoredMessages(owner, chat, 10);
      await setChatLocked(owner, chat, true);
      try {
        const response = await app.request(path(prefix, owner, chat, id), { method: "DELETE", headers: auth });
        expect(response.status).toBe(403);
        expect((await response.json()).ok).toBe(false);
        expect(await storage.getStoredMessages(owner, chat, 10)).toEqual(before);
        expect(await storage.isMessageDeletedLocally(owner, chat, id)).toBe(false);
      } finally {
        await setChatLocked(owner, chat, false);
      }
      expect((await app.request(path(prefix, owner, chat, id), { method: "DELETE", headers: auth })).status).toBe(200);
      expect(await storage.isMessageDeletedLocally(owner, chat, id)).toBe(true);
    }
  });

  test("DELETE rejects normal messages and invalid references without changing saved data", async () => {
    const chat = `c${"4".repeat(32)}`;
    await seed(owner, chat, "400", false);
    const before = await storage.getStoredMessages(owner, chat, 10);
    for (const prefix of aliases) {
      expect((await app.request(path(prefix, owner, chat, "400"), { method: "DELETE", headers: auth })).status).toBe(409);
      for (const [invalidChat, invalidId] of [["c-invalid", "400"], [chat, "not-a-message-id"]]) {
        expect((await app.request(path(prefix, owner, invalidChat!, invalidId!), { method: "DELETE", headers: auth })).status).toBe(400);
      }
    }
    expect(await storage.getStoredMessages(owner, chat, 10)).toEqual(before);
    expect(await storage.isMessageDeletedLocally(owner, chat, "400")).toBe(false);
  });
}
