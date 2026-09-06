import { expect, test } from "bun:test";
import { annexBToAvcc, avccToAnnexB, avcCodec } from "./callVideo";

test("video converts Annex B and AVCC without losing parameter sets or NAL boundaries", () => {
  const annex = new Uint8Array([
    0, 0, 0, 1, 0x67, 0x42, 0xe0, 0x1e, 0, 0, 1, 0x68, 0xee, 0, 0, 0, 1, 0x65, 0x88,
  ]);
  const avcc = annexBToAvcc(annex);
  expect(avcCodec(avcc)).toBe("avc1.42e01e");
  expect(annexBToAvcc(avccToAnnexB(avcc))).toEqual(avcc);
  for (const invalid of [
    new Uint8Array(),
    new Uint8Array([0, 0, 0, 5, 0x65]),
    new Uint8Array([0, 0, 0, 1, 0x65]),
  ]) {
    expect(() => avccToAnnexB(invalid)).toThrow();
  }
});
