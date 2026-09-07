import { expect, test } from "bun:test";
import { networkInterfaces } from "node:os";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateWebDavUrl } from "./recordingWebDav.js";

test("WebDAV rejects local/metadata/credentials/redirect-prone URL shapes and requires explicit LAN/HTTP opt-in", async () => {
  for (const path of [
    "http://example.com/",
    "https://x:y@example.com/",
    "https://example.com/#x",
    "https://example.com/?x=1",
    "https://127.0.0.1/",
    "https://[::1]/",
    "https://169.254.169.254/",
    "https://[::ffff:127.0.0.1]/",
    "https://192.168.0.1/",
  ]) {
    await expect(validateWebDavUrl({ path })).rejects.toThrow();
  }
  expect(
    (
      await validateWebDavUrl({
        path: "http://192.168.0.5/recordings/",
        allowPrivateNetwork: true,
        allowInsecureHttp: true,
      })
    ).ip,
  ).toBe("192.168.0.5");
  await expect(
    validateWebDavUrl({
      path: "http://127.0.0.1/",
      allowPrivateNetwork: true,
      allowInsecureHttp: true,
    }),
  ).rejects.toThrow();
});

test("Bun WebDAV client rejects disconnects and stalled Node peers with its real idle timeout", async () => {
  const ip = Object.values(networkInterfaces())
    .flat()
    .find((entry) => entry?.family === "IPv4" && !entry.internal)?.address;
  if (!ip) throw new Error("The isolated LAN stub needs a local IPv4 interface");
  // Node owns the faulting peer so this verifies the client independently
  // of Bun's server adapter and test-runner socket lifecycle.
  const server = Bun.spawn(
    [
      "node",
      "--input-type=module",
      "--eval",
      `
    import { createServer } from 'node:http';
    const server=createServer((req,res)=>{req.on('error',()=>{});if(req.url==='/stall'){req.resume();return;}req.once('data',()=>req.socket.destroy());});
    server.listen(0,'0.0.0.0',()=>console.log(server.address().port));
  `,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const root = await mkdtemp(join(tmpdir(), "vyline-dav-disconnect-"));
  const file = join(root, "generated.webm");
  await writeFile(file, Buffer.alloc(128 * 1024, 5));
  let client: ReturnType<typeof Bun.spawn> | undefined;
  try {
    const reader = server.stdout.getReader();
    const first = await reader.read();
    reader.releaseLock();
    const port = Number(new TextDecoder().decode(first.value).trim());
    expect(port).toBeGreaterThan(0);
    const request = Bun.spawn(
      [
        process.execPath,
        "--eval",
        `
      const { webDavRequest }=await import(process.env.FIXTURE_MODULE);
      try { const response=await webDavRequest({path:process.env.FIXTURE_URL,allowPrivateNetwork:true,allowInsecureHttp:true},'PUT','generated.webm',{file:process.env.FIXTURE_FILE,bytes:131072}); response.destroy(); process.exitCode=1; }
      catch { console.log('EXPECTED_DISCONNECT'); }
      const start=Date.now();
      try { const response=await webDavRequest({path:process.env.FIXTURE_URL,allowPrivateNetwork:true,allowInsecureHttp:true},'GET','stall'); response.destroy(); process.exitCode=1; }
      catch { const elapsed=Date.now()-start; if(elapsed<29000||elapsed>42000) throw new Error('Unexpected idle timeout: '+elapsed); console.log('EXPECTED_IDLE_TIMEOUT'); }
    `,
      ],
      {
        env: {
          ...process.env,
          FIXTURE_MODULE: new URL("./recordingWebDav.ts", import.meta.url).href,
          FIXTURE_URL: `http://${ip}:${port}/`,
          FIXTURE_FILE: file,
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    client = request;
    const [code, out, err] = await Promise.all([
      request.exited,
      new Response(request.stdout).text(),
      new Response(request.stderr).text(),
    ]);
    if (code !== 0) throw new Error(`WebDAV disconnect child failed (${code}): ${out}${err}`);
    expect(out).toContain("EXPECTED_DISCONNECT");
    expect(out).toContain("EXPECTED_IDLE_TIMEOUT");
  } finally {
    if (client && client.exitCode === null) {
      client.kill();
      await client.exited;
    }
    server.kill();
    await server.exited;
    await Promise.all([server.stdout.cancel(), new Response(server.stderr).text()]);
    await rm(root, { recursive: true, force: true });
  }
}, 45000);

test("WebDAV streams to an owned stub, verifies retry bytes, rejects redirects and deletes only its generated file", async () => {
  const child = Bun.spawn(
    [process.execPath, fileURLToPath(new URL("./recordingWebDav.fixture.ts", import.meta.url))],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [code, out, err] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (code !== 0) throw new Error(`Isolated WebDAV fixture failed: ${out}${err}`);
  expect(out).toContain("PASS: WebDAV");
}, 15000);
