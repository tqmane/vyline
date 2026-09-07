import { describe, expect, it } from "bun:test";
import { mapMessage } from "./mappers.js";

describe("mapMessage group-call notifications", () => {
  const groupMid = "c0123456789abcdef0123456789abcdef";

  for (const { mediaType, event, duration, outcome, video } of [
    { mediaType: "AUDIO", event: "S", duration: "0", outcome: "started", video: false },
    { mediaType: "AUDIO", event: "E", duration: "179301", outcome: "ended", video: false },
    { mediaType: "VIDEO", event: "S", duration: "0", outcome: "started", video: true },
    { mediaType: "VIDEO", event: "E", duration: "179301", outcome: "ended", video: true },
    { mediaType: "AUDIO", event: "unrecognized", duration: "0", outcome: "unknown", video: false },
  ]) {
    it(`maps ${mediaType} ${event} to a group call ${outcome} notification`, () => {
      const mapped = mapMessage(
        {
          id: "group-call-notification-1",
          from: "u0123456789abcdef0123456789abcdef",
          to: groupMid,
          text: null,
          contentType: "CALL",
          createdTime: 1_756_800_000_000,
          isMyMessage: false,
          contentMetadata: {
            GC_EVT_TYPE: event,
            GC_CHAT_MID: groupMid,
            GC_MEDIA_TYPE: mediaType,
            TYPE: "G",
            RESULT: "INFO",
            DURATION: duration,
            CAUSE: "16",
          },
        },
        groupMid,
        "main",
      );

      expect(mapped).toMatchObject({
        kind: "call",
        callMeta: { group: true, video, outcome },
      });
    });
  }
});
