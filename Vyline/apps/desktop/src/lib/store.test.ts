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

describe("chat list freshness", () => {
  it("keeps newer local chat metadata and ordering during stale hydration", () => {
    useStore.setState({
      accountId: "account-chat-list-hydrate",
      activeChatId: null,
      chats: [
        {
          id: "u-newest",
          type: "friend",
          name: "Newest",
          avatar: "N",
          color: "#111",
          status: "",
          unread: 0,
          lastMessageId: "200",
          lastMessageTime: 2_000,
          lastMessagePreview: "あなた: newest",
        },
        {
          id: "u-other",
          type: "friend",
          name: "Other",
          avatar: "O",
          color: "#222",
          status: "",
          unread: 0,
          lastMessageId: "150",
          lastMessageTime: 1_500,
          lastMessagePreview: "other",
        },
      ],
      messages: [],
    });

    useStore.getState().hydrateLineData({
      profile: null,
      chats: [
        {
          mid: "u-other",
          name: "Other",
          hasMessages: true,
          kind: "direct",
          lastMessageId: "150",
          lastMessageTime: 1_500,
          lastMessagePreview: "other",
        },
        {
          mid: "u-newest",
          name: "Newest",
          hasMessages: true,
          kind: "direct",
          lastMessageId: "100",
          lastMessageTime: 1_000,
          lastMessagePreview: "stale",
        },
      ],
      messages: [],
      hiddenMids: new Set(),
      contactCache: new Map(),
    });

    expect(useStore.getState().chats.map((chat) => chat.id)).toEqual(["u-newest", "u-other"]);
    expect(useStore.getState().chats[0]).toMatchObject({
      lastMessageId: "200",
      lastMessageTime: 2_000,
      lastMessagePreview: "あなた: newest",
    });
  });

  it("keeps a truly newer server chat ahead of a locally protected stale row", () => {
    useStore.setState({
      accountId: "account-chat-list-new-chat",
      activeChatId: null,
      chats: [
        {
          id: "u-local",
          type: "friend",
          name: "Local",
          avatar: "L",
          color: "#111",
          status: "",
          unread: 0,
          lastMessageId: "200",
          lastMessageTime: 2_000,
          lastMessagePreview: "あなた: local",
        },
        {
          id: "u-other",
          type: "friend",
          name: "Other",
          avatar: "O",
          color: "#222",
          status: "",
          unread: 0,
          lastMessageId: "50",
          lastMessageTime: 500,
          lastMessagePreview: "other",
        },
      ],
      messages: [],
    });

    useStore.getState().hydrateLineData({
      profile: null,
      chats: [
        {
          mid: "u-new",
          name: "New",
          hasMessages: true,
          kind: "direct",
          lastMessageId: "300",
          lastMessageTime: 3_000,
          lastMessagePreview: "new",
        },
        {
          mid: "u-local",
          name: "Local",
          hasMessages: true,
          kind: "direct",
          lastMessageId: "100",
          lastMessageTime: 1_000,
          lastMessagePreview: "stale",
        },
        {
          mid: "u-other",
          name: "Other",
          hasMessages: true,
          kind: "direct",
          lastMessageId: "50",
          lastMessageTime: 500,
          lastMessagePreview: "other",
        },
      ],
      messages: [],
      hiddenMids: new Set(),
      contactCache: new Map(),
    });

    expect(useStore.getState().chats.map((chat) => chat.id)).toEqual([
      "u-new",
      "u-local",
      "u-other",
    ]);
    expect(useStore.getState().chats[1]).toMatchObject({
      lastMessageId: "200",
      lastMessageTime: 2_000,
      lastMessagePreview: "あなた: local",
    });
  });

  it("updates and raises the chat row as soon as an optimistic send is inserted", async () => {
    const originalSend = api.line.send;
    type SendResult = Awaited<ReturnType<typeof originalSend>>;
    let finishSend: ((result: SendResult) => void) | undefined;
    api.line.send = async () =>
      await new Promise<SendResult>((resolve) => {
        finishSend = resolve;
      });

    try {
      useStore.setState({
        accountId: "account-chat-list-send",
        demoMode: false,
        activeChatId: "u-target",
        chats: [
          {
            id: "u-other",
            type: "friend",
            name: "Other",
            avatar: "O",
            color: "#111",
            status: "",
            unread: 0,
            lastMessageId: "20",
            lastMessageTime: 2_000,
            lastMessagePreview: "other",
          },
          {
            id: "u-target",
            type: "friend",
            name: "Target",
            avatar: "T",
            color: "#222",
            status: "",
            unread: 0,
            lastMessageId: "10",
            lastMessageTime: 1_000,
            lastMessagePreview: "old",
          },
        ],
        messages: [],
        blockedMids: [],
        replyToId: null,
      });

      await useStore.getState().sendMessage("u-target", "hello");

      const target = useStore.getState().chats[0];
      expect(target?.id).toBe("u-target");
      expect(target?.lastMessagePreview).toBe("あなた: hello");
      expect(target?.lastMessageId?.startsWith("pending_")).toBe(true);
      finishSend?.({ ok: false, error: "test failure" });
      await Promise.resolve();
    } finally {
      api.line.send = originalSend;
    }
  });

  it("updates and raises the chat row when a received message is merged", () => {
    useStore.setState({
      accountId: "account-chat-list-receive",
      activeChatId: null,
      chats: [
        {
          id: "u-other",
          type: "friend",
          name: "Other",
          avatar: "O",
          color: "#111",
          status: "",
          unread: 0,
          lastMessageId: "20",
          lastMessageTime: 2_000,
          lastMessagePreview: "other",
        },
        {
          id: "u-sender",
          type: "friend",
          name: "Sender",
          avatar: "S",
          color: "#222",
          status: "",
          unread: 0,
          lastMessageId: "10",
          lastMessageTime: 1_000,
          lastMessagePreview: "old",
        },
      ],
      messages: [],
    });

    useStore.getState().mergeIncomingMessages(
      "u-sender",
      [
        {
          id: "30",
          from: "u-sender",
          to: "u-me",
          text: "received",
          contentType: "NONE",
          createdTime: 3_000,
          isMyMessage: false,
        },
      ],
      { silent: true },
    );

    expect(useStore.getState().chats[0]).toMatchObject({
      id: "u-sender",
      lastMessageId: "30",
      lastMessageTime: 3_000,
      lastMessagePreview: "received",
    });
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

  it("keeps the first read time on received messages when the reader advances", async () => {
    const originalReadReceipts = api.line.readReceipts;
    let poll = 0;
    api.line.readReceipts = async () => {
      poll += 1;
      if (poll === 1) {
        return {
          ok: true,
          receipts: {
            "100": {
              readCount: 1,
              readBy: ["u-reader"],
              readByAt: { "u-reader": 10_000 },
            },
            "200": { readCount: 0, readBy: [] },
          },
          memberReadWatermarks: [{ mid: "u-reader", upTo: "100" }],
          memberReadRanges: [
            {
              mid: "u-reader",
              startExclusive: "0",
              endInclusive: "100",
              readAt: 10_000,
            },
          ],
        };
      }
      return {
        ok: true,
        receipts: {
          "100": {
            readCount: 1,
            readBy: ["u-reader"],
            readByAt: { "u-reader": 11_000 },
          },
          "200": {
            readCount: 1,
            readBy: ["u-reader"],
            readByAt: { "u-reader": 11_000 },
          },
        },
        memberReadWatermarks: [{ mid: "u-reader", upTo: "200" }],
        memberReadRanges: [
          {
            mid: "u-reader",
            startExclusive: "0",
            endInclusive: "200",
            readAt: 11_000,
          },
        ],
      };
    };

    try {
      useStore.setState({
        accountId: "account-received-read-time",
        chats: [
          {
            id: "c-received-read-time",
            type: "group",
            name: "Group",
            avatar: "G",
            color: "#000",
            status: "",
            unread: 0,
            members: [
              { id: "u-sender", name: "Sender", avatar: "S", color: "#111" },
              { id: "u-reader", name: "Reader", avatar: "R", color: "#222" },
            ],
          },
        ],
        messages: [
          {
            id: "100",
            chatId: "c-received-read-time",
            authorId: "u-sender",
            kind: "text",
            text: "A",
            createdAt: 1_000,
            status: "sent",
            read: false,
            messageState: "normal",
          },
          {
            id: "200",
            chatId: "c-received-read-time",
            authorId: "u-sender",
            kind: "text",
            text: "B",
            createdAt: 2_000,
            status: "sent",
            read: false,
            messageState: "normal",
          },
        ],
        readWatermarks: {},
      });

      await useStore
        .getState()
        .refreshReadReceipts("c-received-read-time", { force: true, messageId: "100" });
      await useStore
        .getState()
        .refreshReadReceipts("c-received-read-time", { force: true, messageId: "200" });

      const messages = new Map(
        useStore.getState().messages.map((message) => [message.id, message]),
      );
      expect(messages.get("100")?.readByAt).toEqual({ "u-reader": 10_000 });
      expect(messages.get("200")?.readByAt).toEqual({ "u-reader": 11_000 });
      expect(
        useStore.getState().readWatermarks["account-received-read-time:c-received-read-time"]
          ?.memberReadRanges,
      ).toEqual([
        {
          mid: "u-reader",
          startExclusive: "0",
          endInclusive: "100",
          readAt: 10_000,
        },
        {
          mid: "u-reader",
          startExclusive: "100",
          endInclusive: "200",
          readAt: 11_000,
        },
      ]);
    } finally {
      api.line.readReceipts = originalReadReceipts;
    }
  });

  it("falls back to the full group member list for readers missing from warm cache", async () => {
    const originalReadReceipts = api.line.readReceipts;
    const originalVylineWarm = api.line.vylineWarm;
    const originalChatMembers = api.line.chatMembers;
    let warmCalls = 0;
    let memberCalls = 0;
    api.line.readReceipts = async () => ({
      ok: true,
      receipts: {
        "200": { readCount: 1, readBy: ["u-reader-missing"] },
      },
      memberReadWatermarks: [{ mid: "u-reader-missing", upTo: "200" }],
      memberReadRanges: [{ mid: "u-reader-missing", startExclusive: "0", endInclusive: "200" }],
    });
    api.line.vylineWarm = async () => {
      warmCalls += 1;
      return { ok: true, profiles: {} };
    };
    api.line.chatMembers = async () => {
      memberCalls += 1;
      return {
        ok: true,
        members: [
          {
            mid: "u-reader-missing",
            displayName: "取得できた読者",
            thumbnailUrl: "https://example.com/reader.png",
          },
        ],
      };
    };

    try {
      useStore.setState({
        accountId: "account-reader-fallback",
        chats: [
          {
            id: "c-reader-fallback",
            type: "group",
            name: "Group",
            avatar: "G",
            color: "#000",
            status: "",
            unread: 0,
            members: [
              {
                id: "u-reader-missing",
                name: "メンバー",
                avatar: "•",
                color: "#111",
              },
            ],
          },
        ],
        messages: [
          {
            id: "200",
            chatId: "c-reader-fallback",
            authorId: "me",
            kind: "text",
            text: "message",
            createdAt: Date.now(),
            status: "sent",
            read: false,
            messageState: "normal",
          },
        ],
        readWatermarks: {},
      });

      await useStore
        .getState()
        .refreshReadReceipts("c-reader-fallback", { force: true, messageId: "200" });
      await Promise.resolve();

      expect(warmCalls).toBe(1);
      expect(memberCalls).toBe(1);
      expect(useStore.getState().chats[0]?.members?.[0]).toMatchObject({
        id: "u-reader-missing",
        name: "取得できた読者",
        avatarUrl: "https://example.com/reader.png",
      });
    } finally {
      api.line.readReceipts = originalReadReceipts;
      api.line.vylineWarm = originalVylineWarm;
      api.line.chatMembers = originalChatMembers;
    }
  });
});
