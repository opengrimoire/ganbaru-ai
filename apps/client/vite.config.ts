import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "path";
import { fileURLToPath } from "node:url";

const host = process.env.TAURI_DEV_HOST;
const TAURI_DEV_READY_PATH = "/__ganbaru-ai_dev_ready";
const TAURI_BUILD_PLATFORMS = ["linux", "windows", "macos", "android", "ios"] as const;
const ANDROID_WEBVIEW_BUILD_TARGET = "chrome111";
type TauriBuildPlatform = (typeof TAURI_BUILD_PLATFORMS)[number];
type DesktopBuildPlatform = Extract<TauriBuildPlatform, "linux" | "windows" | "macos">;
const TAURI_BUILD_PLATFORM_SET = new Set<string>(TAURI_BUILD_PLATFORMS);
const configDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(configDir, "../..");
const appVersion = readAppVersion();
const buildRef = `${appVersion}+${readGitCommit()}${isGitDirty() ? "-dirty" : ""}`;
const githubRepository = process.env.GANBARU_AI_RELEASE_REPOSITORY ?? "opengrimoire/ganbaru-ai";
const buildPlatform = resolveTauriBuildPlatform(process.env.TAURI_ENV_PLATFORM);
const mobileBuild = buildPlatform === "android" || buildPlatform === "ios";
const androidBuild = buildPlatform === "android";

function hostDesktopBuildPlatform(): DesktopBuildPlatform {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "macos";
  return "linux";
}

function isTauriBuildPlatform(value: string): value is TauriBuildPlatform {
  return TAURI_BUILD_PLATFORM_SET.has(value);
}

function resolveTauriBuildPlatform(value: string | undefined): TauriBuildPlatform {
  if (value === undefined || value.length === 0) return hostDesktopBuildPlatform();
  if (value === "darwin") return "macos";
  if (isTauriBuildPlatform(value)) return value;
  throw new Error(`Unsupported TAURI_ENV_PLATFORM value: ${value}`);
}

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
  if (moduleId.endsWith("/src/lib/chat/code-editor-runtime.ts")) return "chat-editor-runtime";
  if (!moduleId.includes("node_modules")) return undefined;

  const reviewCatalogChunk = reviewCatalogChunkName(moduleId);
  if (reviewCatalogChunk) return reviewCatalogChunk;

  const codeEditorCatalogChunk = codeEditorCatalogChunkName(moduleId);
  if (codeEditorCatalogChunk) return codeEditorCatalogChunk;

  if (isCodeEditorCoreModule(moduleId)) return "chat-editor-runtime";

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

  // Keep other dependencies with their import owners so shared boot helpers
  // cannot pull terminal, Markdown, or review code into vault setup.
  return undefined;
}

function codeEditorCatalogChunkName(moduleId: string): string | undefined {
  if (moduleId.includes("/node_modules/@replit/codemirror-lang-svelte/")) {
    return "chat-editor-language-svelte";
  }
  const languageMatch = moduleId.match(/\/node_modules\/@codemirror\/lang-([^/]+)\//u);
  if (languageMatch?.[1]) return `chat-editor-language-${languageMatch[1]}`;
  const parserMatch = moduleId.match(/\/node_modules\/@lezer\/([^/]+)\//u);
  if (parserMatch?.[1] && !["common", "highlight", "lr"].includes(parserMatch[1])) {
    return `chat-editor-parser-${parserMatch[1]}`;
  }
  const legacyMarker = "/node_modules/@codemirror/legacy-modes/mode/";
  const legacyIndex = moduleId.lastIndexOf(legacyMarker);
  if (legacyIndex >= 0) {
    const relativeModule = moduleId.slice(legacyIndex + legacyMarker.length).split("?", 1)[0] ?? "mode";
    const suffix = relativeModule
      .replace(/\.[^.]+$/u, "")
      .replace(/[^a-zA-Z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .toLowerCase();
    return `chat-editor-language-legacy-${suffix || "mode"}`;
  }
  return undefined;
}

function isCodeEditorCoreModule(moduleId: string): boolean {
  return moduleId.includes("/node_modules/codemirror/")
    || moduleId.includes("/node_modules/@codemirror/autocomplete/")
    || moduleId.includes("/node_modules/@codemirror/commands/")
    || moduleId.includes("/node_modules/@codemirror/language-data/")
    || moduleId.includes("/node_modules/@codemirror/language/")
    || moduleId.includes("/node_modules/@codemirror/lint/")
    || moduleId.includes("/node_modules/@codemirror/search/")
    || moduleId.includes("/node_modules/@codemirror/state/")
    || moduleId.includes("/node_modules/@codemirror/view/")
    || moduleId.includes("/node_modules/@lezer/common/")
    || moduleId.includes("/node_modules/@lezer/highlight/")
    || moduleId.includes("/node_modules/@lezer/lr/")
    || moduleId.includes("/node_modules/crelt/")
    || moduleId.includes("/node_modules/style-mod/")
    || moduleId.includes("/node_modules/w3c-keyname/");
}

function reviewCatalogChunkName(moduleId: string): string | undefined {
  const catalogs = [
    ["/node_modules/@shikijs/langs/dist/", "chat-review-language"],
    ["/node_modules/@shikijs/themes/dist/", "chat-review-theme"],
    ["/node_modules/@pierre/theme/dist/", "chat-review-pierre-theme"],
  ] as const;
  for (const [marker, prefix] of catalogs) {
    const markerIndex = moduleId.lastIndexOf(marker);
    if (markerIndex < 0) continue;
    const relativeModule = moduleId.slice(markerIndex + marker.length).split("?", 1)[0] ?? "module";
    const chunkSuffix = relativeModule
      .replace(/\.[^.]+$/u, "")
      .replace(/[^a-zA-Z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .toLowerCase();
    return `${prefix}-${chunkSuffix || "module"}`;
  }
  return undefined;
}

async function warmTauriDevEntry(server: ViteDevServer): Promise<void> {
  const clientEnvironment = server.environments.client;
  const entry = await clientEnvironment.transformRequest("/src/main.ts");
  if (!entry) throw new Error("Vite did not transform the Tauri development entry");
  const warmupUrls = mobileBuild
    ? [
        "/src/main-mobile.ts",
        "/src/MobileApp.svelte",
        "/src/lib/components/calendar/CalendarView.svelte",
      ]
    : [];
  await Promise.all(warmupUrls.map((url) => clientEnvironment.warmupRequest(url)));
  await server.waitForRequestsIdle();
}

function tauriDevReady(): Plugin {
  let readyPromise: Promise<void> | null = null;
  return {
    name: "ganbaru-ai:tauri-dev-ready",
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

function normalizedBundleModuleId(id: string): string {
  const withoutQuery = id.replaceAll("\\", "/").split("?", 1)[0] ?? id;
  const relative = path.relative(configDir, withoutQuery).replaceAll(path.sep, "/");
  return relative.startsWith("../") ? withoutQuery : relative;
}

function firstUseBundleMetadata(): Plugin {
  return {
    name: "ganbaru-ai:first-use-bundle-metadata",
    apply: "build",
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle)
        .filter((item) => item.type === "chunk")
        .map((chunk) => ({
          fileName: chunk.fileName,
          isEntry: chunk.isEntry,
          facadeModuleId: chunk.facadeModuleId
            ? normalizedBundleModuleId(chunk.facadeModuleId)
            : null,
          imports: [...chunk.imports].sort(),
          dynamicImports: [...chunk.dynamicImports].sort(),
          modules: [...new Set(Object.keys(chunk.modules).map(normalizedBundleModuleId))].sort(),
        }))
        .sort((left, right) => left.fileName.localeCompare(right.fileName));
      this.emitFile({
        type: "asset",
        fileName: "first-use-bundle-metadata.json",
        source: `${JSON.stringify({ schemaVersion: 1, chunks }, null, 2)}\n`,
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
  plugins: [
    tauriDevReady(),
    firstUseBundleMetadata(),
    ...skipSvelteStyleVirtuals(tailwindcss()),
    svelte(),
  ],
  define: {
    __GANBARU_AI_BUILD_REF__: JSON.stringify(buildRef),
    __GANBARU_AI_GITHUB_REPOSITORY__: JSON.stringify(githubRepository),
    __GANBARU_AI_BUILD_PLATFORM__: JSON.stringify(buildPlatform),
  },
  resolve: {
    alias: {
      "$lib/api/profile-image-picker": path.resolve(
        configDir,
        mobileBuild
          ? "src/lib/api/profile-image-picker.mobile.ts"
          : "src/lib/api/profile-image-picker.ts",
      ),
      "$lib/components/settings/SettingsSectionRenderer.svelte": path.resolve(
        configDir,
        mobileBuild
          ? "src/lib/components/settings/SettingsSectionRenderer.mobile.svelte"
          : "src/lib/components/settings/SettingsSectionRenderer.svelte",
      ),
      "$lib/components/settings/settings-detail-registry": path.resolve(
        configDir,
        mobileBuild
          ? "src/lib/components/settings/settings-detail-registry.mobile.ts"
          : "src/lib/components/settings/settings-detail-registry.ts",
      ),
      "$lib/components/settings/doomscrolling-desktop-selector": path.resolve(
        configDir,
        mobileBuild
          ? "src/lib/components/settings/mobile/MobileNoopDoomscrollingDesktopSelector.svelte"
          : "src/lib/components/settings/DoomscrollingAppSelector.svelte",
      ),
      "$lib/components/settings/doomscrolling-browser-connection": path.resolve(
        configDir,
        mobileBuild
          ? "src/lib/components/settings/mobile/MobileNoopDoomscrollingBrowserConnection.svelte"
          : "src/lib/components/settings/DoomscrollingBrowserConnectionStatus.svelte",
      ),
      "$lib/components/settings/mobile-theme-editor-loader": path.resolve(
        configDir,
        mobileBuild
          ? "src/lib/components/settings/mobile-theme-editor-loader.mobile.ts"
          : "src/lib/components/settings/mobile-theme-editor-loader.ts",
      ),
      "$lib/chat/local-execution-ui": path.resolve(
        configDir,
        mobileBuild
          ? "src/lib/chat/local-execution-ui.mobile.ts"
          : "src/lib/chat/local-execution-ui.ts",
      ),
      "$lib/chat/review-diff-loader": path.resolve(
        configDir,
        mobileBuild
          ? "src/lib/chat/review-diff-loader.mobile.ts"
          : "src/lib/chat/review-diff-loader.ts",
      ),
      "$lib/api/db": path.resolve(
        configDir,
        mobileBuild
          ? "src/lib/api/db.mobile.ts"
          : "src/lib/api/db.ts",
      ),
      "$lib/music/platform-library": path.resolve(
        configDir,
        mobileBuild
          ? "src/lib/music/platform-library.mobile.ts"
          : "src/lib/music/platform-library.ts",
      ),
      "$lib/music/platform-paths": path.resolve(
        configDir,
        mobileBuild
          ? "src/lib/music/platform-paths.mobile.ts"
          : "src/lib/music/platform-paths.ts",
      ),
      "$lib/music/music-platform-controls": path.resolve(
        configDir,
        mobileBuild
          ? "src/lib/music/music-platform-controls.mobile.ts"
          : "src/lib/music/music-platform-controls.ts",
      ),
      "$lib/window-sync-transport": path.resolve(
        configDir,
        mobileBuild
          ? "src/lib/window-sync-transport.mobile.ts"
          : "src/lib/window-sync-transport.ts",
      ),
      "$lib/stores/pomodoro-effects.svelte": path.resolve(
        configDir,
        mobileBuild
          ? "src/lib/stores/pomodoro-effects.mobile.svelte.ts"
          : "src/lib/stores/pomodoro-effects.svelte.ts",
      ),
      "$lib/stores/zoom.svelte": path.resolve(
        configDir,
        mobileBuild
          ? "src/lib/stores/zoom.mobile.svelte.ts"
          : "src/lib/stores/zoom.svelte.ts",
      ),
      "$lib/stores/pomodoro-doomscrolling-controller": path.resolve(
        configDir,
        mobileBuild
          ? "src/lib/stores/pomodoro-doomscrolling-controller.mobile.ts"
          : "src/lib/stores/pomodoro-doomscrolling-controller.ts",
      ),
      "$lib/stores/doomscrolling-usage.svelte": path.resolve(
        configDir,
        mobileBuild
          ? "src/lib/stores/doomscrolling-usage.mobile.svelte.ts"
          : "src/lib/stores/doomscrolling-usage.svelte.ts",
      ),
      "$lib/stores/pomodoro-window-coordinator": path.resolve(
        configDir,
        mobileBuild
          ? "src/lib/stores/pomodoro-window-coordinator.mobile.ts"
          : "src/lib/stores/pomodoro-window-coordinator.ts",
      ),
      "$lib/stores/pomodoro-runtime-environment": path.resolve(
        configDir,
        mobileBuild
          ? "src/lib/stores/pomodoro-runtime-environment.mobile.ts"
          : "src/lib/stores/pomodoro-runtime-environment.ts",
      ),
      "$lib/stores/mobile-back-stack.svelte": path.resolve(
        configDir,
        androidBuild
          ? "src/lib/stores/mobile-back-stack.svelte.ts"
          : "src/lib/stores/mobile-back-stack.desktop.ts",
      ),
      "$lib/components/projects/project-component-registry": path.resolve(
        configDir,
        mobileBuild
          ? "src/lib/components/projects/project-component-registry.mobile.ts"
          : "src/lib/components/projects/project-component-registry.ts",
      ),
      "$lib/components/notes/notes-working-markdown-platform": path.resolve(
        configDir,
        mobileBuild
          ? "src/lib/components/notes/notes-working-markdown-platform.mobile.ts"
          : "src/lib/components/notes/notes-working-markdown-platform.ts",
      ),
      "$lib/components/notes/notes-editor-platform-importers": path.resolve(
        configDir,
        mobileBuild
          ? "src/lib/components/notes/notes-editor-platform-importers.mobile.ts"
          : "src/lib/components/notes/notes-editor-platform-importers.ts",
      ),
      "$lib/components/notes/notes-project-platform-importers": path.resolve(
        configDir,
        mobileBuild
          ? "src/lib/components/notes/notes-project-platform-importers.mobile.ts"
          : "src/lib/components/notes/notes-project-platform-importers.ts",
      ),
      "$lib/components/music/MusicSoundtrackAssignmentEditor.svelte": path.resolve(
        configDir,
        mobileBuild
          ? "src/lib/components/mobile/MobileNoopMusicAssignmentEditor.svelte"
          : "src/lib/components/music/MusicSoundtrackAssignmentEditor.svelte",
      ),
      "$lib/components/music/MusicSoundscapeControl.svelte": path.resolve(
        configDir,
        mobileBuild
          ? "src/lib/components/mobile/MobileNoopMusicSoundscapeControl.svelte"
          : "src/lib/components/music/MusicSoundscapeControl.svelte",
      ),
      "$lib/components/music/MusicSoundscapeBuilder.svelte": path.resolve(
        configDir,
        mobileBuild
          ? "src/lib/components/mobile/MobileNoopMusicSoundscapeBuilder.svelte"
          : "src/lib/components/music/MusicSoundscapeBuilder.svelte",
      ),
      "$lib/stores/soundscape.svelte": path.resolve(
        configDir,
        mobileBuild
          ? "src/lib/stores/soundscape.mobile.svelte.ts"
          : "src/lib/stores/soundscape.svelte.ts",
      ),
      "$lib/stores/music-external-controls": path.resolve(
        configDir,
        mobileBuild
          ? "src/lib/stores/music-external-controls.mobile.ts"
          : "src/lib/stores/music-external-controls.ts",
      ),
      "$lib/components/music/builder/MusicItemRepairDialog.svelte": path.resolve(
        configDir,
        mobileBuild
          ? "src/lib/components/mobile/MobileNoopMusicItemRepairDialog.svelte"
          : "src/lib/components/music/builder/MusicItemRepairDialog.svelte",
      ),
      "$lib/components/music/builder/MusicRelinkWizard.svelte": path.resolve(
        configDir,
        mobileBuild
          ? "src/lib/components/mobile/MobileNoopMusicRelinkWizard.svelte"
          : "src/lib/components/music/builder/MusicRelinkWizard.svelte",
      ),
      "$lib/components/projects/ProjectSettingsWorkingFoldersSection.svelte": path.resolve(
        configDir,
        mobileBuild
          ? "src/lib/components/mobile/MobileNoopProjectWorkingFoldersSection.svelte"
          : "src/lib/components/projects/ProjectSettingsWorkingFoldersSection.svelte",
      ),
      "$lib/components/notes/NotesWorkingMarkdownEditor.svelte": path.resolve(
        configDir,
        mobileBuild
          ? "src/lib/components/mobile/MobileNoopNotesWorkingMarkdownEditor.svelte"
          : "src/lib/components/notes/NotesWorkingMarkdownEditor.svelte",
      ),
      "$lib/components/notes/NotesProjectSettingsPanel.svelte": path.resolve(
        configDir,
        mobileBuild
          ? "src/lib/components/mobile/MobileNoopNotesProjectSettingsPanel.svelte"
          : "src/lib/components/notes/NotesProjectSettingsPanel.svelte",
      ),
      $lib: path.resolve("./src/lib"),
      "virtual:ganbaru-ai-platform-entry": path.resolve(
        configDir,
        mobileBuild
          ? "src/main-mobile.ts"
          : "src/main-desktop.ts",
      ),
    },
  },
  clearScreen: false,
  build: {
    target: androidBuild ? ANDROID_WEBVIEW_BUILD_TARGET : undefined,
    cssTarget: androidBuild ? ANDROID_WEBVIEW_BUILD_TARGET : undefined,
    rolldownOptions: {
      preserveEntrySignatures: "allow-extension",
      output: {
        strictExecutionOrder: true,
        codeSplitting: {
          includeDependenciesRecursively: false,
          groups: [
            {
              name: (id) => chunkNameForModule(id) ?? null,
              priority: 10,
            },
          ],
        },
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
  },
});
