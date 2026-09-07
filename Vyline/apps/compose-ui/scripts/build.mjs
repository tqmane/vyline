import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, statSync, rmSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const development = process.argv.includes("--development");
if (!process.argv.includes("--copy-only")) {
  const task = development ? "wasmJsBrowserDevelopmentExecutableDistribution" : "wasmJsBrowserDistribution";
  const result = spawnSync(process.platform === "win32" ? "gradlew.bat" : "sh", process.platform === "win32" ? [task, "--console=plain"] : ["./gradlew", task, "--console=plain"], {
    cwd: project, stdio: "inherit", shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const distribution = join(project, "dist", "gradle", "dist", "wasmJs", development ? "developmentExecutable" : "productionExecutable");
if (!existsSync(join(distribution, "index.html"))) throw new Error(`No Compose distribution at ${distribution}`);
const publicRoot = resolve(project, "../desktop/public");
const destination = resolve(publicRoot, "dist/ui-compose");
if (!destination.startsWith(publicRoot + sep)) throw new Error("Compose output must remain within desktop/public");
if (!development) rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
// Keep previous hashed assets during development so an already-open iframe can finish loading.
cpSync(distribution, destination, { recursive: true });
let bytes = 0;
const count = (directory) => {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) count(path);
    else bytes += statSync(path).size;
  }
};
count(distribution);
console.log(`Compose ${development ? "development" : "production"}: ${(bytes / 1024 / 1024).toFixed(1)} MiB -> ${destination}`);
