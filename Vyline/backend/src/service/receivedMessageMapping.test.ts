import { expect, test } from "bun:test";
import { mapDecodedRawToMessage, mappedReceivedMessage } from "./lineService";

// A received-message operation decrypts to the raw Thrift message, then has to be
// mapped before it reaches the store, the talk buffer or plugins. Publishing the
// decrypted object directly silently drops the mapped fields.

const SELF = "u-me";
const PEER = "u-peer";
const CHAT = `c${"1".repeat(32)}`;

const rawSticker = (meta: Record<string, string>) => ({
  id: "900",
  from: PEER,
  to: CHAT,
  text: null,
  contentType: "STICKER",
  createdTime: 1_700_000_000_000,
  contentMetadata: { e2eeVersion: "2", STKID: "5200", ...meta },
});

test("an E2EE sticker keeps its animation flag after decryption", () => {
  const raw = rawSticker({});
  // Letter Sealing merges the decrypted JSON into contentMetadata on the raw msg.
  const decrypted = {
    ...raw,
    text: "",
    contentMetadata: { ...raw.contentMetadata, STKOPT: "A" },
  };

  const published = mappedReceivedMessage(raw, SELF, decrypted);
  expect(published.contentType).toBe("STICKER");
  expect(published.stickerAnimated).toBe(true);
  // The raw object the decrypt returns has no such field at all.
  expect((decrypted as Record<string, unknown>).stickerAnimated).toBeUndefined();
});

test("a sticky sticker keeps its layout marker after decryption", () => {
  const raw = rawSticker({});
  const decrypted = { ...raw, text: "", contentMetadata: { ...raw.contentMetadata, STKSTICKER: "1" } };
  expect(mappedReceivedMessage(raw, SELF, decrypted).stickerSticky).toBe(true);
});

test("an undecryptable E2EE message is still reported as such", () => {
  // chunks present and no text => the message could not be decrypted.
  const raw = {
    id: "901",
    from: PEER,
    to: CHAT,
    text: null,
    contentType: "NONE",
    createdTime: 1_700_000_000_000,
    contentMetadata: { e2eeVersion: "2" },
    chunks: ["a", "b", "c", "d", "e"],
  };
  // The decrypt returns the raw message unchanged when it fails.
  const published = mappedReceivedMessage(raw, SELF, raw);
  expect(published.contentType).toBe("E2EE_UNAVAILABLE");
  expect(published.text).toBeNull();
});

test("a plain received message is unchanged", () => {
  const raw = {
    id: "902",
    from: PEER,
    to: CHAT,
    text: "hello",
    contentType: "NONE",
    createdTime: 1_700_000_000_000,
  };
  expect(mappedReceivedMessage(raw, SELF)).toEqual(mapDecodedRawToMessage(raw, SELF));
});
