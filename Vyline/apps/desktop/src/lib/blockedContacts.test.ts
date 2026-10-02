import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { api, type LineProfile } from "../api/client.js";
import { loadBlockedContacts, setMemberBlocked, unblockBlockedMid } from "./blockedContacts.js";
import { useStore } from "./store.js";

// The privacy panel and the member profile both mutate the block list. Neither
// may apply a result that arrives after the user switched accounts.

const MID = "u-blocked-fixture";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  useStore.setState({ accountId: null, blockedMids: [], chats: [], messages: [] });
});

afterEach(() => {
  useStore.setState({ accountId: null, blockedMids: [] });
});

describe("blocked contacts account isolation", () => {
  it("reports no list when the account changed while profiles were resolving", async () => {
    const blocked = deferred<{ ok: boolean; mids: string[] }>();
    const contactProfile = deferred<{ ok: boolean; profile?: LineProfile }>();
    const listSpy = spyOn(api.line, "blockedContacts").mockReturnValue(blocked.promise as never);
    const profileSpy = spyOn(api.line, "contactProfile").mockReturnValue(
      contactProfile.promise as never,
    );
    try {
      useStore.setState({ accountId: "account-a", blockedMids: [MID] });
      const pending = loadBlockedContacts("account-a");
      blocked.resolve({ ok: true, mids: [MID] });
      await Promise.resolve();
      await Promise.resolve();
      expect(profileSpy).toHaveBeenCalledWith("account-a", MID);

      useStore.getState().setAccountId("account-b");
      contactProfile.resolve({
        ok: true,
        profile: { displayName: "A's Friend" } as LineProfile,
      });

      expect(await pending).toBeNull();
    } finally {
      listSpy.mockRestore();
      profileSpy.mockRestore();
    }
  });

  it("still returns the list when the account is unchanged", async () => {
    const listSpy = spyOn(api.line, "blockedContacts").mockResolvedValue({ ok: true, mids: [MID] });
    const profileSpy = spyOn(api.line, "contactProfile").mockResolvedValue({
      ok: true,
      profile: {
        displayName: "Friend",
        thumbnailUrl: "https://cdn.example/a.jpg",
      } as LineProfile,
    });
    try {
      useStore.setState({ accountId: "account-a", blockedMids: [MID] });
      expect(await loadBlockedContacts("account-a")).toEqual([
        { mid: MID, name: "Friend", avatarUrl: "https://cdn.example/a.jpg" },
      ]);
    } finally {
      listSpy.mockRestore();
      profileSpy.mockRestore();
    }
  });

  it("does not unblock a contact in the account that became active", async () => {
    const gate = deferred<{ ok: boolean }>();
    const unblock = spyOn(api.line, "unblockContact").mockReturnValue(gate.promise as never);
    try {
      useStore.setState({ accountId: "account-a", blockedMids: [MID] });
      const pending = unblockBlockedMid("account-a", MID);
      useStore.getState().setAccountId("account-b");
      useStore.setState({ accountId: "account-b", blockedMids: [MID] });
      gate.resolve({ ok: true });

      expect(await pending).toEqual({ ok: false });
      expect(useStore.getState().blockedMids).toEqual([MID]);
    } finally {
      unblock.mockRestore();
    }
  });

  it("does not block a group member in the account that became active", async () => {
    const gate = deferred<{ ok: boolean }>();
    const block = spyOn(api.line, "blockContact").mockReturnValue(gate.promise as never);
    try {
      useStore.setState({ accountId: "account-a", blockedMids: [] });
      const pending = setMemberBlocked("account-a", MID, true);
      useStore.getState().setAccountId("account-b");
      gate.resolve({ ok: true });

      expect(await pending).toEqual({ ok: false });
      expect(useStore.getState().blockedMids).toEqual([]);
    } finally {
      block.mockRestore();
    }
  });

  it("applies the block list change while the account is unchanged", async () => {
    const block = spyOn(api.line, "blockContact").mockResolvedValue({ ok: true });
    const unblock = spyOn(api.line, "unblockContact").mockResolvedValue({ ok: true });
    try {
      useStore.setState({ accountId: "account-a", blockedMids: [] });
      expect(await setMemberBlocked("account-a", MID, true)).toEqual({ ok: true });
      expect(useStore.getState().blockedMids).toEqual([MID]);

      expect(await setMemberBlocked("account-a", MID, false)).toEqual({ ok: true });
      expect(useStore.getState().blockedMids).toEqual([]);
    } finally {
      block.mockRestore();
      unblock.mockRestore();
    }
  });

  it("keeps the block list unchanged when LINE rejects the request", async () => {
    const block = spyOn(api.line, "blockContact").mockResolvedValue({
      ok: false,
      error: "ブロックに失敗しました",
    });
    try {
      useStore.setState({ accountId: "account-a", blockedMids: [] });
      expect(await setMemberBlocked("account-a", MID, true)).toEqual({
        ok: false,
        error: "ブロックに失敗しました",
      });
      expect(useStore.getState().blockedMids).toEqual([]);
    } finally {
      block.mockRestore();
    }
  });
});
