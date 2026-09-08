import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageBubble } from "./message-bubble";
import type { Chat, Message } from "@/lib/store-types";

const chat: Chat = {
  id: "chat",
  type: "friend",
  name: "友だち",
  avatar: "友",
  color: "#007aff",
  status: "",
  unread: 0,
};
const original: Message = {
  id: "saved",
  chatId: chat.id,
  authorId: "friend",
  kind: "text",
  text: "保存された本文",
  createdAt: 100,
  status: "sent",
  read: false,
  messageState: "normal",
};
const render = (message: Message) =>
  renderToStaticMarkup(
    <MessageBubble message={message} chat={chat} showAvatar={false} showName={false} />,
  );
const revoked = (snapshot?: Message): Message => ({
  ...original,
  kind: "system",
  text: "取り消されたメッセージ",
  messageState: "revoked-by-other",
  revokedSnapshot: snapshot,
});

test("unsent text and attachments show saved content before the cancellation notice", () => {
  for (const [snapshot, expected] of [
    [original, "保存された本文"],
    [{ ...original, kind: "image", imageSrc: "/saved-image" }, "/saved-image"],
    [{ ...original, kind: "video", imageSrc: "/saved-video?preview=1" }, "/saved-video?preview=0"],
    [{ ...original, kind: "audio", audioSrc: "/saved-audio", audioSeconds: 5 }, "/saved-audio"],
    [{ ...original, kind: "sticker", sticker: "/saved-sticker.png" }, "/saved-sticker.png"],
    [{ ...original, kind: "file", file: { name: "保存.pdf", size: 45 } }, "保存.pdf"],
    [{ ...original, kind: "contact", contact: { name: "保存した連絡先" } }, "保存した連絡先"],
    [{ ...original, kind: "location", location: { title: "保存した場所" } }, "保存した場所"],
  ] as const) {
    const html = render(revoked(snapshot));
    expect(html).toContain(expected);
    expect(html.indexOf(expected)).toBeLessThan(html.indexOf("送信が取り消されました"));
  }
  expect(render(revoked())).toContain("元のメッセージは保存されていません");
  const own = render({
    ...revoked({ ...original, authorId: "me" }),
    authorId: "me",
    messageState: "revoked-by-self",
  });
  expect(own).toContain(original.text!);
  expect(own).toContain("あなたが送信を取り消しました");
});

test("normal and edited history plus a locally restored snapshot do not imply cancellation", () => {
  for (const message of [
    {
      ...original,
      history: [{ state: "normal", text: "編集前", contentType: "TEXT", updatedTime: 10 }],
    },
    { ...original, revokedSnapshot: original },
  ] as Message[]) {
    const html = render(message);
    expect(html).toContain(original.text!);
    expect(html).not.toContain("送信が取り消されました");
  }
});
