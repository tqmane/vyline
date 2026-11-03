import { createRoot } from "react-dom/client";
import { MessageBubble } from "../src/components/message-bubble";
import { useStore, type Chat, type Message } from "../src/lib/store";

const chat: Chat = { id: "fixture-flex", type: "friend", name: "Fixture", avatar: "F", color: "blue", unread: 0, status: "" };
const image = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="330"><rect width="300" height="330" fill="#c99c12"/><text x="20" y="80" fill="white" font-size="24">Image-only card</text></svg>')}`;
const bubble = { type: "bubble" as const, hero: { type: "image", url: image, size: "full", aspectRatio: "10:11", aspectMode: "cover" } };
const base: Message = { id: "1", chatId: chat.id, authorId: "peer", kind: "flex", createdAt: Date.now(), status: "sent", read: false, messageState: "normal" };
const messages: Message[] = [
  { ...base, flexJson: bubble, altText: "single image" },
  { ...base, id: "2", flexJson: { type: "carousel", contents: [bubble, bubble] }, altText: "image carousel" },
  { ...base, id: "3", flexJson: { type: "carousel", contents: [] }, altText: "Empty carousel fallback" },
  { ...base, id: "4", flexJson: { type: "carousel", contents: [{ hero: bubble.hero }] }, altText: "Implicit bubble type" },
];
useStore.setState({ demoMode: true, accountId: null, activeChatId: chat.id, chats: [chat], messages });
createRoot(document.getElementById("root")!).render(<main style={{ width: "100%", padding: 16 }}>
  {messages.map(message => <section key={message.id} data-case={message.id} style={{ width: "100%", marginBottom: 32 }}>
    <MessageBubble message={message} chat={chat} showAvatar={false} showName={false} />
  </section>)}
</main>);
