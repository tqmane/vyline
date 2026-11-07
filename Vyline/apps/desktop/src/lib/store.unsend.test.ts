import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { api } from "../api/client.js";
import { useStore, type Message } from "./store.js";

const initial = useStore.getState();
const now = 1_800_000_000_000;
const message: Message = {
  id: "100", chatId: "c-unsend-fixture", authorId: "me", kind: "text",
  text: "keep if rejected", createdAt: now - 23 * 60 * 60 * 1000,
  status: "sent", read: false, messageState: "normal",
};
let restores: Array<() => void>;

beforeEach(() => {
  const clock = spyOn(Date, "now").mockReturnValue(now);
  restores = [() => clock.mockRestore()];
  useStore.setState({
    ...initial, accountId: "unsend-fixture", demoMode: false,
    self: { ...initial.self, premium: { active: false } },
    messages: [{ ...message }], notice: null,
    refreshMessages: async () => {},
  }, true);
});

afterEach(() => {
  for (const restore of restores) restore();
  useStore.setState(initial, true);
});

test("a 23-hour normal unsend reaches the API and rolls back a server rejection", async () => {
  const unsend = spyOn(api.line, "unsend").mockResolvedValue({
    ok: false, error: "MESSAGE_NOT_DESTRUCTIBLE: server rejected",
  });
  restores.push(() => unsend.mockRestore());
  await useStore.getState().revokeMessage(message.id);
  expect(unsend).toHaveBeenCalledWith("unsend-fixture", message.id);
  expect(useStore.getState().messages[0]?.messageState).toBe("normal");
  expect(useStore.getState().messages[0]?.text).toBe(message.text);
  expect(useStore.getState().messages[0]?.revokedSnapshot).toBeUndefined();
});

test("the desktop rejects messages older than 24 hours before the API call", async () => {
  useStore.setState({ messages: [{ ...message, createdAt: now - 86_400_001 }] });
  const unsend = spyOn(api.line, "unsend").mockResolvedValue({ ok: false, error: "must not be called" });
  restores.push(() => unsend.mockRestore());
  await useStore.getState().revokeMessage(message.id);
  expect(unsend).not.toHaveBeenCalled();
  expect(useStore.getState().messages[0]?.messageState).toBe("normal");
});
