import { describe, expect, it } from "vitest";
import {
  BENCHMARK_SCENARIOS,
  getScenarioMetadataById,
  hasScenarioLoader,
  loadScenarioById,
} from "./registry";

describe("benchmark registry", () => {
  it("keeps lightweight metadata covered by lazy loaders", () => {
    const ids = new Set<string>();
    for (const metadata of BENCHMARK_SCENARIOS) {
      expect(ids.has(metadata.id)).toBe(false);
      ids.add(metadata.id);
      expect(getScenarioMetadataById(metadata.id)).toEqual(metadata);
      expect(hasScenarioLoader(metadata.id)).toBe(true);
    }
  });

  it("does not return metadata or modules for unknown scenarios", async () => {
    expect(getScenarioMetadataById("missing")).toBeUndefined();
    await expect(loadScenarioById("missing")).resolves.toBeUndefined();
  });
});
