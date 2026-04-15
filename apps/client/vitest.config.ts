import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      $lib: path.resolve("./src/lib"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/lib/**/*.ts"],
      exclude: ["src/lib/components/ui/**", "**/*.test.ts", "**/*.d.ts"],
    },
  },
});
