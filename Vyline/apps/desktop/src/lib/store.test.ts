import { describe, expect, it } from "bun:test";
import { api } from "../api/client.js";
import { isResolvedMemberProfileName, resolveChatToOpen, useStore } from "./store.js";

describe("useStore account initialization", () => {
  it("does not restore the last opened chat when an account initializes", () => {
    const storage = new Map<string, string>();
    storage.set("vyline:last-opened-chat:account-1", "chat-last-opened");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    });
    useStore.setState({
      accountId: null,
      activeChatId: "persisted-chat",
      chatPaneIds: ["persisted-chat"],
      chatPaneSizes: [100],
      focusedChatPane: 0,
    });

    useStore.getState().setAccountId("account-1");

    expect(useStore.getState().activeChatId).toBeNull();
    expect(useStore.getState().chatPaneIds).toEqual([]);
  });

  it("does not auto-select the newest chat but preserves an explicit valid selection", () => {
    const available = ["chat-newest-message", "chat-selected"];
    expect(resolveChatToOpen("account-1", null, available)).toBeNull();
    expect(resolveChatToOpen("account-1", "chat-selected", available)).toBe("chat-selected");
    expect(resolveChatToOpen("account-1", "missing", available)).toBeNull();
  });

  it("resets the account into the chat-selection state", () => {
    useStore.setState({
      accountId: "account-1",
      activeChatId: "chat-open",
      chatPaneIds: ["chat-open"],
      chatPaneSizes: [100],
      focusedChatPane: 0,
    });

    useStore.getState().resetAccountData();

    expect(useStore.getState().activeChatId).toBeNull();
    expect(useStore.getState().chatPaneIds).toEqual([]);
    expect(useStore.getState().chatPaneSizes).toEqual([]);
  });

  it("opens an explicitly selected chat at the latest-message position", () => {
    useStore.setState({
      accountId: "account-1",
      demoMode: true,
      activeChatId: null,
      chatPaneIds: [],
      chatPaneSizes: [],
      focusedChatPane: 0,
      chats: [
        {
          id: "chat-unread",
          type: "friend",
          name: "Unread",
          avatar: "U",
          color: "#000",
          status: "",
          unread: 4,
        },
      ],
      messages: [],
    });

    useStore.getState()._activateChat("chat-unread", { history: false });

    expect(useStore.getState().activeChatId).toBe("chat-unread");
    expect(useStore.getState().initialChatScrollMessageId).toBeNull();
    expect(useStore.getState().initialChatScrollMode).toBe("bottom");
    expect(useStore.getState().chats[0]?.unread).toBe(0);
  });

  it("keeps per-chat read-disabled settings during reload hydration", () => {
    useStore.setState({
      accountId: "account-1",
      readDisabledMids: { "chat-read-disabled": true },
    });

    useStore.getState().resetAccountData();

    expect(useStore.getState().readDisabledMids).toEqual({ "chat-read-disabled": true });
  });

  it("clears the last opened chat when switching accounts", () => {
    useStore.setState({
      accountId: "account-1",
      activeChatId: "chat-account-1",
    });

    useStore.getState().setAccountId("account-2");

    expect(useStore.getState().activeChatId).toBeNull();
  });

  it("does not leak the previous account profile into the next account", () => {
    useStore.setState({
      accountId: "account-1",
      self: {
        name: "Account One",
        avatar: "A",
        avatarUrl: "https://example.com/a.png",
        status: "old",
        mid: "u-account-1",
      },
    });

    useStore.getState().setAccountId("account-2");

    expect(useStore.getState().self).toEqual({ name: "Vyline", avatar: "V", status: "" });
  });

  it("hydrates the active account MID along with its profile", () => {
    useStore.setState({ accountId: "account-2", chats: [], messages: [] });

    useStore.getState().hydrateLineData({
      profile: {
        mid: "u-account-2",
        displayName: "Account Two",
        statusMessage: "ready",
      },
      chats: [],
      messages: [],
      hiddenMids: new Set(),
      contactCache: new Map(),
    });

    expect(useStore.getState().self.mid).toBe("u-account-2");
    expect(useStore.getState().self.name).toBe("Account Two");
  });
});

describe("reader profile resolution", () => {
  it("distinguishes real names from unresolved reader placeholders", () => {
    expect(isResolvedMemberProfileName("山田太郎")).toBe(true);
    expect(isResolvedMemberProfileName("メンバー")).toBe(false);
    expect(isResolvedMemberProfileName("member")).toBe(false);
    expect(isResolvedMemberProfileName("u0123456789abcdef0123456789abcdef")).toBe(false);
    expect(isResolvedMemberProfileName("u0123456789a...")).toBe(false);
    expect(isResolvedMemberProfileName(undefined)).toBe(false);
  });
});

describe("group read receipt refresh", () => {
  it("force-refreshes an old targeted message and monotonically merges readers", async () => {
    const originalReadReceipts = api.line.readReceipts;
    const calls: Array<{ ids: string[]; force: boolean }> = [];
    api.line.readReceipts = async (_accountId, _chatMid, messageIds, opts) => {
      calls.push({ ids: messageIds, force: opts?.force === true });
      return {
        ok: true,
        receipts: {
          "100": { readCount: 1, readBy: ["u-new"] },
        },
        memberReadWatermarks: [{ mid: "u-new", upTo: "100" }],
        memberReadRanges: [{ mid: "u-new", startExclusive: "0", endInclusive: "100" }],
      };
    };

    try {
      useStore.setState({
        accountId: "account-read-test",
        chats: [
          {
            id: "c-group",
            type: "group",
            name: "Group",
            avatar: "G",
            color: "#000",
            status: "",
            unread: 0,
            members: [
              { id: "u-old", name: "Old Reader", avatar: "O", color: "#111" },
              { id: "u-new", name: "New Reader", avatar: "N", color: "#222" },
            ],
          },
        ],
        messages: [
          {
            id: "100",
            chatId: "c-group",
            authorId: "me",
            kind: "text",
            text: "old message",
            createdAt: Date.now() - 60 * 60_000,
            status: "read",
            read: true,
            readBy: ["u-old"],
            readCount: 1,
            messageState: "normal",
          },
        ],
        readWatermarks: {
          "account-read-test:c-group": {
            memberWatermarks: [{ mid: "u-old", upTo: "100" }],
            memberReadRanges: [{ mid: "u-old", startExclusive: "0", endInclusive: "100" }],
            at: 0,
          },
        },
      });

      await useStore.getState().refreshReadReceipts("c-group", { force: true, messageId: "100" });

      expect(calls).toEqual([{ ids: ["100"], force: true }]);
      expect(useStore.getState().messages[0]?.readBy).toEqual(["u-old", "u-new"]);
      expect(
        useStore.getState().readWatermarks["account-read-test:c-group"]?.memberReadRanges,
      ).toEqual([
        { mid: "u-old", startExclusive: "0", endInclusive: "100" },
        { mid: "u-new", startExclusive: "0", endInclusive: "100" },
      ]);
    } finally {
      api.line.readReceipts = originalReadReceipts;
    }
  });
});
