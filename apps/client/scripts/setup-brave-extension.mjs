#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");
const extensionDir = join(repoRoot, "extensions", "chrome");

const braveCandidates = [
  "brave-browser",
  "brave",
  "brave-browser-stable",
];

function findBraveCommand() {
  for (const command of braveCandidates) {
    const result = spawnSync("which", [command], { encoding: "utf8" });
    if (result.status === 0 && result.stdout.trim()) {
      return result.stdout.trim();
    }
  }
  return null;
}

const build = spawnSync("cargo", ["build", "--bin", "ganbaruai-native-messaging"], {
  cwd: repoRoot,
  stdio: "inherit",
});

if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const brave = findBraveCommand();
if (!brave) {
  console.error("Brave was not found. Open brave://extensions manually and load:");
  console.error(extensionDir);
  process.exit(1);
}

if (!existsSync(extensionDir)) {
  console.error(`Extension folder not found: ${extensionDir}`);
  process.exit(1);
}

console.log("Opening Brave extension manager.");
console.log("");
console.log("In Brave:");
console.log("1. Turn on Developer mode in the extensions page.");
console.log("2. Click Load unpacked.");
console.log("3. Select this folder:");
console.log(extensionDir);
console.log("");
console.log("After the GanbaruAI card appears, copy its extension id and run:");
console.log("node apps/client/scripts/install-chrome-native-host.mjs <extension-id> brave");

spawnSync(brave, ["brave://extensions"], {
  detached: true,
  stdio: "ignore",
});
