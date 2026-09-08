import { afterEach, expect, test } from "bun:test";
import { vylineClientClearHydration, vylineClientHydration, vylineClientSaveHydration } from "./vyline-cache";

const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
afterEach(() => {
  if (original) Object.defineProperty(globalThis, "localStorage", original);
  else Reflect.deleteProperty(globalThis, "localStorage");
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
