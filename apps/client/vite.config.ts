import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "path";
import { fileURLToPath } from "node:url";

const host = process.env.TAURI_DEV_HOST;
const TAURI_DEV_READY_PATH = "/__ganbaruai_dev_ready";
const configDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(configDir, "../..");
const appVersion = readAppVersion();
const buildRef = `${appVersion}+${readGitCommit()}${isGitDirty() ? "-dirty" : ""}`;

function readAppVersion(): string {
  const raw = readFileSync(path.join(configDir, "package.json"), "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed === "object" && parsed !== null && "version" in parsed) {
    const version = parsed.version;
    if (typeof version === "string" && version.length > 0) return version;
  }
  return "0.0.0";
}

function readGitCommit(): string {
  return gitOutput(["rev-parse", "--short", "HEAD"]) ?? "unknown";
}

function isGitDirty(): boolean {
  const status = gitOutput(["status", "--short"]);
  return status !== undefined && status.length > 0;
}

function gitOutput(args: string[]): string | undefined {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

function chunkNameForModule(id: string): string | undefined {
  const moduleId = id.replaceAll("\\", "/");
  if (!moduleId.includes("node_modules")) return undefined;

  if (moduleId.includes("/node_modules/svelte/") || moduleId.includes("/node_modules/esm-env/")) {
    return "vendor-svelte";
  }
  if (
    moduleId.includes("/node_modules/@js-temporal/polyfill/") ||
    moduleId.includes("/node_modules/jsbi/")
  ) {
    return "vendor-temporal";
  }
  if (moduleId.includes("/node_modules/ical.js/")) {
    return "vendor-ical";
  }
  if (moduleId.includes("/node_modules/@tauri-apps/")) {
    return "vendor-tauri";
  }
  if (moduleId.includes("/node_modules/@lucide/svelte/")) {
    return "vendor-icons";
  }

  return "vendor";
}

function svelteFilesWithStyles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "src-tauri") continue;
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...svelteFilesWithStyles(fullPath));
      continue;
    }
    if (!entry.endsWith(".svelte")) continue;
    const source = readFileSync(fullPath, "utf8");
    if (source.includes("<style")) files.push(fullPath);
  }
  return files;
}

function toViteUrl(filePath: string): string {
  const relative = path.relative(configDir, filePath).replaceAll(path.sep, "/");
  return `/${relative}`;
}

async function warmTauriDevEntry(server: ViteDevServer): Promise<void> {
  const urls = [
    "/src/main.ts",
    ...svelteFilesWithStyles(path.join(configDir, "src")).map(toViteUrl),
  ];
  await Promise.all(urls.map((url) => server.transformRequest(url)));
}

function tauriDevReady(): Plugin {
  let readyPromise: Promise<void> | null = null;
  return {
    name: "ganbaruai:tauri-dev-ready",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const requestUrl = req.url ? new URL(req.url, "http://localhost") : null;
        if (requestUrl?.pathname !== TAURI_DEV_READY_PATH) {
          next();
          return;
        }

        readyPromise ??= warmTauriDevEntry(server);
        readyPromise
          .then(() => {
            res.statusCode = 302;
            res.setHeader("Location", "/");
            res.setHeader("Cache-Control", "no-store");
            res.end();
          })
          .catch((error: unknown) => {
            readyPromise = null;
            next(error instanceof Error ? error : new Error(String(error)));
          });
      });
    },
  };
}

/**
 * Skip Svelte component style virtuals (`?svelte&type=style&lang.css`) in
 * Tailwind's transform. None of the project's `<style>` blocks use Tailwind
 * directives, and on cold dev-server requests the Svelte plugin's CSS cache
 * can be empty, so Vite's default loader hands Tailwind the raw `.svelte`
 * source and the CSS parser explodes on JS imports.
 */
function skipSvelteStyleVirtuals(plugins: Plugin[]): Plugin[] {
  for (const plugin of plugins) {
    if (!plugin.name?.startsWith("@tailwindcss/vite:generate")) continue;
    const transform = plugin.transform;
    if (!transform || typeof transform !== "object") continue;
    const original = transform.handler;
    if (typeof original !== "function") continue;
    transform.handler = function (code, id, opts) {
      if (id.includes("?svelte&type=style")) return null;
      return original.call(this, code, id, opts);
    };
  }
  return plugins;
}

export default defineConfig({
  plugins: [tauriDevReady(), ...skipSvelteStyleVirtuals(tailwindcss()), svelte()],
  define: {
    __GANBARUAI_BUILD_REF__: JSON.stringify(buildRef),
  },
  resolve: {
    alias: {
      $lib: path.resolve("./src/lib"),
    },
  },
  clearScreen: false,
  build: {
    rollupOptions: {
      output: {
        manualChunks: chunkNameForModule,
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
    warmup: {
      clientFiles: ["./src/main.ts", "./src/**/*.svelte"],
    },
  },
});
