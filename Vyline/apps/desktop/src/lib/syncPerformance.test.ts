import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { api } from "@/api/client";
import { sortChats, useStore, type Chat, type Message } from "@/lib/store";

const initial = useStore.getState();
afterEach(() => useStore.setState(initial, true));

function makeChat(id: string, overrides: Partial<Chat> = {}): Chat {
  return {
    id,
    type: "friend",
    name: id,
    avatar: id.charAt(0).toUpperCase(),
    color: "#2aabee",
    status: "",
    unread: 0,
    ...overrides,
  };
}

function makeMessage(id: string, chatId: string, createdAt: number): Message {
  return {
    id,
    chatId,
    authorId: chatId,
    kind: "text",
    text: "hello",
    createdAt,
    status: "sent",
    read: false,
    messageState: "normal",
  };
}

describe("syncPerformance", () => {
  test("sortChats orders chats by unread, custom order, and recent while keeping pinned first", () => {
    const chats: Chat[] = [
      makeChat("c1", { unread: 0, lastMessageTime: 3000 }),
      makeChat("c2", { unread: 2, lastMessageTime: 1000 }),
      makeChat("c3", { unread: 2, lastMessageTime: 2000 }),
      makeChat("c4", { pinned: true, unread: 0, lastMessageTime: 500 }),
    ];
    const messages = [makeMessage("m1", "c2", 5000)];

    expect(sortChats(chats, "unread", messages, []).map((c) => c.id)).toEqual([
      "c4",
      "c2",
      "c3",
      "c1",
    ]);

    expect(
      sortChats(chats, "custom", messages, ["c3", "c1", "c2"]).map((c) => c.id),
    ).toEqual(["c4", "c3", "c1", "c2"]);

    expect(sortChats(chats, "recent", messages, []).map((c) => c.id)).toEqual([
      "c4",
      "c1",
      "c2",
      "c3",
    ]);
  });

  test("pollMessagesDelta bypasses throttle when force is true", async () => {
    const chatId = "u-force-delta";
    useStore.setState(
      {
        ...initial,
        accountId: "acc-force-delta",
        demoMode: false,
        chats: [makeChat(chatId)],
        messages: [makeMessage("100", chatId, 1000)],
      },
      true,
    );
    const deltaSpy = spyOn(api.line, "messagesDelta").mockResolvedValue({
      ok: true,
      messages: [],
    });
    try {
      await useStore.getState().pollMessagesDelta(chatId);
      await useStore.getState().pollMessagesDelta(chatId);
      expect(deltaSpy).toHaveBeenCalledTimes(1);

      await useStore.getState().pollMessagesDelta(chatId, { force: true });
      expect(deltaSpy).toHaveBeenCalledTimes(2);
    } finally {
      deltaSpy.mockRestore();
    }
  });

  test("pollIncoming refreshes chat list after recovering from a poll error", async () => {
    const accountId = "acc-recover";
    useStore.setState(
      {
        ...initial,
        accountId,
        demoMode: false,
        activeChatId: null,
        chats: [makeChat("u-recover")],
        messages: [],
      },
      true,
    );
    const pollSpy = spyOn(api.line, "pollEvents")
      .mockRejectedValueOnce(new Error("REQUEST_TIMEOUT"))
      .mockResolvedValueOnce({ ok: true, cursor: 5, events: [], reset: false, seq: 5 });
    const chatsSpy = spyOn(api.line, "chats").mockResolvedValue({ ok: true, chats: [] });
    try {
      await useStore.getState().pollIncoming();
      expect(chatsSpy).not.toHaveBeenCalled();

      await useStore.getState().pollIncoming();
      await Promise.resolve();
      expect(chatsSpy).toHaveBeenCalledTimes(1);
    } finally {
      pollSpy.mockRestore();
      chatsSpy.mockRestore();
    }
  });
});
