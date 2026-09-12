import { api } from "@/api/client";
import { expect, test } from "bun:test";
import { useStore } from "./store";
import { reactToMessage } from "./messageActions";
import { canToggleContactBlock, setContactBlocked } from "./chatActions";

test("shared reaction action preserves demo behavior and rejects unsupported targets", async () => {
  const before = useStore.getState();
  useStore.setState({
    demoMode: true,
    accountId: null,
    self: { ...before.self, mid: "self" },
    chats: [
      {
        id: "test-chat",
        type: "friend",
        name: "テスト",
        avatar: "T",
        color: "#123456",
        status: "",
        unread: 0,
      },
    ],
    messages: [
      {
        id: "message",
        chatId: "test-chat",
        authorId: "other",
        kind: "text",
        text: "テスト",
        createdAt: Date.now(),
        status: "sent",
        read: false,
        messageState: "normal",
      },
    ],
  });
  const originalReact = api.line.react;
  try {
    expect(await reactToMessage("message", 3, false)).toEqual({ ok: true });
    expect(useStore.getState().messages[0]?.reactions?.[0]).toMatchObject({
      type: 3,
      fromMid: "self",
    });
    expect(await reactToMessage("message", 3, true)).toEqual({ ok: true });
    expect(useStore.getState().messages[0]?.reactions ?? []).toHaveLength(0);
    expect((await reactToMessage("message", 99, false)).ok).toBe(false);
    expect(canToggleContactBlock("test-chat")).toBe(false);
    expect((await setContactBlocked("test-chat", true)).ok).toBe(false);
    expect(useStore.getState().chats).toHaveLength(1);
    const emoji = { productId: "670e0cce840a8236ddd4ee4c", emojiId: "143", version: 7, resourceType: 2 };
    expect(await reactToMessage("message", emoji, false)).toEqual({ ok: true });
    expect(useStore.getState().messages[0]?.reactions?.[0]).toMatchObject({ type: 0, emoji });
    await reactToMessage("message", emoji, true);
    useStore.setState({ demoMode: false, accountId: "test-account" });
    api.line.react = async () => ({ ok: false, error: "拒否" });
    expect(await reactToMessage("message", emoji, false)).toEqual({ ok: false, error: "拒否" });
    expect(useStore.getState().messages[0]?.reactions ?? []).toHaveLength(0);
    const requests: unknown[] = [];
    api.line.react = async (_accountId, _messageId, reaction) => { requests.push(reaction); return { ok: true }; };
    expect(await reactToMessage("message", emoji, false)).toEqual({ ok: true });
    expect(await reactToMessage("message", emoji, true)).toEqual({ ok: true });
    expect(requests).toEqual([emoji, "UNDO"]);
    expect(useStore.getState().messages).toHaveLength(1);
  } finally {
    api.line.react = originalReact;
    useStore.setState(before, true);
  }
});

test("reaction completion from a retired A session cannot mutate A after A -> B -> A", async () => {
  const before = useStore.getState();
  const originalReact = api.line.react;
  let resolveReaction!: (value: { ok: boolean }) => void;
  const pendingReaction = new Promise<{ ok: boolean }>((resolve) => {
    resolveReaction = resolve;
  });
  const chat = {
    id: "test-chat-session",
    type: "friend" as const,
    name: "Session test",
    avatar: "S",
    color: "#123456",
    status: "",
    unread: 0,
  };
  const message = {
    id: "message-session",
    chatId: chat.id,
    authorId: "other",
    kind: "text" as const,
    text: "test",
    createdAt: Date.now(),
    status: "sent" as const,
    read: false,
    messageState: "normal" as const,
  };
  try {
    useStore.setState({
      demoMode: false,
      accountId: "account-a",
      self: { ...before.self, mid: "self-a" },
      chats: [chat],
      messages: [message],
    });
    api.line.react = async () => pendingReaction;

    const pending = reactToMessage(message.id, 3, false);
    useStore.getState().setAccountId("account-b");
    useStore.getState().setAccountId("account-a");
    useStore.setState({
      self: { ...before.self, mid: "self-a-new-session" },
      chats: [chat],
      messages: [{ ...message }],
    });
    resolveReaction({ ok: true });

    expect(await pending).toEqual({ ok: false });
    expect(useStore.getState().messages[0]?.reactions ?? []).toHaveLength(0);
  } finally {
    api.line.react = originalReact;
    useStore.setState(before, true);
  }
});
