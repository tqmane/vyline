import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import * as manager from "../line/clientManager.js";
import * as cache from "../storage/vylineCache.js";
import * as tokens from "../storage/tokenStore.js";
import { AuthService } from "../auth/mod.js";
import { fetchContactProfile, fetchProfile } from "./lineService.js";

const turn = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() { return Promise.withResolvers<T>(); }
type Client = NonNullable<ReturnType<typeof manager.getClient>>;
let current: Client;
let restore: (() => void)[];
let stored: string[];
function client(mid: string, name: string, active = false): Client {
  return { base: { profile: { mid, displayName: name },
    talk: { getProfile: async () => ({ mid, displayName: name }), getExtendedProfile: async () => ({}),
      getContactsV2: async () => ({}), getContact: async () => null },
    relation: { getContactsV3: async () => ({ responses: [] }), getTargetProfiles: async () => ({ responses: [] }) },
    request: { request: async () => ({ active }) },
  }, voom: { call: async () => ({ result: { coverObsInfo: { objectId: `${name}-cover`, obsNamespace: "c" } } }) } } as unknown as Client;
}
beforeEach(() => {
  stored = [];
  const spies = [spyOn(manager, "getClient").mockImplementation(() => current),
    spyOn(AuthService, "tryRefreshToken").mockResolvedValue(),
    spyOn(cache, "vylineGetProfile").mockResolvedValue(null),
    spyOn(cache, "vylinePutProfile").mockImplementation(async (_account, value) => { stored.push(value.mid); }),
    spyOn(tokens, "updateSessionMeta").mockResolvedValue(),
  ];
  restore = spies.map(spy => () => spy.mockRestore());
});
afterEach(async () => { await turn(); for (const undo of restore) undo(); });

test("self profile, cover and premium caches belong to the active client rather than its alias", async () => {
  const account = "profile-session-ttl";
  current = client("u-old", "Alice", true);
  expect((await fetchProfile(account)).displayName).toBe("Alice");
  await turn();
  current = client("u-new", "Bob", false);
  const next = await fetchProfile(account);
  expect(next.mid).toBe("u-new");
  expect(next.displayName).toBe("Bob");
  expect(next.backgroundUrl).toContain("Bob-cover");
  await turn();
  expect((await fetchProfile(account)).premium?.active).toBe(false);
});

test("a retired foreground profile cannot return or persist its response after client replacement", async () => {
  const result = deferred<{ mid: string; displayName: string }>();
  const entered = deferred<void>();
  const old = client("u-retired", "Retired");
  Reflect.deleteProperty(old.base, "profile");
  old.base.talk.getProfile = async () => { entered.resolve(); return await result.promise as never; };
  current = old;
  const pending = fetchProfile("profile-session-rpc").catch(error => error);
  await entered.promise;
  current = client("u-fresh", "Fresh");
  result.resolve({ mid: "u-retired", displayName: "Retired" });
  expect(await pending).toBeInstanceOf(Error);
  expect(stored).not.toContain("u-retired");
  expect((await fetchProfile("profile-session-rpc")).mid).toBe("u-fresh");
});

test("a retired background refresh cannot replace the new session's profile", async () => {
  const result = deferred<{ mid: string; displayName: string }>();
  const old = client("u-bg-old", "Old");
  old.base.talk.getProfile = async () => await result.promise as never;
  current = old;
  await fetchProfile("profile-session-bg");
  current = client("u-bg-new", "New");
  await fetchProfile("profile-session-bg");
  const afterSwitch = stored.length;
  result.resolve({ mid: "u-bg-retired", displayName: "Retired" });
  await turn();
  expect(stored.slice(afterSwitch)).not.toContain("u-bg-retired");
  expect((await fetchProfile("profile-session-bg")).mid).toBe("u-bg-new");
});

test("a replacement contact lookup does not join a retired client's inflight request", async () => {
  const peer = "u-common-peer";
  const result = deferred<{ responses: unknown[] }>();
  const entered = deferred<void>();
  const old = client("u-contact-old", "Old");
  old.base.relation.getContactsV3 = async () => { entered.resolve(); return await result.promise as never; };
  current = old;
  const previous = fetchContactProfile("profile-session-contact", peer).catch(error => error);
  await entered.promise;
  const fresh = client("u-contact-new", "New");
  fresh.base.relation.getContactsV3 = async () => ({ responses: [{ targetUserMid: peer,
    targetProfileDetail: { profileName: "New relationship name" } }] } as never);
  current = fresh;
  const next = fetchContactProfile("profile-session-contact", peer);
  await turn();
  result.resolve({ responses: [{ targetUserMid: peer, targetProfileDetail: { profileName: "Old relationship name" } }] });
  expect((await next)?.displayName).toBe("New relationship name");
  await previous;
});
