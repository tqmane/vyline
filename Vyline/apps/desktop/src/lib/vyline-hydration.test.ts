import { afterEach, expect, test } from "bun:test";
import { vylineClientClearHydration, vylineClientHydration, vylineClientSaveHydration, rememberLocalMessageDeletion } from "./vyline-cache";

const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
afterEach(() => {
  if (original) Object.defineProperty(globalThis, "localStorage", original);
  else Reflect.deleteProperty(globalThis, "localStorage");
});

test("local deletion stays absent when stale hydration is written again after reload", () => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
  const message = { id: "100", from: "u-peer", to: "c-group", text: "deleted original", contentType: "NONE", createdTime: 1000, isMyMessage: false };
  const bootstrap = { ok: true as const, chats: [{ mid: "c-group", name: "fixture", kind: "group" as const,
    hasMessages: true, lastMessageId: "100", lastMessageTime: 1000, lastMessagePreview: "deleted original" }], messagesByChat: { "c-group": [message] } };
  vylineClientSaveHydration("delete-cache", { bootstrap });
  const stale = values.get("vyline-data-cache:delete-cache")!;
  rememberLocalMessageDeletion("delete-cache", "c-group", "100");
  values.set("vyline-data-cache:delete-cache", stale);
  expect(vylineClientHydration("delete-cache")?.bootstrap?.messagesByChat["c-group"]).toEqual([]);
  expect(vylineClientHydration("delete-cache")?.bootstrap?.chats[0]?.lastMessagePreview).toBeUndefined();
  vylineClientSaveHydration("delete-cache", { bootstrap });
  expect(values.get("vyline-data-cache:delete-cache")).not.toContain("deleted original");
  vylineClientSaveHydration("different-cache", { bootstrap });
  expect(vylineClientHydration("different-cache")?.bootstrap?.messagesByChat["c-group"]).toHaveLength(1);
});

test("hydration survives reload, expires, stays account scoped and tolerates unavailable storage", () => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
  const bootstrap = { ok: true as const, chats: [], messagesByChat: {} };
  vylineClientSaveHydration("first", { bootstrap });
  expect(vylineClientHydration("first")?.bootstrap).toEqual(bootstrap);
  expect(vylineClientHydration("second")).toBeNull();
  expect(vylineClientHydration("first", Date.now() + 25 * 3600000)).toBeNull();
  values.set("vyline-data-cache:second", values.get("vyline-data-cache:first")!);
  expect(vylineClientHydration("second")).toBeNull();
  values.set("vyline-data-cache:first", "invalid JSON");
  expect(vylineClientHydration("first")).toBeNull();
  vylineClientSaveHydration("first", { bootstrap });
  vylineClientClearHydration("first");
  expect(vylineClientHydration("first")).toBeNull();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get: () => { throw new Error("Storage blocked"); } });
  expect(() => vylineClientSaveHydration("first", { bootstrap })).not.toThrow();
  expect(vylineClientHydration("first")).toBeNull();
});
