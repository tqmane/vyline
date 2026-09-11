import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeJsonAtomic } from "./safeFile.js";
import { VYLINE_DATA_DIR } from "./vylineStorageInfo.js";

export type GroupInviteRule = { enabled: boolean; targetMids: string[] };
const writes = new Map<string, Promise<void>>();

export function validateInviteRule(value: unknown): GroupInviteRule {
  const rule = value as Partial<GroupInviteRule> | null;
  if (!rule || typeof rule.enabled !== "boolean" || !Array.isArray(rule.targetMids) || rule.targetMids.length > 1000 ||
    rule.targetMids.some(mid => typeof mid !== "string" || !/^u[0-9a-f]{32}$/.test(mid))) {
    throw new Error("招待拒否の設定が不正です（MIDは u から始まる33文字）");
  }
  return { enabled: rule.enabled, targetMids: [...new Set(rule.targetMids)] };
}

function rulePath(accountId: string, chatMid: string): string {
  if (!/^[cr][0-9a-f]{32}$/.test(chatMid)) throw new Error("グループMIDが不正です");
  return join(VYLINE_DATA_DIR, "group-invite-rules", createHash("sha256").update(accountId).digest("hex"), `${chatMid}.json`);
}

export async function readGroupInviteRule(accountId: string, chatMid: string): Promise<GroupInviteRule> {
  try { return validateInviteRule(JSON.parse(await readFile(rulePath(accountId, chatMid), "utf8"))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { enabled: false, targetMids: [] };
    throw error;
  }
}

export async function writeGroupInviteRule(accountId: string, chatMid: string, value: unknown): Promise<GroupInviteRule> {
  const rule = validateInviteRule(value);
  const path = rulePath(accountId, chatMid);
  const write = (writes.get(path) ?? Promise.resolve()).catch(() => {}).then(() => writeJsonAtomic(path, rule));
  writes.set(path, write);
  try { await write; return rule; }
  finally { if (writes.get(path) === write) writes.delete(path); }
}

export function groupParticipantMids(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value && typeof value === "object" ? Object.keys(value) : [];
  return [...new Set(values.filter((mid): mid is string => typeof mid === "string" && /^u[0-9a-f]{32}$/.test(mid)))];
}

export function inviteRejectionTargets(rule: GroupInviteRule, members: unknown, invitees: unknown, selfMid: string) {
  const targets = new Set(rule.enabled ? rule.targetMids.filter(mid => mid !== selfMid) : []);
  return {
    cancel: groupParticipantMids(invitees).filter(mid => targets.has(mid)),
    kick: groupParticipantMids(members).filter(mid => targets.has(mid)),
  };
}

