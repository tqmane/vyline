import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import { strToU8, zipSync } from "fflate";

if (process.env.VYLINE_HANDOFF_TEST_CHILD !== "1") {
  test("handoff archive integration runs in an isolated process", async () => {
    const root = await fs.mkdtemp(join(tmpdir(), "vyline-handoff-test-"));
    try {
      const child = Bun.spawn([process.execPath, "test", fileURLToPath(import.meta.url)], {
        env: {
          ...process.env,
          VYLINE_HANDOFF_TEST_CHILD: "1",
          VYLINE_HANDOFF_TEST_ROOT: root,
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
      expect(`${stdout}\n${stderr}`).toContain("0 fail");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
} else {
  process.env.VYLINE_DATA_DIR = process.env.VYLINE_HANDOFF_TEST_ROOT!;
  const { exportHandoff, importHandoff, inspectHandoff } = await import("./handoffService.js");
  const { defaultAccountSettings, loadAccountSettings, saveAccountSettings } = await import(
    "./accountSettingsService.js"
  );
  const { accountFile } = await import("../storage/accountDirs.js");

  describe("handoff archive", () => {
    test("exports an account-bound verifiable zip and rejects mismatch or tampering", async () => {
      const mid = "u1234567890abcdef1234567890abcdef";
      const otherMid = "uabcdef1234567890abcdef1234567890";
      const exported = await exportHandoff(mid, "web");
      expect(exported.filename).toMatch(/^[0-9a-f-]+\.zip$/);
      expect(exported.manifest.account.midHash).toHaveLength(16);
      await expect(importHandoff(mid, exported.archiveBase64, "overwrite")).resolves.toMatchObject({
        imported: ["settings.json"],
      });
      await expect(importHandoff(otherMid, exported.archiveBase64, "overwrite")).rejects.toThrow(
        "account mismatch",
      );
      expect(await Bun.file(accountFile(otherMid, "settings.json")).exists()).toBe(false);
      const tampered = Buffer.from(exported.archiveBase64, "base64");
      // Flip file data, not the trailing EOCD record that ZIP readers may ignore.
      const pos = Math.floor(tampered.length / 3);
      tampered[pos] = (tampered[pos] ?? 0) ^ 1;
      await expect(importHandoff(mid, tampered.toString("base64"), "overwrite")).rejects.toThrow();
    });

    test("inspects an archive before importing and detects the account mismatch", async () => {
      const mid = "u1234567890abcdef1234567890abcdef";
      const exported = await exportHandoff(mid, "desktop");
      expect(inspectHandoff(mid, exported.archiveBase64)).toMatchObject({
        matchesCurrentAccount: true,
        files: ["settings.json"],
      });
      expect(
        inspectHandoff("uabcdef1234567890abcdef1234567890", exported.archiveBase64),
      ).toMatchObject({
        matchesCurrentAccount: false,
      });
    });

    test("rejects a small compressed archive before expanding an oversized payload", () => {
      const compressedBomb = zipSync(
        {
          "manifest.json": strToU8("{}"),
          "settings.json": new Uint8Array(6 * 1024 * 1024),
        },
        { level: 9 },
      );
      expect(compressedBomb.byteLength).toBeLessThan(5 * 1024 * 1024);
      expect(() =>
        inspectHandoff(
          "u1234567890abcdef1234567890abcdef",
          Buffer.from(compressedBomb).toString("base64"),
        ),
      ).toThrow("expands beyond");
    });

    test("serializes handoff merge and overwrite with a concurrent settings patch", async () => {
      const defaults = defaultAccountSettings();
      for (const [mode, digit] of [
        ["merge", "1"],
        ["overwrite", "2"],
      ] as const) {
        const mid = `u${digit.repeat(32)}`;
        await saveAccountSettings(mid, {
          displayName: "Archive",
          layout: { ...defaults.layout, compact: true },
        });
        const exported = await exportHandoff(mid, "desktop");
        await saveAccountSettings(mid, {
          displayName: "Current",
          layout: { ...defaults.layout, compact: false },
        });

        await Promise.all([
          importHandoff(mid, exported.archiveBase64, mode),
          saveAccountSettings(mid, { displayName: "Concurrent" }),
        ]);

        const saved = await loadAccountSettings(mid);
        expect(saved.displayName).toBe("Concurrent");
        expect(saved.layout.compact).toBe(true);
      }
    });
  });
}
