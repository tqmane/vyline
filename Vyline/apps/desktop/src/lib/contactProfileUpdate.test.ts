import { describe, expect, test } from "bun:test";
import type { Chat } from "./store-types";
import { updateContactProfile } from "./contactProfileUpdate";

describe("contact profile refresh", () => {
  const member = { id: "u-member", name: "古い名前", avatar: "古", avatarUrl: "/old.svg", color: "#123456" };
  const group: Chat = { id: "c-group", type: "group", name: "グループ", avatar: "G", color: "#123456", status: "", unread: 0, members: [member] };
  test("refreshes a non-friend group member without creating a direct chat", () => {
    const result = updateContactProfile([group], member.id, { displayName: "新しい名前", thumbnailUrl: "/new.svg" });
    expect(result).toHaveLength(1);
    expect(result[0]!.members![0]).toEqual({ ...member, name: "新しい名前", avatar: "新", avatarUrl: "/new.svg" });
    expect(group.members![0]).toBe(member);
  });
  test("retains local contact names, clears an empty status and updates shared group membership", () => {
    const contact: Chat = { ...group, id: member.id, type: "friend", members: undefined, localName: "自分用の呼び名", status: "以前の状態", statusMessage: "以前の状態" };
    const result = updateContactProfile([contact, group], member.id, { displayName: "最新の名前", statusMessage: "" });
    expect(result[0]).toMatchObject({ name: "最新の名前", localName: "自分用の呼び名", status: "", statusMessage: "" });
    expect(result[1]!.members![0]!.name).toBe("最新の名前");
  });
  test("does not resurrect a removed member or overwrite good names with a MID", () => {
    const empty = { ...group, members: [] };
    const result = updateContactProfile([empty, group], member.id, { displayName: `u${"a".repeat(32)}` });
    expect(result[0]).toBe(empty);
    expect(result[1]!.members![0]!.name).toBe(member.name);
    expect(result[1]!.members![0]!.avatarUrl).toBe(member.avatarUrl);
  });
});
