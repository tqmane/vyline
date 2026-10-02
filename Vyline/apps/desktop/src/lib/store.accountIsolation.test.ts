import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { api, type Announcement, type LineProfile } from "../api/client.js";
import { useStore } from "./store.js";
import type { Chat } from "./store-types.js";

// Account isolation for async store actions.
//
// Every async action captures `accountId` before its first `await`. If the user
// switches accounts while the RPC is in flight, the continuation must NOT write
// into the newly active account's state. These tests reproduce the switch while
// the request is still pending and assert the late result is discarded.

const CHAT_ID = "c-account-isolation-fixture";
const FRIEND_ID = "u-account-isolation-fixture";

function baseState(accountId: string, chats: Chat[] = []) {
  return {
    accountId,
    activeChatId: null as string | null,
    chats,
    messages: [] as ReturnType<typeof useStore.getState>["messages"],
    announcements: {} as Record<string, Announcement[]>,
    blockedMids: [] as string[],
  };
}

function restoreState() {
  useStore.setState({
    accountId: null,
    chats: [],
    messages: [],
    announcements: {},
    blockedMids: [],
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  restoreState();
});

afterEach(() => {
  restoreState();
});

describe("store async account isolation", () => {
  it("drops an announcement list that resolves after the account changed", async () => {
    const gate = deferred<{ ok: boolean; data: Announcement[] }>();
    const list = spyOn(api.line.announce, "list").mockReturnValue(gate.promise as never);
    try {
      useStore.setState(baseState("account-a"));

      const pending = useStore.getState().loadAnnouncements(CHAT_ID);
      useStore.getState().setAccountId("account-b");
      gate.resolve({
        ok: true,
        data: [{ announcementSeq: "1", text: "A の告知" } as Announcement],
      });
      await pending;

      expect(list).toHaveBeenCalledTimes(1);
      expect(useStore.getState().announcements[CHAT_ID]).toBeUndefined();
    } finally {
      list.mockRestore();
    }
  });

  it("drops mark-all-read completion that resolves after the account changed", async () => {
    const gate = deferred<{ ok: boolean }>();
    const markAll = spyOn(api.line, "markAllAsRead").mockReturnValue(gate.promise as never);
    try {
      const chat: Chat = {
        id: CHAT_ID,
        type: "group",
        name: "Group",
        avatar: "G",
        color: "#000",
        status: "",
        unread: 5,
      };
      useStore.setState({
        ...baseState("account-a", [chat]),
        settings: { ...useStore.getState().settings, readReceipts: true },
      });

      const pending = useStore.getState().markAllChatsRead();

      // Account B is loaded and legitimately has its own unread badge for the same chat.
      useStore.getState().setAccountId("account-b");
      useStore.setState(baseState("account-b", [{ ...chat, unread: 7 }]));

      gate.resolve({ ok: true });
      await pending;

      expect(useStore.getState().chats[0]?.unread).toBe(7);
    } finally {
      markAll.mockRestore();
    }
  });

  it("drops a member profile resolved after the account changed", async () => {
    const gate = deferred<{ ok: boolean; profile?: LineProfile }>();
    const contactProfile = spyOn(api.line, "contactProfile").mockReturnValue(gate.promise as never);
    try {
      const chat = (name: string): Chat => ({
        id: CHAT_ID,
        type: "group",
        name: "Group",
        avatar: "G",
        color: "#000",
        status: "",
        unread: 0,
        members: [{ id: FRIEND_ID, name, avatar: "?", color: "#111" }],
      });
      const noReceipts = { ...useStore.getState().settings, readReceipts: false };
      useStore.setState({ ...baseState("account-a", [chat("Unknown")]), settings: noReceipts });
      // mark the chat as opened so an incoming message triggers the member profile lookup
      useStore.getState().openChat(CHAT_ID);
      useStore.setState({
        ...baseState("account-a", [chat("Unknown")]),
        activeChatId: CHAT_ID,
        settings: noReceipts,
      });

      useStore.getState().mergeIncomingMessages(CHAT_ID, [
        {
          id: "m-1",
          from: FRIEND_ID,
          to: "u-me",
          text: "hi",
          contentType: "NONE",
          createdTime: 1_000,
          isMyMessage: false,
        },
      ]);
      await Promise.resolve();
      expect(contactProfile).toHaveBeenCalledWith("account-a", FRIEND_ID);

      // Account B is a member of the same group and must not inherit A's resolved name.
      useStore.getState().setAccountId("account-b");
      useStore.setState({
        ...baseState("account-b", [chat("Unknown")]),
        activeChatId: CHAT_ID,
        settings: noReceipts,
      });

      gate.resolve({
        ok: true,
        profile: { displayName: "A's Friend" } as LineProfile,
      });
      await Promise.resolve();
      await Promise.resolve();

      expect(useStore.getState().chats[0]?.members?.[0]?.name).toBe("Unknown");
    } finally {
      contactProfile.mockRestore();
    }
  });

  it("drops a blocked-list sync that resolves after the account changed", async () => {
    const gate = deferred<{ ok: boolean; mids: string[] }>();
    const blocked = spyOn(api.line, "blockedContacts").mockReturnValue(gate.promise as never);
    try {
      useStore.setState({ ...baseState("account-a"), demoMode: false });

      const pending = useStore.getState().syncBlockedMids();
      useStore.getState().setAccountId("account-b");
      gate.resolve({ ok: true, mids: [FRIEND_ID] });
      await pending;

      expect(useStore.getState().blockedMids).toEqual([]);
    } finally {
      blocked.mockRestore();
    }
  });
});
