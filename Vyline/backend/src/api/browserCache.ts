import { Hono } from "hono";

/** Browser HTTP cache only; cookies, storage and server data are deliberately excluded. */
export const browserCacheRouter = new Hono().post("/", (c) => {
  if (c.req.header("X-Vyline-Cache-Reset") !== "1" || c.req.header("Sec-Fetch-Site") === "cross-site")
    return c.json({ ok: false, error: "same-site cache reset required" }, 403);
  c.header("Clear-Site-Data", '"cache"');
  c.header("Cache-Control", "no-store");
  return c.json({ ok: true });
});
