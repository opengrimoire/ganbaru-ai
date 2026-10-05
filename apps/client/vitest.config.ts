import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import path from "path";

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      "$lib/components/settings/distractions-browser-connection": path.resolve(
        "./src/lib/components/settings/DistractionsBrowserConnectionStatus.svelte",
      ),
      "$lib/components/settings/distractions-desktop-selector": path.resolve(
        "./src/lib/components/settings/DistractionsAppSelector.svelte",
      ),
      "$lib/stores/distractions-usage.svelte": path.resolve(
        "./src/lib/stores/distractions-usage.svelte.ts",
      ),
      $lib: path.resolve("./src/lib"),
    },
    conditions: ["browser"],
  },
  test: {
    include: ["src/**/*.test.ts"],
    setupFiles: ["./test-setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/lib/**/*.ts"],
      exclude: ["src/lib/components/ui/**", "**/*.test.ts", "**/*.d.ts"],
    },
  },
});
