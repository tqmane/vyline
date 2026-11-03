import { expect, test } from "bun:test";
import { isUserMid, maskSocialUrls, mergeCommonGroups } from "./socialPresentation";
import { privacyPresentation } from "./settingsPreferences";
import { assertNoteResponse, noteView } from "./notePresentation";
import type { Chat } from "./store-types";

const id = `c${"a".repeat(32)}`;
const second = `c${"b".repeat(32)}`;
const group = (mid: string, name = "Local"): Chat => ({ id: mid, type: "group", name, avatar: "L", color: "red", status: "", unread: 0 });

test("MID accepts only user IDs; URL masks and avatar/name masks remain independent", () => {
  expect(isUserMid(`u${"a".repeat(32)}`)).toBe(true);
  for (const value of [id, "u123", `u${"z".repeat(32)}`, `u${"a".repeat(32)}\n`]) expect(isUserMid(value)).toBe(false);
  const privacy = privacyPresentation({ streamerMode: true, streamerMaskNames: false });
  expect(privacy).toMatchObject({ names: false, avatars: true, urls: true });
  expect(maskSocialUrls("Alice https://example.test/private?q=1", privacy.urls)).toBe("Alice [URL]");
});

test("empty remote groups retain local membership, left/excluded groups stay hidden, fresh names win", () => {
  const local = [group(id)];
  expect(mergeCommonGroups(local, [], local).map(item => item.id)).toEqual([id]);
  const left = { ...group(second), left: true };
  const merged = mergeCommonGroups(local, [{ chatMid: id, name: "New" }, { chatMid: second, name: "Left" }], [...local, left]);
  expect(merged.map(item => item.name)).toEqual(["New"]);
  expect(mergeCommonGroups(local, [], local, id)).toEqual([]);
});

test("notes unwrap real postInfo IDs and preserve multiline/sticon/multiple attachments/comments", () => {
  const view = noteView({ result: { post: { postInfo: { postId: "post1", writerMid: "self", likeCount: 2 }, contents: {
    text: "first\n$second", sticonMetas: [{ productId: "pack", sticonId: "001", S: 6, E: 7 }],
    stickers: [{ id: "1", packageId: "2" }, { id: "3", packageId: "4" }],
    media: [{ objectId: "a/b", type: "PHOTO" }, { objectId: "v", type: "VIDEO" }],
  } }, comments: [{ id: "c", writer: { displayName: "Alice" }, text: "comment\nline2" }] } }, "self");
  expect(view.id).toBe("post1"); expect(view.text).toBe("first\n$second");
  expect(view.sticons[0]).toMatchObject({ productId: "pack", sticonId: "001", S: 6, E: 7 });
  expect(view.media.map(item => item.type)).toEqual(["PHOTO", "VIDEO"]);
  expect(decodeURIComponent(view.media[0]!.url)).toContain("a%2Fb");
  expect(view.stickers).toHaveLength(2); expect(view.comments[0]?.text).toBe("comment\nline2");
  expect(view.canEdit).toBe(true); expect(view.reactionCount).toBe(2);
});

test("unknown/denied/other-user note permissions remain read-only; malformed input stays empty", () => {
  expect(noteView({ contents: { text: "safe" } }).canDelete).toBe(false);
  expect(noteView({ postInfo: { writerMid: "other" } }, "self").canEdit).toBe(false);
  expect(noteView({ postInfo: { writerMid: "self", editable: false } }, "self").canEdit).toBe(false);
  expect(noteView({ postInfo: { editable: false, permissions: { canEdit: true } } }, "self").canEdit).toBe(false);
  expect(noteView({ contents: { postId: "legacy-id", text: "legacy" } }).id).toBe("legacy-id");
  expect(() => assertNoteResponse({ ok: false, error: "no permission" })).toThrow("no permission");
  expect(noteView(null).media).toEqual([]);
  expect(noteView({ contents: { media: [null, 1, "bad"], sticonMetas: [{}] } }).sticons).toEqual([]);
});
