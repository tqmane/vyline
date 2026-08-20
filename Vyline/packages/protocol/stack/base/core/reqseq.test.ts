import { describe, expect, test } from "bun:test";
import { BaseClient } from "./mod.js";
import { MemoryStorage } from "../storage/mod.js";

describe("BaseClient.getReqseq", () => {
  test("serializes concurrent first-use sequence allocation", async () => {
    const storage = new MemoryStorage();
    const client = new BaseClient({ device: "ANDROIDSECONDARY", storage });

    const values = await Promise.all(Array.from({ length: 6 }, () => client.getReqseq()));

    expect(values).toEqual([0, 1, 2, 3, 4, 5]);
    expect(JSON.parse(String(await storage.get("reqseq")))).toEqual({ talk: 6 });
  });
});
