/**
 * VylineStorage — Vyline ブランドの永続 JSON ストレージ
 *
 * data/vyline-{namespace}-{accountId}.json に debounce 書き込み。
 * メモリ優先・ディスクは起動時 hydrate / 定期 flush。
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { childLogger } from "../logger.js";
import { accountDir, readAccountJson } from "./accountDirs.js";
import { writeTextAtomic } from "./safeFile.js";

const log = childLogger("VylineStorage");
const _dir = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.VYLINE_DATA_DIR ?? join(_dir, "..", "..", "data");

const SAVE_DEBOUNCE_MS = Number(process.env.VYLINE_CACHE_SAVE_MS ?? 350);

export class VylineStorage<T extends object> {
  readonly namespace: string;
  private readonly memory = new Map<string, T>();
  private readonly loading = new Map<string, Promise<T>>();
  private readonly flushing = new Map<string, Promise<void>>();
  private readonly dirty = new Set<string>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly factory: () => T;

  constructor(namespace: string, empty: () => T) {
    this.namespace = namespace;
    this.factory = empty;
  }

  private path(accountId: string): string {
    return join(accountDir(accountId), `vyline-${this.namespace}.json`);
  }
  private legacyPath(accountId: string): string {
    return join(DATA_DIR, `vyline-${this.namespace}-${accountId}.json`);
  }

  peek(accountId: string): T | undefined {
    return this.memory.get(accountId);
  }

  async load(accountId: string): Promise<T> {
    const cached = this.memory.get(accountId);
    if (cached) return cached;
    const pending = this.loading.get(accountId);
    if (pending) return pending;
    const task = this.loadFromDisk(accountId);
    this.loading.set(accountId, task);
    try {
      return await task;
    } finally {
      if (this.loading.get(accountId) === task) this.loading.delete(accountId);
    }
  }

  private async loadFromDisk(accountId: string): Promise<T> {
    const p = this.path(accountId);
    if (!existsSync(p)) {
      // 旧フラット (vyline-<ns>-<id>.json / nezu-<ns>-<id>.json) からの移行:
      // あれば読んで accounts/<id>/ へ保存
      const legacy = await readAccountJson<T>(
        accountId,
        `vyline-${this.namespace}.json`,
        this.legacyPath(accountId),
      );
      if (!legacy) {
        const nezuLegacy = join(DATA_DIR, `nezu-${this.namespace}-${accountId}.json`);
        if (existsSync(nezuLegacy)) {
          try {
            const parsed = JSON.parse(await readFile(nezuLegacy, "utf8")) as T;
            this.memory.set(accountId, parsed);
            await writeTextAtomic(p, JSON.stringify(parsed));
            return parsed;
          } catch {
            // fallthrough to empty
          }
        }
        const empty = this.factory();
        this.memory.set(accountId, empty);
        return empty;
      }
      this.memory.set(accountId, legacy);
      return legacy;
    }

    try {
      const raw = await readFile(p, "utf8");
      const parsed = JSON.parse(raw) as T;
      this.memory.set(accountId, parsed);
      return parsed;
    } catch (err) {
      log.warn({ accountId, namespace: this.namespace, err }, "VylineStorage load failed");
      const empty = this.factory();
      this.memory.set(accountId, empty);
      return empty;
    }
  }

  /** メモリ上を即更新し、debounce でディスクへ */
  async mutate(accountId: string, fn: (data: T) => void): Promise<T> {
    const data = await this.load(accountId);
    fn(data);
    this.memory.set(accountId, data);
    this.scheduleSave(accountId);
    return data;
  }

  async replace(accountId: string, data: T): Promise<void> {
    const pending = this.loading.get(accountId);
    if (pending) await pending;
    this.memory.set(accountId, data);
    this.scheduleSave(accountId);
  }

  private scheduleSave(accountId: string): void {
    this.dirty.add(accountId);
    const prev = this.timers.get(accountId);
    if (prev) clearTimeout(prev);
    this.timers.set(
      accountId,
      setTimeout(() => {
        void this.flush(accountId);
      }, SAVE_DEBOUNCE_MS),
    );
  }

  async flush(accountId: string): Promise<void> {
    const timer = this.timers.get(accountId);
    if (timer) clearTimeout(timer);
    this.timers.delete(accountId);
    const pending = this.flushing.get(accountId);
    if (pending) {
      await pending;
      await this.flush(accountId);
      return;
    }
    if (!this.dirty.has(accountId)) return;
    const task = this.flushDirty(accountId).finally(() => {
      if (this.flushing.get(accountId) === task) this.flushing.delete(accountId);
    });
    this.flushing.set(accountId, task);
    return task;
  }

  private async flushDirty(accountId: string): Promise<void> {
    while (this.dirty.has(accountId)) {
      this.dirty.delete(accountId);
      const data = this.memory.get(accountId);
      if (!data) return;
      try {
        await writeTextAtomic(
          this.path(accountId),
          JSON.stringify(data, (key, value) => {
            if (typeof value === "bigint") return value.toString();
            return value;
          }),
        );
      } catch (err) {
        this.dirty.add(accountId);
        log.warn({ accountId, namespace: this.namespace, err }, "VylineStorage flush failed");
        break;
      }
    }
  }

  async flushAll(): Promise<void> {
    await Promise.all([...new Set([...this.dirty, ...this.flushing.keys()])].map((id) => this.flush(id)));
  }
}
