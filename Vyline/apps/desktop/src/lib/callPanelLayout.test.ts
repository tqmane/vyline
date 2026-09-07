import { expect, test } from "bun:test";
import { callPanelLayout } from "./callPanelLayout";

test("Classic and Nezu reserve the visible sidebar before docking a call", () => {
  expect(callPanelLayout(768, 400, 366).docked).toBe(false);
  // Existing 768–1023px CSS uses a 19rem sidebar (304px at a 16px root font).
  expect(callPanelLayout(949, 400, 310).docked).toBe(false);
  expect(callPanelLayout(950, 400, 310)).toEqual({ docked: true, maximum: 320, width: 320 });
  expect(callPanelLayout(1005.99, 400, 366).docked).toBe(false);
  expect(callPanelLayout(1006, 400, 366)).toEqual({ docked: true, maximum: 320, width: 320 });
  expect(callPanelLayout(1024, 400, 366)).toEqual({ docked: true, maximum: 338, width: 338 });
  expect(callPanelLayout(1280, 400, 366)).toEqual({ docked: true, maximum: 594, width: 400 });
  expect(callPanelLayout(1280, 900, 366).width).toBe(594);
  expect(callPanelLayout(1165, 400, 526).docked).toBe(false);
  expect(callPanelLayout(1166, 400, 526).width).toBe(320);
  // Touch layouts omit the divider, while scaled fonts can make it wider than 6px.
  expect(callPanelLayout(1000, 400, 360).docked).toBe(true);
  expect(callPanelLayout(1006, 400, 368).docked).toBe(false);
});

test("Compose and a collapsed sidebar need only a 320px application beside the call", () => {
  expect(callPanelLayout(639, 400).docked).toBe(false);
  expect(callPanelLayout(640, 400)).toEqual({ docked: true, maximum: 320, width: 320 });
  expect(callPanelLayout(768, 400)).toEqual({ docked: true, maximum: 448, width: 400 });
  expect(callPanelLayout(768, 900).width).toBe(448);
  expect(callPanelLayout(768, 100).width).toBe(320);
  expect(callPanelLayout(0, 400).docked).toBe(false);
  expect(callPanelLayout(Number.NaN, Number.NaN).docked).toBe(false);
});
