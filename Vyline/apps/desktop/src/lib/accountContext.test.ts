import { expect, test } from "bun:test";
import { captureAccountContext } from "./accountContext";

test("accepted operations survive conversation updates but not an account round trip", () => {
  let state = { accountId: "a" as string | null, demoMode: false, chatId: "one" };
  type State = typeof state;
  const listeners = new Set<(value: State) => void>();
  const store = { getState: () => state, subscribe: (listener: (value: State) => void) => {
    listeners.add(listener); return () => { listeners.delete(listener); };
  } };
  const update = (next: Partial<typeof state>) => { state = { ...state, ...next }; listeners.forEach(listener => listener(state)); };
  const accepted = captureAccountContext(store);
  update({ chatId: "two" });
  expect(accepted.isCurrent()).toBe(true);
  update({ accountId: "b" });
  update({ accountId: "a" });
  expect(accepted.isCurrent()).toBe(false);
  const fresh = captureAccountContext(store);
  expect(fresh.isCurrent()).toBe(true);
  update({ demoMode: true });
  update({ demoMode: false });
  expect(fresh.isCurrent()).toBe(false);
  accepted.dispose(); fresh.dispose();
  expect(listeners.size).toBe(0);
});

test("a changed known LINE identity retires the context even under the same alias", () => {
  let state = { accountId: "same", demoMode: false, self: { mid: "" as string | undefined, name: "Pending" } };
  type State = typeof state;
  const listeners = new Set<(value: State) => void>();
  const store = { getState: () => state, subscribe: (listener: (value: State) => void) => {
    listeners.add(listener); return () => { listeners.delete(listener); };
  } };
  const update = (mid: string, name: string) => { state = { ...state, self: { mid, name } }; listeners.forEach(listener => listener(state)); };
  const accepted = captureAccountContext(store);
  update("MID-A", "Alice");
  expect(accepted.isCurrent()).toBe(true);
  update("MID-A", "Alice renamed");
  expect(accepted.isCurrent()).toBe(true);
  update("MID-B", "Bob");
  expect(accepted.isCurrent()).toBe(false);
  update("MID-A", "Alice again");
  expect(accepted.isCurrent()).toBe(false);
  accepted.dispose();
  expect(listeners.size).toBe(0);
});
