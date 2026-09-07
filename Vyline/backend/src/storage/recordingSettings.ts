import { randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { delimiter, isAbsolute, relative, resolve } from "node:path";
import type { RecordingPreferences, RecordingTarget } from "@vyline/types";
import {
  type CallRecordingStore,
  RecordingError,
  getCallRecordingStore,
} from "./callRecordingStore.js";
import { protectSecret, unprotectSecret } from "./secureStore.js";
import { VYLINE_STORAGE_DIR } from "./vylineStorageInfo.js";
import { validateWebDavUrl, type WebDavConnection } from "./recordingWebDav.js";

type StoredTarget = RecordingTarget & { secret?: string; protected?: boolean };
type TargetInput = Omit<RecordingTarget, "id" | "hasPassword"> & { password?: string };
const defaults: RecordingPreferences = {
  automatic: false,
  kind: "audio",
  retentionDays: 30,
  targetId: null,
  consentAccepted: false,
};
export class RecordingSettings {
  constructor(
    private store: CallRecordingStore,
    readonly roots = [
      VYLINE_STORAGE_DIR,
      ...(process.env.VYLINE_RECORDING_ALLOWED_ROOTS?.split(delimiter).filter(Boolean) ?? []),
    ],
  ) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS recording_settings(owner TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS recording_targets(id TEXT PRIMARY KEY, owner TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS recording_target_owner ON recording_targets(owner);`);
  }
  get(owner: string): RecordingPreferences {
    const row = this.store.db
      .query("SELECT data FROM recording_settings WHERE owner = ?")
      .get(owner) as { data: string } | null;
    return row ? JSON.parse(row.data) : { ...defaults };
  }
  save(owner: string, input: RecordingPreferences) {
    if (
      typeof input.automatic !== "boolean" ||
      typeof input.consentAccepted !== "boolean" ||
      !["audio", "video"].includes(input.kind) ||
      !Number.isInteger(input.retentionDays) ||
      input.retentionDays < 0 ||
      input.retentionDays > 3650 ||
      (input.targetId !== null && typeof input.targetId !== "string")
    )
      throw new RecordingError("録音・録画の設定が正しくありません");
    if (input.automatic && !input.consentAccepted)
      throw new RecordingError(
        "自動記録を有効にする前に、相手への同意確認について確認してください",
      );
    if (input.targetId) this.target(owner, input.targetId);
    const value: RecordingPreferences = {
      automatic: input.automatic,
      kind: input.kind,
      retentionDays: input.retentionDays,
      targetId: input.targetId,
      consentAccepted: input.consentAccepted,
    };
    this.store.db
      .query(
        "INSERT INTO recording_settings VALUES (?, ?) ON CONFLICT(owner) DO UPDATE SET data = excluded.data",
      )
      .run(owner, JSON.stringify(value));
    return value;
  }
  targets(owner: string): RecordingTarget[] {
    return (
      this.store.db
        .query("SELECT data FROM recording_targets WHERE owner = ? ORDER BY rowid")
        .all(owner) as { data: string }[]
    ).map(({ data }) => {
      const { secret, protected: _protected, ...target }: StoredTarget = JSON.parse(data);
      return { ...target, hasPassword: !!secret };
    });
  }
  private storedTarget(owner: string, id: string): StoredTarget {
    const row = this.store.db
      .query("SELECT data FROM recording_targets WHERE owner = ? AND id = ?")
      .get(owner, id) as { data: string } | null;
    if (!row) throw new RecordingError("保存先が見つかりません", 404);
    return JSON.parse(row.data);
  }
  target(owner: string, id: string): RecordingTarget {
    const { secret, protected: _protected, ...target } = this.storedTarget(owner, id);
    return { ...target, hasPassword: !!secret };
  }
  async localPath(path: string): Promise<string> {
    if (!isAbsolute(path) || path.length > 2048)
      throw new RecordingError("サーバー内の絶対パスを入力してください");
    const canonical = await realpath(path).catch(() => {
      throw new RecordingError(
        "保存先が見つかりません。ディスクのマウントと権限を確認してください",
      );
    });
    if (canonical !== resolve(path) || !(await stat(canonical)).isDirectory())
      throw new RecordingError("保存先にはリンクではないフォルダーを指定してください");
    for (const root of this.roots) {
      const allowed = await realpath(root).catch(() => null);
      if (!allowed) continue;
      const child = relative(allowed, canonical);
      if (child === "" || (!child.startsWith("..") && !isAbsolute(child))) return canonical;
    }
    throw new RecordingError(
      "許可された保存ルートの外です。外部ディスクはサーバーにマウントし、VYLINE_RECORDING_ALLOWED_ROOTSへ追加してください",
    );
  }
  async localDirectory(owner: string, id: string): Promise<string> {
    const target = this.target(owner, id);
    if (target.kind !== "local") throw new RecordingError("ローカル保存先ではありません");
    return this.localPath(target.path);
  }
  async connection(owner: string, id: string): Promise<WebDavConnection> {
    const target = this.storedTarget(owner, id);
    if (target.kind !== "webdav") throw new RecordingError("WebDAV保存先ではありません");
    return {
      path: target.path,
      username: target.username ?? "",
      password: target.secret
        ? target.protected
          ? await unprotectSecret(target.secret)
          : target.secret
        : "",
      allowPrivateNetwork: target.allowPrivateNetwork ?? false,
      allowInsecureHttp: target.allowInsecureHttp ?? false,
    };
  }
  async addTarget(owner: string, input: TargetInput): Promise<RecordingTarget> {
    if (
      !input ||
      typeof input.name !== "string" ||
      !input.name.trim() ||
      input.name.length > 80 ||
      typeof input.path !== "string" ||
      input.path.length > 2048 ||
      !["local", "webdav"].includes(input.kind) ||
      (input.username !== undefined &&
        (typeof input.username !== "string" ||
          input.username.length > 256 ||
          input.username.includes(":"))) ||
      (input.password !== undefined &&
        (typeof input.password !== "string" || input.password.length > 4096)) ||
      (input.allowPrivateNetwork !== undefined && typeof input.allowPrivateNetwork !== "boolean") ||
      (input.allowInsecureHttp !== undefined && typeof input.allowInsecureHttp !== "boolean")
    )
      throw new RecordingError("保存先の設定が正しくありません");
    // No await after the second count: concurrent submissions cannot bypass this small bound.
    let path: string;
    if (input.kind === "local") path = await this.localPath(input.path);
    else path = (await validateWebDavUrl(input)).url.toString();
    const secret = input.password
      ? process.platform === "win32"
        ? await protectSecret(input.password)
        : input.password
      : undefined;
    if (this.targets(owner).length >= 16)
      throw new RecordingError("保存先は16件までです。未使用の保存先を削除してください", 409);
    const target: StoredTarget = {
      id: randomUUID(),
      name: input.name.trim(),
      kind: input.kind,
      path,
      ...(input.kind === "webdav"
        ? {
            username: input.username ?? "",
            allowPrivateNetwork: input.allowPrivateNetwork ?? false,
            allowInsecureHttp: input.allowInsecureHttp ?? false,
            ...(secret ? { secret, protected: process.platform === "win32" } : {}),
          }
        : {}),
    };
    this.store.db
      .query("INSERT INTO recording_targets VALUES (?, ?, ?)")
      .run(target.id, owner, JSON.stringify(target));
    return this.target(owner, target.id);
  }
  removeTarget(owner: string, id: string) {
    this.target(owner, id);
    if (
      this.store.db
        .query(
          "SELECT 1 FROM recordings WHERE owner = ? AND json_extract(data, '$.targetId') = ? LIMIT 1",
        )
        .get(owner, id)
    )
      throw new RecordingError(
        "この保存先に記録が残っています。記録を削除してから保存先を削除してください",
        409,
      );
    this.store.db.transaction(() => {
      const preferences = this.get(owner);
      if (preferences.targetId === id) this.save(owner, { ...preferences, targetId: null });
      this.store.db
        .query("DELETE FROM recording_targets WHERE owner = ? AND id = ?")
        .run(owner, id);
    })();
  }
}
let shared: RecordingSettings | undefined;
export const getRecordingSettings = () =>
  (shared ??= new RecordingSettings(getCallRecordingStore()));
