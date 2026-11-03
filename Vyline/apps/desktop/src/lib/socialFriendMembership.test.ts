import { expect, test } from "bun:test";
import type { Chat as LineChat } from "@vyline/types";
import { mapChat } from "./mappers";
import { filterChatList } from "./chatListPresentation";
import type { Chat } from "./store-types";

const raw = (mid: string, isFriend?: boolean): LineChat => ({
  mid, name: mid, kind: "direct", hasMessages: true, lastMessageTime: 123,
  lastMessageId: "message-1", lastMessagePreview: "kept history", unreadCount: 2,
  ...(isFriend === undefined ? {} : { isFriend }),
});
const ui = (id: string, isFriend?: boolean): Chat => mapChat(raw(id, isFriend));
const list = (chats: Chat[], tab: "friend" | "all" | "official" = "friend") => filterChatList(chats, [], tab, "", "recent", []);

test("mapChat preserves true, false and unknown membership without changing direct history metadata", () => {
  for (const membership of [true, false, undefined]) {
    const mapped = mapChat(raw("u-peer", membership));
    expect(mapped.isFriend).toBe(membership);
    expect(mapped.type).toBe("friend");
    expect(mapped.lastMessagePreview).toBe("kept history");
    expect(mapped.lastMessageId).toBe("message-1");
    expect(mapped.unread).toBe(2);
  }
});

test("friend tab includes confirmed friends only; nonfriends, unknown, Keep and officials stay out", () => {
  const chats = [ui("friend", true), ui("nonfriend", false), ui("unknown"),
    { ...ui("self", true), isSelf: true }, { ...ui("official", true), isOfficial: true },
    { ...ui("hidden", true), hidden: true }, { ...ui("left", true), left: true },
    { ...ui("group", true), type: "group" as const }];
  expect(list(chats).map(chat => chat.id)).toEqual(["friend"]);
  expect(new Set(list(chats, "all").map(chat => chat.id))).toEqual(new Set(["friend", "nonfriend", "unknown", "self", "official", "group"]));
  expect(list(chats, "official").map(chat => chat.id)).toEqual(["official"]);
  expect(chats[1]?.lastMessagePreview).toBe("kept history");
});

test("a successful deletion removes only friend-tab membership; re-add restores it", () => {
  const original = ui("peer", true);
  const deleted = { ...original, isFriend: false };
  expect(list([deleted])).toEqual([]);
  expect(list([deleted], "all")[0]).toBe(deleted);
  expect(list([{ ...deleted, isFriend: true }])[0]?.id).toBe("peer");
});

test("legacy/bootstrap rows do not invent confirmed friendship", () => {
  const legacy = mapChat(raw("legacy"));
  expect(list([legacy])).toEqual([]);
  expect(list([legacy], "all")).toEqual([legacy]);
});
