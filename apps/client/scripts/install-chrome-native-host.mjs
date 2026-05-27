#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HOST_NAME = "org.opengrimoire.ganbaruai.doomscrolling";
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");

const args = process.argv.slice(2);
const extensionId = args[0];
const browser = args[1] ?? "chrome";

if (!extensionId || !/^[a-p]{32}$/.test(extensionId)) {
  if (extensionId) {
    console.error(`Invalid extension id. Expected 32 letters from a to p, got ${extensionId.length} characters.`);
  }
  console.error("Usage: node apps/client/scripts/install-chrome-native-host.mjs <extension-id> [chrome|chromium|brave|edge]");
  process.exit(1);
}

const binaryName = process.platform === "win32"
  ? "ganbaruai-native-messaging.exe"
  : "ganbaruai-native-messaging";
const hostPath = join(repoRoot, "target", "debug", binaryName);

if (!existsSync(hostPath)) {
  console.error(`Native host not found at ${hostPath}`);
  console.error("Run: pnpm -w run build:native-host");
  process.exit(1);
}

function linuxManifestDir() {
  const configHome = process.env.XDG_CONFIG_HOME || join(process.env.HOME || "", ".config");
  const profileDirs = {
    chrome: "google-chrome",
    chromium: "chromium",
    brave: join("BraveSoftware", "Brave-Browser"),
    edge: "microsoft-edge",
  };
  const profileDir = profileDirs[browser];
  if (!profileDir) {
    throw new Error(`Unsupported browser '${browser}'`);
  }
  return join(configHome, profileDir, "NativeMessagingHosts");
}

function macManifestDir() {
  const home = process.env.HOME || "";
  const profileDirs = {
    chrome: join("Google", "Chrome"),
    chromium: "Chromium",
    brave: join("BraveSoftware", "Brave-Browser"),
    edge: join("Microsoft Edge"),
  };
  const profileDir = profileDirs[browser];
  if (!profileDir) {
    throw new Error(`Unsupported browser '${browser}'`);
  }
  return join(home, "Library", "Application Support", profileDir, "NativeMessagingHosts");
}

function manifestDir() {
  if (process.platform === "linux") return linuxManifestDir();
  if (process.platform === "darwin") return macManifestDir();
  throw new Error("This installer currently supports Linux and macOS. On Windows, create the native host manifest and registry key manually.");
}

const dir = manifestDir();
mkdirSync(dir, { recursive: true });

const manifestPath = join(dir, `${HOST_NAME}.json`);
const manifest = {
  name: HOST_NAME,
  description: "GanbaruAI doomscrolling native host",
  path: hostPath,
  type: "stdio",
  allowed_origins: [`chrome-extension://${extensionId}/`],
};

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Installed ${HOST_NAME} for ${browser} at ${manifestPath}`);
