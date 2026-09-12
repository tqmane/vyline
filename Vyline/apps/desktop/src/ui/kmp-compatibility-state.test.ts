import { expect, test } from "bun:test";
import type { Chat } from "@/lib/store";
import { compatibilityRequestExpired, resolveMemberProfileChat } from "./kmp-compatibility-state";

const context = {
  accountId: "account-a",
  activeChatId: "chat-a",
  chatExists: true,
  messageExists: true,
  memberExists: true,
  profileOpen: true,
};

test("chat-scoped compatibility surfaces retire when their target chat is no longer active", () => {
  for (const kind of ["stickers", "message-actions", "message", "profile", "member-profile", "chat-tools"]) {
    expect(
      compatibilityRequestExpired(
        { kind, accountId: "account-a", chatId: "chat-a" },
        { ...context, activeChatId: "chat-b" },
      ),
    ).toBeTrue();
  }
  expect(
    compatibilityRequestExpired(
      { kind: "settings", accountId: "account-a" },
      { ...context, activeChatId: "chat-b" },
    ),
  ).toBeFalse();
});

test("message/profile surfaces retire when their backing model disappears", () => {
  expect(
    compatibilityRequestExpired(
      { kind: "message", accountId: "account-a", chatId: "chat-a" },
      { ...context, messageExists: false },
    ),
  ).toBeTrue();
  expect(
    compatibilityRequestExpired(
      { kind: "profile", accountId: "account-a", chatId: "chat-a" },
      { ...context, profileOpen: false },
    ),
  ).toBeTrue();
  expect(
    compatibilityRequestExpired(
      { kind: "member-profile", accountId: "account-a", chatId: "chat-a" },
      { ...context, memberExists: false },
    ),
  ).toBeTrue();
});

test("member profiles prefer the richer direct-contact record over the group cache", () => {
  const group = {
    id: "group",
    type: "group",
    name: "Group",
    avatar: "G",
    color: "#000",
    status: "",
    unread: 0,
    members: [{ id: "member", name: "Cached", avatar: "C", color: "#111", avatarUrl: "cached.jpg" }],
  } as Chat;
  const direct = {
    id: "member",
    type: "friend",
    name: "Fresh",
    avatar: "F",
    color: "#222",
    avatarUrl: "fresh.jpg",
    status: "fresh status",
    unread: 0,
  } as Chat;

  expect(resolveMemberProfileChat(group, "member", direct)).toBe(direct);
  expect(resolveMemberProfileChat(group, "member", undefined)?.avatarUrl).toBe("cached.jpg");
  expect(resolveMemberProfileChat({ ...group, members: [] }, "member", direct)).toBeNull();
});
