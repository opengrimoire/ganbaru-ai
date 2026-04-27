import { defineConfig, type Plugin } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const host = process.env.TAURI_DEV_HOST;

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
  plugins: [...skipSvelteStyleVirtuals(tailwindcss()), svelte()],
  resolve: {
    alias: {
      $lib: path.resolve("./src/lib"),
    },
  },
  clearScreen: false,
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
