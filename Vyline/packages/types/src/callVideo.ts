/** Video-only call WebSocket. PCM keeps its existing binary contract. */
export const CALL_VIDEO_MAX_BYTES = 1024 * 1024;

export interface CallVideoFrame {
  data: Uint8Array;
  key: boolean;
  timestamp: number;
  rotation?: number;
}

export interface CallVideoState {
  available: boolean;
  localEnabled: boolean;
  remoteEnabled: boolean;
}

export function encodeCallVideoFrame(frame: CallVideoFrame): Uint8Array {
  if (
    !Number.isInteger(frame.timestamp) ||
    frame.timestamp < 0 ||
    frame.timestamp > 0xffffffff ||
    !Number.isInteger(frame.rotation ?? 0) ||
    (frame.rotation ?? 0) < 0 ||
    (frame.rotation ?? 0) > 3 ||
    frame.data.length < 1 ||
    frame.data.length > CALL_VIDEO_MAX_BYTES
  )
    throw new Error("Invalid video frame");
  const packet = new Uint8Array(8 + frame.data.length);
  packet.set([1, Number(frame.key), frame.rotation ?? 0, 0]);
  new DataView(packet.buffer).setUint32(4, frame.timestamp);
  packet.set(frame.data, 8);
  return packet;
}

export function decodeCallVideoFrame(packet: Uint8Array): CallVideoFrame {
  if (
    packet.length <= 8 ||
    packet.length > CALL_VIDEO_MAX_BYTES + 8 ||
    packet[0] !== 1 ||
    packet[1]! > 1 ||
    packet[2]! > 3 ||
    packet[3] !== 0
  )
    throw new Error("Invalid video frame");
  return {
    key: packet[1] === 1,
    rotation: packet[2]!,
    timestamp: new DataView(packet.buffer, packet.byteOffset, packet.byteLength).getUint32(4),
    data: packet.subarray(8),
  };
}
