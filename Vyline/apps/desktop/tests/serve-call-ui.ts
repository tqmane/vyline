// Run after `bun run build`, then open one of the printed loopback URLs.
import { fileURLToPath } from "node:url";

const entries = {
  lifecycle: "call-video-harness.tsx",
  modals: "plus-menu-harness.tsx",
  group: "call-audio-harness.tsx",
  panel: "call-panel-harness.tsx",
};
const bundles = new Map<string, Blob>();
for (const [name, entry] of Object.entries(entries)) {
  const result = await Bun.build({
    entrypoints: [fileURLToPath(new URL(entry, import.meta.url))],
    target: "browser",
  });
  if (!result.success) throw new AggregateError(result.logs, `Cannot build ${entry}`);
  bundles.set(`/${name}.js`, result.outputs[0]);
}
const assets = fileURLToPath(new URL("../dist/assets/", import.meta.url));
const css = Array.from(new Bun.Glob("index-*.css").scanSync({ cwd: assets }))[0];
if (!css) throw new Error("Run bun run build before the browser harness.");
Bun.serve({
  hostname: "127.0.0.1",
  port: 8768,
  fetch(request) {
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
    const path = new URL(request.url).pathname;
    if (path === "/preview.css") return new Response(Bun.file(`${assets}/${css}`));
    const bundle = bundles.get(path);
    if (bundle) return new Response(bundle, { headers: { "content-type": "text/javascript" } });
    if (!Object.hasOwn(entries, path.slice(1))) return new Response("Not found", { status: 404 });
    return new Response(
      `<!doctype html><html lang="ja"><meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Vyline UI regression tests</title><link rel="stylesheet" href="/preview.css">
      <body style="background:#101820;color:white"><script type="module" src="${path}.js"></script>`,
      { headers: { "content-type": "text/html", "x-content-type-options": "nosniff" } },
    );
  },
});
console.log("Local tests (no real camera, microphone or LINE requests):");
console.log("http://127.0.0.1:8768/lifecycle");
console.log("http://127.0.0.1:8768/modals");
