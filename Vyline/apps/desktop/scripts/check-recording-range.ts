// Start tests/serve-call-recordings.ts, then run:
// bun scripts/check-recording-range.ts <local-fragmented.mp4> [duration-seconds]
// The fixture server is isolated; no real LINE calls or production writes occur.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium, expect, type Locator } from "@playwright/test";

const base = process.env.VYLINE_TEST_URL ?? "http://127.0.0.1:8774";
assert(new URL(base).hostname === "127.0.0.1", "Use the isolated loopback fixture only");
assert(process.argv[2], "A local fragmented MP4 fixture is required");
const original = await readFile(process.argv[2]);
const duration = Number(process.argv[3] ?? "28.282");
assert(Number.isFinite(duration) && duration > 2);
const title = "Range HTTP fixture";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
const headers = { Authorization: "Bearer recording-fixture", "X-Vyline-Installation-Id": "fixture" };
const api = `${base}/api/line/fixture-owner/recordings`;
const ranges: string[] = [];
context.on("page", (page) => page.on("request", (request) => {
  if (request.url().includes("/recordings/") && request.headers().range)
    ranges.push(request.headers().range);
}));
page.on("request", (request) => {
  if (request.url().includes("/recordings/") && request.headers().range)
    ranges.push(request.headers().range);
});
let id: string | undefined;
const results: object[] = [];

async function play(video: Locator, surface: string, iteration: number) {
  await video.evaluate(async (element: HTMLVideoElement) => {
    element.muted = true;
    element.load();
    await element.play();
  });
  await expect.poll(() => video.evaluate((v: HTMLVideoElement, expected) => Math.abs(v.duration - expected), duration)).toBeLessThan(0.2);
  await video.evaluate((v: HTMLVideoElement, time) => { v.pause(); v.currentTime = time; }, duration / 2);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => !v.seeking && v.readyState >= 2)).toBe(true);
  await video.evaluate((v: HTMLVideoElement) => v.play());
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(duration / 2 + 0.05);
  await video.evaluate((v: HTMLVideoElement, time) => { v.pause(); v.currentTime = time; }, duration - 0.5);
  await video.evaluate((v: HTMLVideoElement) => v.play());
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.ended), { timeout: 10000 }).toBe(true);
  const result = await video.evaluate((v: HTMLVideoElement) => ({
    duration: v.duration, ended: v.ended, width: v.videoWidth,
    frames: v.getVideoPlaybackQuality().totalVideoFrames, error: v.error?.code ?? null,
  }));
  assert(Math.abs(result.duration - duration) < 0.2 && result.width > 0 && result.frames > 0 && result.error === null);
  results.push({ surface, iteration, ...result });
}

try {
  await page.goto(base);
  assert.equal(await page.title(), "Generated call recording tests", "Refuse writes outside the fixture server");
  const started = await context.request.post(`${api}/start`, {
    headers, data: { sessionId: "generated-session", title, kind: "video", mimeType: "video/mp4", consentAccepted: true },
  });
  assert.equal(started.status(), 201);
  id = (await started.json()).recording.id;
  for (let offset = 0; offset < original.length; offset += 262144) {
    const response = await context.request.put(`${api}/${id}/chunks`, {
      headers: { ...headers, "Content-Type": "application/octet-stream", "X-Recording-Offset": String(offset) },
      data: original.subarray(offset, offset + 262144),
    });
    assert.equal(response.status(), 200);
  }
  assert.equal((await context.request.post(`${api}/${id}/finish`, {
    headers, data: { durationMs: Math.round(duration * 1000), interrupted: false },
  })).status(), 200);
  const url = `${api}/${id}/file`;
  for (const start of [17, Math.floor(original.length / 2), original.length - 127]) {
    const response = await context.request.get(url, { headers: { Range: `bytes=${start}-` } });
    assert.equal(response.status(), 206);
    assert.equal(response.headers()["content-range"], `bytes ${start}-${original.length - 1}/${original.length}`);
    assert((await response.body()).equals(original.subarray(start)), "Range body differs from source bytes");
  }
  for (let iteration = 1; iteration <= 3; iteration++) {
    await page.reload();
    const item = page.locator("li").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
    await item.locator("summary").click();
    await play(item.locator("video"), "embedded", iteration);
    const tab = await context.newPage();
    try {
      await tab.goto(url, { waitUntil: "domcontentloaded" });
      await play(tab.locator("video"), "new-tab", iteration);
    } finally { await tab.close(); }
  }
  assert(ranges.some((range) => /^bytes=[1-9]\d*-/.test(range)), "Browser playback must request a nonzero byte range");
  console.log(JSON.stringify({ results, ranges }, null, 2));
} finally {
  try {
    if (id) assert.equal((await context.request.delete(`${api}/${id}`, { headers })).status(), 200);
  } finally { await browser.close(); }
}
