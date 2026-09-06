import { expect, spyOn, test } from "bun:test";
import * as sessionFactory from "./sessionFactory.js";
import { encodeCallVideoFrame } from "@vyline/types";
import {
  callWebSocketHandler,
  endManagedCall,
  listAccountCalls,
  startManagedCall,
  startManagedIncomingCall,
  getCallSnapshot,
  type CallWsData,
} from "./callManager.js";

test("group participants reach snapshots and state notifications without exposing media source IDs", async () => {
  let changed = () => {};
  const members = [
    {
      mid: `u${"1".repeat(32)}`,
      connected: true,
      mediaFlags: 1,
      sources: [{ name: "A", ssrc: 123 }],
    },
  ];
  const session = {
    state: "connecting",
    participants: members,
    on(event: string, listener: () => void) {
      if (event === "participants") changed = listener;
    },
    async start() {},
    async end() {
      this.state = "ended";
    },
  };
  const create = spyOn(sessionFactory, "createGroupCallSession").mockResolvedValue({
    session,
    transportKind: "planet",
    wire: { deviceDetails: { device: "IOSIPAD" } },
  } as never);
  const accountId = "group-roster-test";
  const created = await startManagedCall({
    accountId,
    client: {} as never,
    to: `c${"1".repeat(32)}`,
  });
  const sent: string[] = [];
  const ws = {
    data: { accountId, sessionId: created.sessionId },
    send(message: string) {
      sent.push(message);
    },
    close() {},
  } as never;
  try {
    const expected = [{ mid: members[0]!.mid, hasAudioStream: true, hasVideoStream: false }];
    expect(getCallSnapshot(created.sessionId)?.participants).toEqual(expected);
    callWebSocketHandler.open(ws);
    expect(JSON.parse(sent.at(-1)!).participants).toEqual(expected);
    session.participants = [];
    changed();
    expect(JSON.parse(sent.at(-1)!).participants).toEqual([]);
    expect(sent.join("")).not.toContain("ssrc");
  } finally {
    create.mockRestore();
    await endManagedCall(created.sessionId);
  }
});

test("group calls select the group factory and reserve their account during route lookup", async () => {
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const session = {
    state: "connecting",
    on() {},
    async start() {},
    async end() {
      this.state = "ended";
    },
  };
  let createdCount = 0;
  const create = spyOn(sessionFactory, "createGroupCallSession").mockImplementation(async () => {
    createdCount++;
    await gate;
    return {
      session,
      transportKind: "planet",
      wire: { deviceDetails: { device: "IOSIPAD" } },
    } as never;
  });
  const opts = {
    accountId: "group-call-reservation",
    client: {} as never,
    to: "c932e3b8ae8bf6b0fc19b512c40cda944",
  };
  const pending = startManagedCall(opts);
  let sessionId: string | undefined;
  try {
    await expect(startManagedCall(opts)).rejects.toThrow("通話");
    await expect(
      startManagedIncomingCall({
        accountId: opts.accountId,
        client: {} as never,
        callerMid: "u-peer",
        callId: "test",
        route: {} as never,
      }),
    ).rejects.toThrow("通話");
    finish();
    sessionId = (await pending).sessionId;
    expect(createdCount).toBe(1);
    expect(listAccountCalls(opts.accountId)).toHaveLength(1);
  } finally {
    finish();
    await pending.catch(() => undefined);
    create.mockRestore();
    if (sessionId) await endManagedCall(sessionId);
  }
});

test("closing the last call WebSocket ends the orphaned session", async () => {
  let endCalls = 0;
  const session = {
    state: "connecting",
    on() {},
    async start() {},
    async end() {
      endCalls++;
      this.state = "ended";
    },
  };
  const create = spyOn(sessionFactory, "createDirectCallSession").mockResolvedValue({
    session,
    transportKind: "planet",
    wire: { deviceDetails: { device: "IOSIPAD" } },
  } as never);
  const accountId = "call-ws-disconnect-test";
  const created = await startManagedCall({ accountId, client: {} as never, to: "u-peer" });
  const ws = {
    data: { accountId, sessionId: created.sessionId } satisfies CallWsData,
    send() {},
    close() {},
  } as never;

  try {
    callWebSocketHandler.close(ws);
    await Bun.sleep(0);
    expect(endCalls).toBe(0);

    callWebSocketHandler.open(ws);
    callWebSocketHandler.close(ws);
    await Promise.all([endManagedCall(created.sessionId), endManagedCall(created.sessionId)]);

    expect(endCalls).toBe(1);
    expect(listAccountCalls(accountId)).toHaveLength(0);
  } finally {
    create.mockRestore();
    await endManagedCall(created.sessionId);
  }
});

test("video WebSocket is account-bound and closing camera leaves audio alive", async () => {
  let endCalls = 0;
  const controls: boolean[] = [];
  const frames: Uint8Array[] = [];
  const session = {
    state: "connecting",
    videoState: { available: true, localEnabled: false, remoteEnabled: false },
    on() {},
    async start() {},
    async end() {
      endCalls++;
      this.state = "ended";
    },
    async setVideoEnabled(enabled: boolean) {
      controls.push(enabled);
      this.videoState.localEnabled = enabled;
    },
    async sendVideo(frame: { data: Uint8Array }) {
      frames.push(frame.data);
    },
  };
  const create = spyOn(sessionFactory, "createDirectCallSession").mockResolvedValue({
    session,
    transportKind: "planet",
    wire: { deviceDetails: { device: "IOSIPAD" } },
  } as never);
  const accountId = "video-ws-test";
  const created = await startManagedCall({ accountId, client: {} as never, to: "u-peer" });
  await Bun.sleep(0);
  session.state = "in-call";
  const audio = {
    data: { accountId, sessionId: created.sessionId },
    send() {},
    close() {},
  } as never;
  const video = {
    data: { accountId, sessionId: created.sessionId, media: "video" },
    send() {},
    close() {},
  } as never;
  const wrong = {
    data: { accountId: "another", sessionId: created.sessionId, media: "video" },
    send() {},
    close() {},
  } as never;
  const data = new Uint8Array([0x30, 0, 0, 0x9d, 1, 0x2a, 0x80, 2, 0x68, 1, 0, 0]);
  const frame = Buffer.from(encodeCallVideoFrame({ data, key: true, timestamp: 9000 }));
  try {
    callWebSocketHandler.open(audio);
    callWebSocketHandler.open(video);
    callWebSocketHandler.message(wrong, JSON.stringify({ type: "video", enabled: true }));
    callWebSocketHandler.message(wrong, frame);
    await Bun.sleep(0);
    expect(controls).toEqual([]);
    expect(frames).toEqual([]);
    callWebSocketHandler.message(video, JSON.stringify({ type: "video", enabled: true }));
    await Bun.sleep(0);
    callWebSocketHandler.message(video, frame);
    await Bun.sleep(0);
    expect(controls).toEqual([true]);
    expect(frames).toEqual([data]);
    callWebSocketHandler.message(
      video,
      Buffer.from(
        encodeCallVideoFrame({
          data,
          key: true,
          timestamp: 9100,
          sourceMid: `u${"1".repeat(32)}`,
        }),
      ),
    );
    await Bun.sleep(0);
    expect(frames).toEqual([data]); // A browser cannot claim another participant's stream.
    callWebSocketHandler.close(video);
    await Bun.sleep(0);
    expect(controls).toEqual([true, false]);
    expect(endCalls).toBe(0);
    callWebSocketHandler.close(audio);
    await Bun.sleep(0);
    expect(endCalls).toBe(1);
  } finally {
    create.mockRestore();
    await endManagedCall(created.sessionId);
  }
});
