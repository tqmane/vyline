import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CallRecordingStore } from "./callRecordingStore.js";
import { RecordingSettings } from "./recordingSettings.js";

test("GUI preferences and immutable destinations stay account-scoped and within approved roots", async () => {
  const root = await mkdtemp(join(tmpdir(), "vyline-recording-settings-"));
  const store = new CallRecordingStore(join(root, "index"));
  const disk = join(root, "mounted-external-disk");
  await mkdir(disk);
  const settings = new RecordingSettings(store, [disk]);
  try {
    expect(settings.get("owner")).toEqual({
      automatic: false,
      kind: "audio",
      retentionDays: 30,
      targetId: null,
      consentAccepted: false,
    });
    const target = await settings.addTarget("owner", {
      name: "外部ディスク",
      kind: "local",
      path: disk,
    });
    expect(settings.targets("owner")).toHaveLength(1);
    expect(settings.targets("other")).toEqual([]);
    expect(() => settings.target("other", target.id)).toThrow();
    expect(() => settings.save("owner", { ...settings.get("owner"), automatic: true })).toThrow();
    const saved = settings.save("owner", {
      automatic: true,
      kind: "video",
      retentionDays: 0,
      targetId: target.id,
      consentAccepted: true,
    });
    expect(saved.retentionDays).toBe(0);
    await expect(
      settings.addTarget("owner", { name: "escape", kind: "local", path: root }),
    ).rejects.toThrow();
    const dav = await settings.addTarget("owner", {
      name: "NAS",
      kind: "webdav",
      path: "https://192.168.128.20/recordings/",
      username: "synthetic",
      password: "test-password",
      allowPrivateNetwork: true,
    });
    expect(JSON.stringify(settings.targets("owner"))).not.toContain("test-password");
    expect((await settings.connection("owner", dav.id)).password).toBe("test-password");
    const recording = await store.create(
      "owner",
      {
        sessionId: "test",
        chatMid: `c${"1".repeat(32)}`,
        title: "generated",
        kind: "audio",
        mimeType: "audio/webm",
        retentionDays: 0,
      },
      10,
      { id: target.id, directory: await settings.localDirectory("owner", target.id) },
    );
    expect(() => settings.removeTarget("owner", target.id)).toThrow();
    await store.remove("owner", recording.id);
    settings.removeTarget("owner", target.id);
    expect(settings.get("owner").targetId).toBeNull();
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
