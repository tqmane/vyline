import { afterAll, beforeEach, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageBubble } from "../components/message-bubble";
import { useStore, type Chat, type Message } from "./store";
import { useDesignSystemStore, type DesignSystem } from "../ui/design-system-store";

const accountId = "streamer-cards-fixture";
const chatId = `c${"1".repeat(32)}`;
const authorId = `u${"2".repeat(32)}`;
const chat: Chat = {
  id: chatId, type: "group", name: "Card Group", avatar: "G", color: "blue", status: "", unread: 0,
  members: [{ id: authorId, name: "Card Author", avatar: "A", color: "blue" }],
};
const savedStore = useStore.getState();
const initialStore = useStore.getInitialState();
const savedInitialStore = { ...initialStore };
const savedDesign = useDesignSystemStore.getState();
const initialDesign = useDesignSystemStore.getInitialState();
const savedInitialDesign = { ...initialDesign };
const fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network forbidden in card SSR tests"));

beforeEach(() => fetchSpy.mockClear());
afterAll(() => {
  Object.assign(initialStore, savedInitialStore);
  Object.assign(initialDesign, savedInitialDesign);
  useStore.setState(savedStore, true);
  useDesignSystemStore.setState(savedDesign, true);
  fetchSpy.mockRestore();
});

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function message(kind: Message["kind"], authorId: string): Message {
  return { id: `card-${kind}`, chatId, authorId, kind, createdAt: 1_700_000_000_000, status: "sent", read: false, messageState: "normal" };
}

function render(mode: DesignSystem, flags: number, source: Message, quoted?: Message, enabled = true) {
  const settings = { ...savedStore.settings, streamerMode: enabled, streamerMaskNames: Boolean(flags & 1), streamerMaskAvatars: Boolean(flags & 2), streamerMaskUrls: Boolean(flags & 4), requestUrlPreviews: false, betaAgentI: false };
  const patch = { accountId, demoMode: false, chats: [chat], messages: quoted ? [quoted, source] : [source], settings, readersPanel: null };
  // React SSR uses Zustand's initial snapshot; configure and restore both public snapshots.
  Object.assign(initialStore, patch);
  useStore.setState(patch);
  Object.assign(initialDesign, { mode });
  useDesignSystemStore.setState({ mode });
  const original = JSON.stringify({ source, quoted, chat });
  const markup = renderToStaticMarkup(<MessageBubble message={source} chat={chat} showAvatar={false} showName={false} />);
  expect(JSON.stringify({ source, quoted, chat })).toBe(original);
  expect(fetchSpy).not.toHaveBeenCalled();
  return markup;
}

for (const mode of ["legacy", "nezu", "apple", "fluent", "miuix"] as const) {
  test(`${mode}: shared contact name and avatar masks are independent in both directions`, () => {
    for (let flags = 0; flags < 8; flags++) for (const author of [authorId, "me"]) {
      const source = freeze({ ...message("contact", author), contact: { mid: authorId, name: "PrivateCardContact", thumbnailUrl: "/streamer-cards-contact-avatar.svg" } });
      const markup = render(mode, flags, source);
      expect(markup.includes("PrivateCardContact")).toBe(!(flags & 1));
      expect(markup.includes("streamer-cards-contact-avatar.svg")).toBe(!(flags & 2));
    }
  });

  test(`${mode}: location text URLs and map links follow URL masking alone`, () => {
    for (let flags = 0; flags < 8; flags++) for (const author of [authorId, "me"]) {
      const source = freeze({ ...message("location", author), location: { title: "Meeting www.location-card.example/title", address: "Street https://address-card.example/123", latitude: 35.123, longitude: 139.456 } });
      const markup = render(mode, flags, source);
      expect(markup).toContain("Meeting");
      expect(markup).toContain("Street");
      expect(markup.includes("location-card.example")).toBe(!(flags & 4));
      expect(markup.includes("address-card.example")).toBe(!(flags & 4));
      expect(markup.includes('href="https://www.google.com/maps/')).toBe(!(flags & 4));
      if (flags & 4) expect(markup).not.toContain("maps.googleapis.com");
    }
  });

  test(`${mode}: file label and download filename mask www URLs without mutating metadata`, () => {
    for (let flags = 0; flags < 8; flags++) for (const author of [authorId, "me"]) {
      const source = freeze({ ...message("file", author), file: { name: "report www.file-card.example/private.txt", size: 2048 } });
      const markup = render(mode, flags, source);
      expect(markup).toContain("report ");
      expect(markup.includes("file-card.example")).toBe(!(flags & 4));
      const download = markup.match(/download="([^"]*)"/);
      expect(download).not.toBeNull();
      expect(download![1]!.includes("file-card.example")).toBe(!(flags & 4));
    }
  });

  for (const revoked of [false, true]) test(`${mode}: ${revoked ? "revoked " : ""}reply quote masks original mention ranges before cleanup and URL replacement`, () => {
    const text = "prefix $ https://quote-card.example/a before @QuotedCardPerson suffix www.tail-card.example/file";
    const normal = { ...message("text", authorId), id: "quoted-card", text, mentions: [{ mid: authorId, S: text.indexOf("@Quoted"), E: text.indexOf("@Quoted") + "@QuotedCardPerson".length }] } satisfies Message;
    const quoted = freeze(revoked ? { ...normal, messageState: "revoked-by-other" as const, revokedSnapshot: { ...normal } } : normal);
    for (let flags = 0; flags < 8; flags++) for (const author of [authorId, "me"]) {
      const source = freeze({ ...message("text", author), id: "reply-card", text: "Reply body", replyToId: quoted.id });
      const markup = render(mode, flags, source, quoted);
      expect(markup).toContain("Reply body");
      expect(markup.includes("QuotedCardPerson")).toBe(!(flags & 1));
      expect(markup.includes("quote-card.example")).toBe(!(flags & 4));
      expect(markup.includes("tail-card.example")).toBe(!(flags & 4));
      if (flags & 1) expect(markup).toContain("@メンバー");
      if (revoked) expect(markup).toContain("取り消し済み:");
    }
  });

  test(`${mode}: disabled streamer mode preserves cards even when all three stored flags are enabled`, () => {
    const source = freeze({ ...message("contact", authorId), contact: { name: "PrivateCardContact", thumbnailUrl: "/streamer-cards-contact-avatar.svg" } });
    const markup = render(mode, 7, source, undefined, false);
    expect(markup).toContain("PrivateCardContact");
    expect(markup).toContain("streamer-cards-contact-avatar.svg");
  });
}
