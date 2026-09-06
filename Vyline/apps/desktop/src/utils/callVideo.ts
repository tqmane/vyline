import { CALL_VIDEO_MAX_BYTES } from "@vyline/types";

function avccNals(data: Uint8Array): Uint8Array[] {
  if (!data.length || data.length > CALL_VIDEO_MAX_BYTES) throw new Error("Invalid AVC frame size");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const nals: Uint8Array[] = [];
  for (let offset = 0; offset < data.length; ) {
    if (offset + 4 > data.length) throw new Error("Truncated AVC length");
    const length = view.getUint32(offset);
    offset += 4;
    if (length < 2 || length > data.length - offset) throw new Error("Invalid AVC NAL");
    nals.push(data.subarray(offset, offset + length));
    offset += length;
  }
  return nals;
}

export function avccToAnnexB(data: Uint8Array): Uint8Array {
  const result = new Uint8Array(data.length);
  let offset = 0;
  for (const nal of avccNals(data)) {
    result.set([0, 0, 0, 1], offset);
    result.set(nal, offset + 4);
    offset += nal.length + 4;
  }
  return result;
}

export function avcCodec(data: Uint8Array): string | undefined {
  const sps = avccNals(data).find((nal) => (nal[0] & 31) === 7);
  if (!sps || sps.length < 4) return undefined;
  return `avc1.${[...sps.subarray(1, 4)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function annexBToAvcc(data: Uint8Array): Uint8Array {
  if (!data.length || data.length > CALL_VIDEO_MAX_BYTES) throw new Error("Invalid AVC frame size");
  const starts: { index: number; bytes: number }[] = [];
  for (let i = 0; i + 3 <= data.length; i++) {
    if (data[i] !== 0 || data[i + 1] !== 0) continue;
    const bytes = data[i + 2] === 1 ? 3 : data[i + 2] === 0 && data[i + 3] === 1 ? 4 : 0;
    if (bytes) {
      starts.push({ index: i, bytes });
      i += bytes - 1;
    }
  }
  if (!starts.length || starts[0].index !== 0) throw new Error("Annex B start code missing");
  const nals = starts.map((start, i) =>
    data.subarray(start.index + start.bytes, starts[i + 1]?.index ?? data.length),
  );
  const size = nals.reduce((total, nal) => total + nal.length + 4, 0);
  if (size > CALL_VIDEO_MAX_BYTES || nals.some((nal) => nal.length < 2))
    throw new Error("Invalid AVC NAL");
  const result = new Uint8Array(size);
  const view = new DataView(result.buffer);
  let offset = 0;
  for (const nal of nals) {
    view.setUint32(offset, nal.length);
    result.set(nal, offset + 4);
    offset += nal.length + 4;
  }
  return result;
}
