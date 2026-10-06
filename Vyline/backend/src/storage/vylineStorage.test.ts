import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as dirs from "./accountDirs.js";
import { VylineStorage } from "./vylineStorage.js";
import * as io from "node:fs/promises";

let root: string;
let store: VylineStorage<Record<string, string>>;
let restore: (() => void)[];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vyline-storage-test-"));
  store = new VylineStorage("test", () => ({}));
  const path = spyOn(dirs, "accountDir").mockImplementation((id) => join(root, id));
  const read = spyOn(dirs, "readAccountJson").mockImplementation(async () => null);
  restore = [() => path.mockRestore(), () => read.mockRestore()];
});

afterEach(async () => {
  await store.flushAll();
  for (const undo of restore) undo();
  expect(root.startsWith(join(tmpdir(), "vyline-storage-test-"))).toBe(true);
  await rm(root, { recursive: true, force: true });
});

test("parallel cold cache mutations both survive in memory and on disk", async () => {
  await mkdir(join(root, "account"));
  await Promise.all([
    store.mutate("account", (data) => { data.alice = "Alice"; }),
    store.mutate("account", (data) => { data.bob = "Bob"; }),
  ]);
  expect(store.peek("account")).toEqual({ alice: "Alice", bob: "Bob" });
  await store.flushAll();
  expect(JSON.parse(await readFile(join(root, "account", "vyline-test.json"), "utf8")))
    .toEqual({ alice: "Alice", bob: "Bob" });
});

test("the first cache mutation is persisted for an account with no directory yet", async () => {
  await store.mutate("new-account", (data) => { data.alice = "Alice"; });
  await store.flushAll();
  expect(JSON.parse(await readFile(join(root, "new-account", "vyline-test.json"), "utf8")))
    .toEqual({ alice: "Alice" });
});

test("a delayed initial load cannot overwrite an explicit replacement", async () => {
  let release!: () => void;
  const pendingRead = new Promise<null>((resolve) => { release = () => resolve(null); });
  const read = spyOn(dirs, "readAccountJson").mockImplementation(() => pendingRead);
  const loading = store.load("account");
  const replacement = store.replace("account", { fresh: "kept" });
  release();
  await Promise.all([loading, replacement]);
  read.mockRestore();
  expect(store.peek("account")).toEqual({ fresh: "kept" });
});

test("a replacement started first remains authoritative when a load starts immediately after it", async () => {
  let release!: () => void;
  const pendingRead = new Promise<null>(resolve => { release = () => resolve(null); });
  const read = spyOn(dirs, "readAccountJson").mockImplementation(() => pendingRead);
  try {
    const replacing = store.replace("account", { fresh: "kept" });
    const loading = store.load("account");
    await replacing;
    release();
    await loading;
    expect(store.peek("account")).toEqual({ fresh: "kept" });
  } finally { read.mockRestore(); }
});

test("flushAll waits for an active write and persists later mutations without exposing a partial file", async () => {
  const saving = new VylineStorage<{ version: number; cursor: bigint; added?: string }>("flush", () => ({ version: 0, cursor: 0n }));
  const target = join(root, "account", "vyline-flush.json");
  const files = new Map([[target, '{"version":0,"cursor":"0"}']]);
  const writes: Array<{ path: string; text: string }> = [];
  const entered = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
  const release = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
  const pending: Promise<void>[] = [];
  const turn = () => new Promise<void>(done => setImmediate(done));
  const spies = [
    spyOn(globalThis, "setTimeout").mockImplementation((() => 1) as unknown as typeof setTimeout),
    spyOn(io, "mkdir").mockResolvedValue(undefined),
    spyOn(io, "writeFile").mockImplementation(async (path, text) => {
      const index = writes.length;
      writes.push({ path: String(path), text: String(text) });
      entered[index]!.resolve();
      await release[index]!.promise;
      files.set(String(path), String(text));
    }),
    spyOn(io, "rename").mockImplementation(async (from, to) => {
      const text = files.get(String(from));
      if (text === undefined) throw new Error("missing temporary file");
      files.set(String(to), text); files.delete(String(from));
    }),
    spyOn(io, "unlink").mockImplementation(async path => { files.delete(String(path)); }),
  ];
  try {
    await saving.replace("account", { version: 1, cursor: 1n });
    pending.push(saving.flush("account"));
    await entered[0]!.promise;
    let idleDone = false;
    pending.push(saving.flushAll().then(() => { idleDone = true; }));
    await turn();
    expect(idleDone).toBe(false);
    await saving.mutate("account", data => { data.version = 2; data.cursor = 2n; data.added = "latest"; });
    let allDone = false;
    pending.push(saving.flushAll().then(() => { allDone = true; }));
    await turn();
    expect(allDone).toBe(false);
    expect(JSON.parse(files.get(target)!)).toEqual({ version: 0, cursor: "0" });
    release[0]!.resolve();
    expect(await Promise.race([entered[1]!.promise.then(() => "second-write"),
      Promise.all(pending).then(() => "settled-too-early")])).toBe("second-write");
    await turn();
    expect(allDone).toBe(false);
    expect(JSON.parse(files.get(target)!)).toEqual({ version: 1, cursor: "1" });
    release[1]!.resolve();
    await Promise.all(pending);
    expect(JSON.parse(files.get(target)!)).toEqual({ version: 2, cursor: "2", added: "latest" });
  } finally {
    for (const gate of release) gate.resolve();
    await Promise.allSettled(pending);
    for (const spy of spies.reverse()) spy.mockRestore();
  }
});

test("both flushAll waiters join the next revision at the write-completion boundary", async () => {
  const saving = new VylineStorage<{ version: number }>("completion", () => ({ version: 0 }));
  const target = join(root, "account", "vyline-completion.json");
  const files = new Map<string, string>();
  let writes = 0;
  const secondEntered = Promise.withResolvers<void>();
  const releaseSecond = Promise.withResolvers<void>();
  const done = [false, false];
  const waiters: Promise<void>[] = [];
  let first: Promise<void> = Promise.resolve();
  let mutation: Promise<unknown> = Promise.resolve();
  const spies = [
    spyOn(globalThis, "setTimeout").mockImplementation((() => 1) as unknown as typeof setTimeout),
    spyOn(io, "mkdir").mockResolvedValue(undefined),
    spyOn(io, "writeFile").mockImplementation(async (path, text) => {
      if (++writes === 2) { secondEntered.resolve(); await releaseSecond.promise; }
      files.set(String(path), String(text));
    }),
    spyOn(io, "rename").mockImplementation(async (from, to) => {
      files.set(String(to), files.get(String(from))!); files.delete(String(from));
      if (writes === 1) queueMicrotask(() => queueMicrotask(() => {
        mutation = saving.mutate("account", data => { data.version = 2; });
        queueMicrotask(() => {
          for (let index = 0; index < 2; index++) waiters.push(saving.flushAll().then(() => { done[index] = true; }));
        });
      }));
    }),
  ];
  try {
    await saving.replace("account", { version: 1 });
    first = saving.flush("account");
    await secondEntered.promise;
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(done).toEqual([false, false]);
    expect(JSON.parse(files.get(target)!)).toEqual({ version: 1 });
    releaseSecond.resolve();
    await Promise.all([first, mutation, ...waiters]);
    expect(done).toEqual([true, true]);
    expect(JSON.parse(files.get(target)!)).toEqual({ version: 2 });
    expect(writes).toBe(2);
  } finally {
    releaseSecond.resolve(); await Promise.allSettled([first, mutation, ...waiters]);
    for (const spy of spies.reverse()) spy.mockRestore();
  }
});
