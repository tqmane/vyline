import { afterEach, expect, spyOn, test } from "bun:test";
import * as service from "../service/lineService.js";
import { lineRouter } from "./line.js";

const restores: Array<() => void> = [];
afterEach(() => { for (const restore of restores.splice(0)) restore(); });

test("JSON send routes preserve mute intent and reject non-boolean flags before sending", async () => {
  const routes = [
    { path: "send", payload: { text: "fixture" }, spy: spyOn(service, "sendMessage").mockResolvedValue(null), option: 3 },
    { path: "send-sticker", payload: { packageId: "1", stickerId: "2" }, spy: spyOn(service, "sendSticker").mockResolvedValue(null), option: 2 },
    { path: "send-emoji", payload: { packageId: "1", sticonId: "2" }, spy: spyOn(service, "sendLineEmoji").mockResolvedValue(null), option: 2 },
    { path: "send-combination-sticker", payload: { items: [{ packageId: "1", stickerId: "2" }] }, spy: spyOn(service, "sendCombinationSticker").mockResolvedValue(null), option: 3 },
  ];
  restores.push(...routes.map(route => () => route.spy.mockRestore()));
  for (const route of routes) {
    for (const mute of [true, false]) {
      const response = await lineRouter.request(`http://localhost/delivery-fixture/${route.path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatMid: "c-fixture", ...route.payload, mute }),
      });
      expect(response.status).toBe(200);
      const options = route.spy.mock.calls.at(-1)?.[route.option] as { mute?: boolean };
      expect(options?.mute === true).toBe(mute);
    }
    for (const mute of ["true", "false", 1, null]) {
      const response = await lineRouter.request(`http://localhost/delivery-fixture/${route.path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatMid: "c-fixture", ...route.payload, mute }),
      });
      expect(response.status).toBe(400);
    }
    expect(route.spy).toHaveBeenCalledTimes(2);
  }
});
