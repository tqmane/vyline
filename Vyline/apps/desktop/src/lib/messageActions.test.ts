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
  } finally {
    useStore.setState(before, true);
  }
});
