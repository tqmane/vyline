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
const publishesAmd64 = /platform:\s*linux\/amd64/.test(workflow);
const publishesArm64 = /platform:\s*linux\/arm64/.test(workflow);
expect(publishesAmd64 && publishesArm64, "container workflow must publish amd64 and arm64");
expect(
  /runner:\s*ubuntu-24\.04-arm/.test(workflow),
  "container workflow must use a native GitHub-hosted ARM64 runner",
);
expect(
  !workflow.includes("docker/setup-qemu-action"),
  "container workflow must not use QEMU when a native ARM64 runner is configured",
);
expect(workflow.includes("docker/setup-buildx-action@v3"), "container workflow must configure Buildx");
expect(workflow.includes("push: true"), "container workflow must push to GHCR");
expect(
  workflow.includes("docker buildx imagetools create"),
  "container workflow must merge architecture digests into a multi-architecture manifest",
);

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
