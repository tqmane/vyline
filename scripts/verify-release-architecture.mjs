import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const failures = [];
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};

const compose = read("docker-compose.yml");
expect(compose.includes("ghcr.io/tqmane/vyline:latest"), "docker-compose.yml must use tqmane GHCR image");
expect(!/^\s*build:/m.test(compose), "docker-compose.yml must not build locally");
expect(/pull_policy:\s*always/.test(compose), "docker-compose.yml must always pull the selected image");

const portainer = read("docker-compose.portainer.yml");
expect(portainer.includes("ghcr.io/tqmane/vyline:latest"), "Portainer stack must use tqmane GHCR image");
expect(/pull_policy:\s*always/.test(portainer), "Portainer stack must allow Pull latest image updates");

const workflow = read(".github/workflows/container.yml");
for (const [arch, runner] of [["amd64", "ubuntu-24.04"], ["arm64", "ubuntu-24.04-arm"]]) {
  expect(
    new RegExp(`platform: linux/${arch}\\s+arch: ${arch}\\s+runner: ${runner}(?:\\r?\\n|$)`).test(workflow),
    `container workflow must build ${arch} on native ${runner}`,
  );
}
expect(workflow.includes("runs-on: ${{ matrix.runner }}"), "container builds must use the native runner matrix");
expect(!workflow.includes("setup-qemu-action"), "container builds must not use QEMU");
expect(workflow.includes("docker/setup-buildx-action@v3"), "container workflow must configure Buildx");
expect(workflow.includes("push-by-digest=true,name-canonical=true,push=true"), "container builds must push immutable digests");
expect(/publish:\s+name:[^\n]+\s+needs: build/.test(workflow), "manifest publication must wait for both native builds");
expect(workflow.includes("docker buildx imagetools create"), "container workflow must merge both architectures");
expect(workflow.includes("Verify published architectures"), "container workflow must verify the final image platforms");
expect(workflow.includes("provenance: mode=max") && workflow.includes("sbom: true"), "container builds must retain provenance and SBOM");
expect(workflow.includes("scope=container-${{ matrix.arch }}"), "native builds must use separate architecture caches");

for (const path of [".github/workflows/ci.yml", ".github/workflows/security-scan.yml"]) {
  const checks = read(path);
  expect(checks.includes("load: true") && checks.includes("scope=container-amd64"), `${path} must load the cached image for local checks`);
}

const gitmodules = read(".gitmodules");
for (const repository of ["vyline-search", "vyline-api", "vyline-plugin", "vyline-theme"]) {
  expect(
    gitmodules.includes(`https://github.com/tqmane/${repository}.git`),
    `.gitmodules must keep tqmane/${repository}`,
  );
}
expect(!gitmodules.includes("github.com/nezumi0627/"), ".gitmodules must not point at nezumi0627 forks");

const chatArea = read("Vyline/apps/desktop/src/components/chat-area.tsx");
expect(chatArea.includes('aria-label="トークの一番下へ移動"'), "chat UI must contain the jump-to-bottom control");
expect(chatArea.includes('"∧" : "∨"'), "announcement UI must contain expand/collapse controls");
expect(chatArea.includes("showScrollToBottom"), "jump-to-bottom button must be conditional");

const readme = read("README.md");
expect(readme.includes("## Quickstart"), "README must start with a concise Quickstart");
expect(readme.includes("Pull latest image"), "README must document the Portainer update flow");

if (failures.length) {
  console.error("Release architecture verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Release architecture verification passed.");
