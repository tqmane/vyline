// Isolated loopback-only recording E2E. All media and call snapshots are generated fixtures.
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const root = await mkdtemp(join(tmpdir(), "vyline-recording-browser-"));
Object.assign(process.env, {
  LOG_LEVEL: "silent",
  VYLINE_DATA_DIR: join(root, "data"),
  VYLINE_STORAGE_DIR: join(root, "storage"),
  VYLINE_BACKUP_DIR: join(root, "backups"),
  VYLINE_MEDIA_INDEX_PATH: join(root, "media.sqlite"),
});
await mkdir(join(root, "storage", "external"), { recursive: true });
const { Hono } = await import("../../../backend/node_modules/hono");
const { createRecordingRouter } = await import("../../../backend/src/api/recordings");
const service = await import("../../../backend/src/service/callRecordingService");
const { createRemoteAccessGuard } = await import("../../../backend/src/remoteAccess");
const app = new Hono();
app.use(
  "/api/line/:accountId/*",
  createRemoteAccessGuard({
    remoteAuthRequired: true,
    mode: "subdevice",
    authenticateSubdevice: async (token) =>
      token === "recording-fixture"
        ? { accountId: "fixture-owner" }
        : token === "recording-other"
          ? { accountId: "fixture-other" }
          : null,
    authorizeSubdevice: (c, session) =>
      session.accountId === c.req.param("accountId") ? null : "account mismatch",
  }),
);
app.route(
  "/api/line/:accountId/recordings",
  createRecordingRouter({
    ...service,
    startCallRecording: (owner, input) =>
      service.startCallRecording(owner, input, (sessionId) => ({
        accountId: owner,
        sessionId,
        to: `c${"1".repeat(32)}`,
        state: "in-call",
        kind: "AUDIO",
        transport: "planet",
        startedAt: Date.now(),
      })),
  }),
);
const bundle = await Bun.build({
  entrypoints: [fileURLToPath(new URL("call-recording-harness.tsx", import.meta.url))],
  target: "browser",
});
if (!bundle.success) throw new AggregateError(bundle.logs, "Cannot build recording harness");
const assets = fileURLToPath(new URL("../dist/assets/", import.meta.url));
const css = Array.from(new Bun.Glob("index-*.css").scanSync({ cwd: assets }))[0];
if (!css) throw new Error("Build frontend CSS first");
app.get(
  "/recordings.js",
  () => new Response(bundle.outputs[0], { headers: { "Content-Type": "text/javascript" } }),
);
app.get("/preview.css", () => new Response(Bun.file(join(assets, css))));
app.get(
  "/",
  () =>
    new Response(
      `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Generated call recording tests</title><link rel="stylesheet" href="/preview.css"><body><script type="module" src="/recordings.js"></script>`,
      {
        headers: {
          "Content-Type": "text/html",
          "Set-Cookie": "vyline_subdevice_session=recording-fixture; Path=/; SameSite=Strict",
        },
      },
    ),
);
Bun.serve({ hostname: "127.0.0.1", port: 8774, fetch: app.fetch });
console.log("Generated media only: http://127.0.0.1:8774/");
console.log(`Isolated fixture data: ${root}`);
