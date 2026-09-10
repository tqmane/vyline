import { describe, expect, it } from "bun:test";
import { emitAppEvent, matchesChatScrollLatestScope, onAppEvent } from "./appEvents.js";

describe("chat latest scope compatibility", () => {
  it("keeps legacy manual events compatible for real and demo panes", () => {
    expect(matchesChatScrollLatestScope({ chatId: "chat" }, "chat", "account-a")).toBe(true);
    expect(matchesChatScrollLatestScope({ chatId: "chat" }, "chat", null)).toBe(true);
    expect(matchesChatScrollLatestScope({ chatId: "other" }, "chat", "account-a")).toBe(false);
  });

  it("rejects explicit mismatched accounts, including demo null", () => {
    expect(
      matchesChatScrollLatestScope({ chatId: "chat", accountId: "account-a" }, "chat", "account-a"),
    ).toBe(true);
    expect(
      matchesChatScrollLatestScope({ chatId: "chat", accountId: "account-a" }, "chat", "account-b"),
    ).toBe(false);
    expect(
      matchesChatScrollLatestScope({ chatId: "chat", accountId: null }, "chat", "account-a"),
    ).toBe(false);
    expect(
      matchesChatScrollLatestScope({ chatId: "chat", accountId: "account-a" }, "chat", null),
    ).toBe(false);
    expect(matchesChatScrollLatestScope({ chatId: "chat", accountId: null }, "chat", null)).toBe(
      true,
    );
    expect(
      matchesChatScrollLatestScope(
        { chatId: "other", accountId: "account-a" },
        "chat",
        "account-a",
      ),
    ).toBe(false);
  });

  it("dispatches a manual event synchronously and unsubscribes without leaking listeners", () => {
    let count = 0;
    const off = onAppEvent("chat:scroll-latest", (value) => {
      if (matchesChatScrollLatestScope(value, "chat", "account-a")) count += 1;
    });
    try {
      emitAppEvent("chat:scroll-latest", { chatId: "chat" });
      expect(count).toBe(1);
      emitAppEvent("chat:scroll-latest", { chatId: "chat", accountId: "account-b" });
      expect(count).toBe(1);
    } finally {
      off();
    }
    emitAppEvent("chat:scroll-latest", { chatId: "chat" });
    expect(count).toBe(1);
  });
});
