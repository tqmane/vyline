import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

if (process.env.VYLINE_ACCOUNT_SETTINGS_TEST_CHILD !== "1") {
  test("account settings persistence runs in an isolated process", async () => {
    const root = await fs.mkdtemp(join(tmpdir(), "vyline-account-settings-test-"));
    try {
      const child = Bun.spawn([process.execPath, "test", fileURLToPath(import.meta.url)], {
        env: {
          ...process.env,
          VYLINE_ACCOUNT_SETTINGS_TEST_CHILD: "1",
          VYLINE_ACCOUNT_SETTINGS_TEST_ROOT: root,
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
  process.env.VYLINE_DATA_DIR = process.env.VYLINE_ACCOUNT_SETTINGS_TEST_ROOT!;
  const settings = await import("./accountSettingsService.js");

  describe("account settings persistence", () => {
    test("media autosave defaults ON, persists OFF across loads and stays account-scoped", async () => {
      const base = settings.defaultAccountSettings();
      expect(base.storage.mediaAutoSave).toBe(true);
      await settings.saveAccountSettings("media-a", {
        storage: { ...base.storage, mediaAutoSave: false },
      });
      expect((await settings.loadAccountSettings("media-a")).storage.mediaAutoSave).toBe(false);
      await settings.saveAccountSettings("media-a", { storage: { autoDownload: true } });
      expect((await settings.loadAccountSettings("media-a")).storage.mediaAutoSave).toBe(false);
      expect((await settings.loadAccountSettings("media-b")).storage.mediaAutoSave).toBe(true);
      expect(
        JSON.parse(
          await fs.readFile(
            join(process.env.VYLINE_DATA_DIR!, "accounts/media-a/settings.json"),
            "utf8",
          ),
        ).storage.mediaAutoSave,
      ).toBe(false);
    });
    test("old settings default ON and invalid boolean values cannot overwrite explicit OFF", async () => {
      const base = settings.defaultAccountSettings();
      await settings.saveAccountSettings("media-old", { storage: { autoDownload: false } });
      expect((await settings.loadAccountSettings("media-old")).storage.mediaAutoSave).toBe(true);
      await settings.saveAccountSettings("media-invalid", {
        storage: { ...base.storage, mediaAutoSave: false },
      });
      await expect(
        settings.saveAccountSettings("media-invalid", {
          storage: { ...base.storage, mediaAutoSave: "false" as never },
        }),
      ).rejects.toThrow("boolean");
      expect((await settings.loadAccountSettings("media-invalid")).storage.mediaAutoSave).toBe(
        false,
      );
    });
    test("concurrent patches for one account preserve both changes", async () => {
      const defaults = settings.defaultAccountSettings();

      await Promise.all([
        settings.saveAccountSettings("account-a", { displayName: "Alice" }),
        settings.saveAccountSettings("account-a", {
          layout: { ...defaults.layout, compact: true },
        }),
      ]);

      const saved = await settings.loadAccountSettings("account-a");
      expect(saved.displayName).toBe("Alice");
      expect(saved.layout.compact).toBe(true);
    });
  });
}
