import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const previousDataDir = process.env.VYLINE_DATA_DIR;
const dataDir = await mkdtemp(join(tmpdir(), "vyline-api-token-store-"));
process.env.VYLINE_DATA_DIR = dataDir;
const apiTokenStore = await import(`./apiTokenStore.ts?test=${crypto.randomUUID()}`);

afterAll(async () => {
  if (previousDataDir == null) Reflect.deleteProperty(process.env, "VYLINE_DATA_DIR");
  else process.env.VYLINE_DATA_DIR = previousDataDir;
  await rm(dataDir, { recursive: true, force: true });
});

describe("apiTokenStore account scoping", () => {
  test("normalizes account allowlists and never persists plaintext tokens", async () => {
    const created = await apiTokenStore.createToken(
      "scoped-client",
      [" account-a ", "account-a", "account-b"],
      ["read"],
    );

    expect(created.accountIds).toEqual(["account-a", "account-b"]);
    expect(apiTokenStore.tokenAllowsAccount(created, "account-a")).toBe(true);
    expect(apiTokenStore.tokenAllowsAccount(created, "account-c")).toBe(false);

    const raw = await readFile(join(dataDir, "api-tokens.json"), "utf8");
    expect(raw).not.toContain(created.token ?? "");
    expect(JSON.parse(raw)[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("migrates legacy plaintext tokens without granting account access", async () => {
    const legacyDir = await mkdtemp(join(tmpdir(), "vyline-api-token-store-legacy-"));
    const legacyToken = "vyl_legacy-plaintext-token";
    await writeFile(
      join(legacyDir, "api-tokens.json"),
      JSON.stringify([
        {
          token: legacyToken,
          name: "legacy-client",
          scopes: ["read", "write"],
          createdAt: "2026-08-31T00:00:00.000Z",
        },
      ]),
      "utf8",
    );

    const activeDataDir = process.env.VYLINE_DATA_DIR;
    process.env.VYLINE_DATA_DIR = legacyDir;
    try {
      const freshStore = await import(`./apiTokenStore.ts?legacy=${crypto.randomUUID()}`);
      const [legacy] = await freshStore.listTokens();

      expect(legacy?.accountIds).toEqual([]);
      expect(freshStore.tokenAllowsAccount(legacy!, "account-a")).toBe(false);
      expect((await freshStore.validateToken(legacyToken))?.accountIds).toEqual([]);
      await freshStore.createToken("write-barrier", ["account-a"], ["read"]);

      const migrated = await readFile(join(legacyDir, "api-tokens.json"), "utf8");
      expect(migrated).not.toContain(legacyToken);
      expect(JSON.parse(migrated)[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      if (activeDataDir == null) Reflect.deleteProperty(process.env, "VYLINE_DATA_DIR");
      else process.env.VYLINE_DATA_DIR = activeDataDir;
      await rm(legacyDir, { recursive: true, force: true });
    }
  });

  test("serializes concurrent writes and keeps token metadata parseable", async () => {    const initialCount = (await apiTokenStore.listTokens()).length;
    const created = await apiTokenStore.createToken("concurrent-client", ["account-a"], ["read"]);
    const rawToken = created.token!;

    await Promise.all(
      Array.from({ length: 16 }, (_, index) =>
        apiTokenStore.createToken(`concurrent-${index}`, ["account-a"], ["read"]),
      ),
    );
    await Promise.all(Array.from({ length: 32 }, () => apiTokenStore.validateToken(rawToken)));
    await apiTokenStore.createToken("write-barrier", ["account-a"], ["read"]);

    for (let i = 0; i < 32; i += 1) {
      const raw = await readFile(join(dataDir, "api-tokens.json"), "utf8");
      const parsed = JSON.parse(raw);
      expect(parsed).toHaveLength(initialCount + 18);
    }
  });
});

describe("apiTokenStore cold start", () => {
  test("concurrent first-time creation on an empty data dir keeps both tokens", async () => {
    // The first load on a fresh install has no file to read, so without in-flight
    // dedup each caller gets its own empty array and the later save overwrites the
    // earlier one — deleting a token the user was already handed.
    const coldDir = await mkdtemp(join(tmpdir(), "vyline-api-token-cold-"));
    const previous = process.env.VYLINE_DATA_DIR;
    process.env.VYLINE_DATA_DIR = coldDir;
    try {
      const cold = await import(`./apiTokenStore.ts?cold=${crypto.randomUUID()}`);
      const [first, second] = await Promise.all([
        cold.createToken("cold-first", ["account-a"], ["read"]),
        cold.createToken("cold-second", ["account-a"], ["read"]),
      ]);

      expect((await cold.validateToken(first.token!))?.name).toBe("cold-first");
      expect((await cold.validateToken(second.token!))?.name).toBe("cold-second");
      const stored = JSON.parse(await readFile(join(coldDir, "api-tokens.json"), "utf8"));
      expect(stored).toHaveLength(2);
      expect((await cold.listTokens()).map((entry: { name: string }) => entry.name).sort()).toEqual([
        "cold-first",
        "cold-second",
      ]);
    } finally {
      if (previous == null) Reflect.deleteProperty(process.env, "VYLINE_DATA_DIR");
      else process.env.VYLINE_DATA_DIR = previous;
      await rm(coldDir, { recursive: true, force: true });
    }
  });
});
