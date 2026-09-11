import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (process.env.VYLINE_INVITE_TEST_CHILD !== "1") {
  test("group invitation rules preserve account isolation and only target selected MIDs", async () => {
    const root = await mkdtemp(join(tmpdir(), "vyline-invite-rules-"));
    try {
      const child = Bun.spawn([process.execPath, "test", import.meta.path], {
        env: { ...process.env, VYLINE_DATA_DIR: root, VYLINE_INVITE_TEST_CHILD: "1" }, stdout: "pipe", stderr: "pipe",
      });
      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
      expect(code).toBe(0);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
} else {
  const { validateInviteRule, inviteRejectionTargets, readGroupInviteRule, writeGroupInviteRule } = await import("./groupInviteRules");
  const self = `u${"0".repeat(32)}`;
  const target = `u${"1".repeat(32)}`;
  const other = `u${"2".repeat(32)}`;
  const group = `c${"3".repeat(32)}`;
  test("cancel pending invitations and remove joined targets, never self or other members", () => {
    const rule = validateInviteRule({ enabled: true, targetMids: [self, target, target] });
    expect(rule.targetMids).toEqual([self, target]);
    expect(inviteRejectionTargets(rule, { [self]: 1, [target]: 2, [other]: 3 }, [target, other], self)).toEqual({ cancel: [target], kick: [target] });
    expect(inviteRejectionTargets({ ...rule, enabled: false }, [target], [target], self)).toEqual({ cancel: [], kick: [] });
    for (const value of [null, { enabled: "true", targetMids: [] }, { enabled: true, targetMids: ["not-a-mid"] }]) expect(() => validateInviteRule(value)).toThrow();
  });
  test("atomic rules stay isolated by account and group", async () => {
    expect(await readGroupInviteRule("account-a", group)).toEqual({ enabled: false, targetMids: [] });
    await Promise.all([
      writeGroupInviteRule("account-a", group, { enabled: true, targetMids: [target] }),
      writeGroupInviteRule("account-b", group, { enabled: false, targetMids: [other] }),
    ]);
    expect(await readGroupInviteRule("account-a", group)).toEqual({ enabled: true, targetMids: [target] });
    expect(await readGroupInviteRule("account-b", group)).toEqual({ enabled: false, targetMids: [other] });
    await expect(writeGroupInviteRule("account-a", "../escape", { enabled: true, targetMids: [target] })).rejects.toThrow();
  });
}
