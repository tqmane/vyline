import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const protocol = createRequire(new URL("../../packages/protocol/package.json", import.meta.url));
const desktop = createRequire(new URL("../../apps/desktop/package.json", import.meta.url));
const backend = createRequire(import.meta.url);

test("Frida's process-name matcher keeps its constructor and brace/wildcard matching contract", () => {
  const frida = createRequire(protocol.resolve("frida"));
  const { Minimatch } = frida("minimatch");
  const matcher = new Minimatch("line{,beta}*.exe");
  expect(matcher.match("LINE.exe".toLowerCase())).toBe(true);
  expect(matcher.match("linebeta-canary.exe")).toBe(true);
  expect(matcher.match("other.exe")).toBe(false);
});

test("the patched PostCSS selector and source-map dependencies preserve Tailwind utilities", async () => {
  const postcss = desktop("postcss");
  const tailwind = desktop("tailwindcss");
  const result = await postcss([
    tailwind({
      content: [{ raw: '<div class="p-2 hover:text-red-500"></div>' }],
    }),
  ]).process("@tailwind utilities;", { from: "fixture.css", map: { inline: false } });
  expect(result.css).toContain("padding: 0.5rem");
  expect(result.css).toContain(".hover\\:text-red-500:hover");
  expect(result.map.toJSON().sources).toContain("fixture.css");
});

test("pino-pretty formats nested log data without changing the caller's object", () => {
  const pretty = backend("pino-pretty").prettyFactory({
    colorize: false,
    ignore: "pid,hostname,time",
  });
  const entry = { level: 30, time: 0, msg: "compatibility fixture", details: { items: [1, 2] } };
  const before = structuredClone(entry);
  const output = pretty(entry);
  expect(output).toContain("compatibility fixture");
  expect(output).toContain("details");
  expect(entry).toEqual(before);
});

test("the Node-only push fetch retains Undici's H2 Agent and response-body contract", () => {
  // This path runs on Node; Bun substitutes its own undici shim.
  const result = spawnSync(
    "node",
    [
      "-e",
      `
    const requireUndici = require("node:module").createRequire(${JSON.stringify(protocol.resolve("undici/package.json"))});
    const { Agent, MockAgent, fetch } = requireUndici("undici");
    (async () => {
      await new Agent({ allowH2: true }).close();
      const agent = new MockAgent();
      agent.disableNetConnect();
      agent.get("https://fixture.invalid").intercept({ path: "/rpc", method: "POST" })
        .reply(200, { result: "fixture" }, { headers: { "content-type": "application/json" } });
      try {
        const response = await fetch("https://fixture.invalid/rpc", { method: "POST", body: "fixture", dispatcher: agent });
        console.log(JSON.stringify({ status: response.status, body: await response.json() }));
      } finally { await agent.close(); }
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `,
    ],
    { encoding: "utf8", timeout: 10_000 },
  );
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ status: 200, body: { result: "fixture" } });
});
