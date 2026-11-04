import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser } from "@playwright/test";
import { mkdir, readdir } from "node:fs/promises";
import { join, resolve, relative, isAbsolute } from "node:path";

let browser: Browser;
let script = "";
let style = "";
const desktop = resolve(import.meta.dir, "..");
const nativeRoot = join(desktop, "public/dist/ui-compose");
const output = join(desktop, "test-results/composer-attachments");
beforeAll(async () => {
  const built = await Bun.build({
    entrypoints: [join(import.meta.dir, "composer-attachments-harness.tsx")],
    target: "browser",
    format: "iife",
    tsconfig: join(desktop, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [
      {
        name: "local-svg",
        setup(build) {
          build.onResolve({ filter: /\.svg\?url$/ }, (args) => ({
            path: resolve(args.resolveDir, args.path.slice(0, -4)),
            namespace: "svg-url",
          }));
          build.onLoad({ filter: /\.svg$/, namespace: "svg-url" }, async ({ path }) => ({
            contents: `export default ${JSON.stringify(`data:image/svg+xml,${encodeURIComponent(await Bun.file(path).text())}`)};`,
            loader: "js",
          }));
        },
      },
    ],
  });
  if (!built.success) throw new Error(built.logs.join("\n"));
  script = await built.outputs.find((item) => item.path.endsWith(".js"))!.text();
  const css = (await readdir(join(desktop, "dist/assets"))).find((name) =>
    /^index-.*\.css$/.test(name),
  );
  style = await Bun.file(join(desktop, "dist/assets", css!)).text();
  for (const css of built.outputs.filter((item) => item.path.endsWith(".css")))
    style += await css.text();
  await mkdir(output, { recursive: true });
  browser = await chromium.launch({ channel: "chrome", headless: true });
});
afterAll(async () => {
  await browser?.close();
});

for (const mode of ["legacy", "nezu", "apple", "fluent", "miuix"])
  test(`separate media/file pickers: ${mode}`, async () => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      serviceWorkers: "block",
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== "http://127.0.0.1" || route.request().method() !== "GET") {
        errors.push(`Blocked ${route.request().method()} ${url.origin}`);
        return route.abort();
      }
      if (url.pathname === "/fixture")
        return route.fulfill({
          contentType: "text/html",
          body: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${style}</style><div id="root"></div><script src="/fixture.js"></script>`,
        });
      if (url.pathname === "/fixture.js")
        return route.fulfill({ contentType: "text/javascript", body: script });
      if (url.pathname.startsWith("/dist/ui-compose/")) {
        const path = resolve(
          nativeRoot,
          decodeURIComponent(url.pathname.slice("/dist/ui-compose/".length)),
        );
        const child = relative(nativeRoot, path);
        if (child.startsWith("..") || isAbsolute(child)) return route.abort();
        return route.fulfill({
          path,
          ...(path.endsWith(".wasm") ? { contentType: "application/wasm" } : {}),
        });
      }
      errors.push(`Blocked local route ${url.pathname}`);
      return route.abort();
    });
    try {
      await page.goto(`http://127.0.0.1/fixture?mode=${mode}`);
      await page.waitForFunction(() => !!(window as any).composerFixture?.snapshot);
      const native = !["legacy", "nezu"].includes(mode);
      const frame = page.frameLocator('iframe[title="Vyline Compose UI"]');
      const nativeClick = async (name: string) => {
        const button = frame.getByRole("button", { name, exact: true });
        await button.waitFor({ state: "visible", timeout: 30_000 });
        let box = await button.boundingBox();
        let previous = "";
        let stable = 0;
        for (let i = 0; i < 40 && stable < 3; i++) {
          box = await button.boundingBox();
          const current = JSON.stringify(box);
          stable = box && current === previous ? stable + 1 : 0;
          previous = current;
          await page.waitForTimeout(75);
        }
        if (!box) throw new Error(`No native bounds: ${name}`);
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      };
      const pick = async (kind: "media" | "file", imageAsFile = false) => {
        if (native) {
          await frame
            .getByRole("button", { name: "写真・動画", exact: true })
            .waitFor({ state: "detached" });
          await nativeClick("添付とその他の操作");
        }
        const chosen = page.waitForEvent("filechooser", { timeout: 5000 }).catch(async (error) => {
          throw new Error(
            `${String(error)} ${JSON.stringify(await page.evaluate(() => ({ actions: (window as any).composerFixture.actions, pending: (window as any).composerFixture.snapshot.pending })))}`,
          );
        });
        const [chooser] = await Promise.all([
          chosen,
          native
            ? nativeClick(kind === "media" ? "写真・動画" : "ファイル")
            : page
                .getByRole("button", {
                  name: kind === "media" ? "写真を添付" : "ファイルを添付",
                  exact: true,
                })
                .click({ timeout: 2500 }),
        ]);
        expect(await chooser.element().getAttribute("accept")).toBe(
          kind === "media" ? "image/*,video/*" : "",
        );
        expect(chooser.isMultiple()).toBe(true);
        await chooser.setFiles(
          kind === "media" || imageAsFile
            ? [
                {
                  name: imageAsFile ? "as-file.png" : "pixel.png",
                  mimeType: "image/png",
                  buffer: Buffer.from(
                    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=",
                    "base64",
                  ),
                },
              ]
            : [
                {
                  name: "fixture.pdf",
                  mimeType: "application/pdf",
                  buffer: Buffer.from("fixture"),
                },
              ],
        );
        await page.waitForFunction(
          (name) => (window as any).composerFixture.snapshot.pending[0]?.name === name,
          imageAsFile ? "as-file.png" : kind === "media" ? "pixel.png" : "fixture.pdf",
        );
        expect(
          await page.evaluate(() =>
            (window as any).composerFixture.snapshot.pending.map((item: any) => item.kind),
          ),
        ).toEqual([kind === "media" ? "image" : "file"]);
        expect(await chooser.element().inputValue()).toBe("");
      };
      // A PNG picked as a file must stay a file after the media picker was used.
      await pick("file");
      await page.evaluate(() => (window as any).composerFixture.clear());
      await pick("media");
      await page.evaluate(() => (window as any).composerFixture.clear());
      await pick("file", true);
      if (!native) {
        const photos = page.getByRole("button", { name: "写真を添付", exact: true });
        const files = page.getByRole("button", { name: "ファイルを添付", exact: true });
        expect(await photos.locator("svg").innerHTML()).not.toBe(
          await files.locator("svg").innerHTML(),
        );
        const box = await page.locator(".vy-composer-surface").boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(391);
      }
      await page.screenshot({ path: join(output, `${mode}.png`) });
      expect(await page.evaluate(() => (window as any).composerFixture.messages.length)).toBe(0);
      expect(errors).toEqual([]);
    } catch (error) {
      await page.screenshot({ path: join(output, `${mode}-failed.png`) });
      throw error;
    } finally {
      await page.close();
    }
  }, 90_000);
