import { expect, test } from "bun:test";
import {
  dismissNativeMenu,
  getNativeMenuSnapshot,
  invokeNativeMenu,
  publishNativeMenu,
  setNativeMenuAvailable,
  unpublishNativeMenu,
} from "./native-menu";

test("native menus reject stale, duplicate, wrong-account and unavailable actions", () => {
  const firstOwner = Symbol("first menu");
  const secondOwner = Symbol("replacement menu");
  let accountId: string | null = "account-a";
  let invoked = 0;
  let closed = 0;
  const source = {
    x: 24,
    y: 48,
    accountId,
    getAccountId: () => accountId,
    onClose: () => {
      closed++;
    },
    items: [
      {
        label: "Reactions",
        children: [
          {
            label: "Remove",
            danger: true,
            onClick: () => {
              invoked++;
            },
          },
        ],
      },
    ],
  };
  try {
    setNativeMenuAvailable(true);
    publishNativeMenu(firstOwner, source);
    const first = getNativeMenuSnapshot()!;
    const firstItem = first.items[0]!.children[0]!;
    expect(JSON.parse(JSON.stringify(first))).toEqual({
      id: first.id,
      x: 24,
      y: 48,
      items: [
        {
          id: first.items[0]!.id,
          label: "Reactions",
          danger: false,
          children: [{ id: firstItem.id, label: "Remove", danger: true, children: [] }],
        },
      ],
    });
    expect(invokeNativeMenu(first.items[0]!.id)).toBe(false);
    expect(invokeNativeMenu("unknown")).toBe(false);

    publishNativeMenu(secondOwner, source);
    const replacement = getNativeMenuSnapshot()!;
    const replacementId = replacement.items[0]!.children[0]!.id;
    expect(closed).toBe(1);
    unpublishNativeMenu(firstOwner);
    expect(getNativeMenuSnapshot()).toBe(replacement);
    expect(invokeNativeMenu(firstItem.id)).toBe(false);
    expect(dismissNativeMenu(first.id)).toBe(false);
    expect(invokeNativeMenu(replacementId)).toBe(true);
    expect(invokeNativeMenu(replacementId)).toBe(false);
    expect(invoked).toBe(1);
    expect(closed).toBe(2);

    publishNativeMenu(firstOwner, source);
    const accountBoundId = getNativeMenuSnapshot()!.items[0]!.children[0]!.id;
    accountId = "account-b";
    expect(getNativeMenuSnapshot()).toBeNull();
    expect(invokeNativeMenu(accountBoundId)).toBe(false);
    expect(invoked).toBe(1);
    expect(getNativeMenuSnapshot()).toBeNull();
    publishNativeMenu(firstOwner, source);
    expect(getNativeMenuSnapshot()).toBeNull();

    accountId = "account-a";
    publishNativeMenu(firstOwner, source);
    const unavailableId = getNativeMenuSnapshot()!.items[0]!.children[0]!.id;
    const closedBeforeFallback = closed;
    setNativeMenuAvailable(false);
    expect(getNativeMenuSnapshot()).toBeNull();
    expect(invokeNativeMenu(unavailableId)).toBe(false);
    expect(closed).toBe(closedBeforeFallback);
    publishNativeMenu(secondOwner, source);
    expect(getNativeMenuSnapshot()).toBeNull();
  } finally {
    setNativeMenuAvailable(false);
  }
});

test("message context travels only as presentation data with the original actions", () => {
  const owner = Symbol("message-preview");
  const message = { id: "message-1", text: "選択した本文", kind: "text", mine: false };
  let replies = 0;
  try {
    setNativeMenuAvailable(true);
    publishNativeMenu(owner, { x: 10, y: 20, message, items: [{ label: "リプライ", onClick: () => replies++ }], accountId: null, getAccountId: () => null, onClose: () => {} });
    const snapshot = getNativeMenuSnapshot()!;
    expect(snapshot.message).toEqual(message);
    expect(invokeNativeMenu(snapshot.items[0]!.id)).toBe(true);
    expect(replies).toBe(1);
  } finally { unpublishNativeMenu(owner); setNativeMenuAvailable(false); }
});
