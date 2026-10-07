import { expect, spyOn, test } from "bun:test";
import * as sessionFactory from "./sessionFactory.js";
import { decodeCallVideoFrame, encodeCallVideoFrame } from "@vyline/types";
import {
  callWebSocketHandler,
  endManagedCall,
  listAccountCalls,
  startManagedCall,
  startManagedIncomingCall,
  getCallSnapshot,
  type CallWsData,
} from "./callManager.js";

test("revoking a device detaches both sockets immediately and rejects a delayed open", async () => {
  let stateChanged = () => {};
  const session = { state: "connecting", videoState: { localEnabled: false },
    on(event: string, listener: () => void) { if (event === "state") stateChanged = listener; },
    async start() {}, async end() { this.state = "ended"; } };
  const create = spyOn(sessionFactory, "createGroupCallSession").mockResolvedValue({
    session, transportKind: "planet", wire: { deviceDetails: { device: "IOSIPAD" } },
  } as never);
  const accountId = "revoked-device-call";
  const controller = new AbortController();
  const grant = { accountId, signal: controller.signal, dispose() {} };
  let sessionId = "";
  const socket = (media?: "video", subdevice?: typeof grant) => ({
    data: { accountId, sessionId, ...(media ? { media } : {}), ...(subdevice ? { subdevice } : {}) },
    sent: [] as (string | Uint8Array)[], closed: [] as (number | undefined)[],
    send(value: string | Uint8Array) { this.sent.push(value); return 1; },
    close(code?: number) { this.closed.push(code); },
  });
  try {
    sessionId = (await startManagedCall({ accountId, client: {} as never, to: `c${"7".repeat(32)}` })).sessionId;
    const owner = socket();
    const audio = socket(undefined, grant);
    const video = socket("video", grant);
    for (const ws of [owner, audio, video]) callWebSocketHandler.open(ws as never);
    controller.abort();
    expect(audio.closed).toEqual([4403]);
    expect(video.closed).toEqual([4403]);
    const delivered = [audio.sent.length, video.sent.length];
    stateChanged();
    callWebSocketHandler.message(audio as never, '{"type":"ping"}');
    callWebSocketHandler.message(video as never, '{"type":"ping"}');
    expect([audio.sent.length, video.sent.length]).toEqual(delivered);
    callWebSocketHandler.message(owner as never, '{"type":"ping"}');
    expect(owner.closed).toEqual([]);
    expect(owner.sent.at(-1)).toBe('{"type":"pong"}');
    const delayed = socket(undefined, grant);
    callWebSocketHandler.open(delayed as never);
    expect(delayed.closed).toEqual([4403]);
    expect(delayed.sent).toEqual([]);
  } finally {
    create.mockRestore();
    if (sessionId) await endManagedCall(sessionId);
  }
});

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

test("slow video WebSocket resumes only at a keyframe after dropping frames", async () => {
  const queuedFrames: Array<{ data: Uint8Array; key: boolean; timestamp: number }> = [];
  const frameWaiters: Array<(frame: (typeof queuedFrames)[number]) => void> = [];
  const session = {
    state: "connecting",
    videoState: { available: true, localEnabled: false, remoteEnabled: true },
    on() {},
    async start() {
      this.state = "in-call";
    },
    async end() {
      this.state = "ended";
    },
    sendStream() {
      return new Promise<void>(() => {});
    },
    async *received() {
      await new Promise<void>(() => {});
    },
    async *receivedVideo() {
      while (true) {
        const frame =
          queuedFrames.shift() ??
          (await new Promise<(typeof queuedFrames)[number]>((resolve) => frameWaiters.push(resolve)));
        yield frame;
      }
    },
  };
  const create = spyOn(sessionFactory, "createDirectCallSession").mockResolvedValue({
    session,
    transportKind: "planet",
    wire: { deviceDetails: { device: "IOSIPAD" } },
  } as never);
  const accountId = "video-backpressure-test";
  const created = await startManagedCall({ accountId, client: {} as never, to: "u-peer" });
  const sent: Uint8Array[] = [];
  let bufferedAmount = 0;
  const video = {
    data: { accountId, sessionId: created.sessionId, media: "video" },
    send(message: string | Uint8Array) {
      if (typeof message !== "string") sent.push(message);
    },
    getBufferedAmount() {
      return bufferedAmount;
    },
    close() {},
  } as never;
  const push = async (key: boolean, timestamp: number) => {
    const frame = {
      data: new Uint8Array([0x30, 0, 0, 0x9d, 1, 0x2a, 0x80, 2, 0x68, 1, 0, 0]),
      key,
      timestamp,
    };
    const waiter = frameWaiters.shift();
    if (waiter) waiter(frame);
    else queuedFrames.push(frame);
    await Bun.sleep(0);
    await Bun.sleep(0);
  };
  try {
    await Bun.sleep(0);
    callWebSocketHandler.open(video);
    await push(true, 100);
    bufferedAmount = 2 * 1024 * 1024;
    await push(false, 200);
    bufferedAmount = 0;
    await push(false, 300);
    expect(sent.map((packet) => decodeCallVideoFrame(packet).key)).toEqual([true]);
    await push(true, 400);
    await push(false, 500);
    expect(sent.map((packet) => decodeCallVideoFrame(packet).key)).toEqual([true, true, false]);
  } finally {
    create.mockRestore();
    await endManagedCall(created.sessionId);
  }
});
