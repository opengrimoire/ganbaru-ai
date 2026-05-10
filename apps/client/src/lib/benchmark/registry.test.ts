import { describe, expect, it } from "vitest";
import {
  BENCHMARK_SCENARIOS,
  BENCHMARK_SUITES,
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

  it("keeps suites backed by registered scenarios", () => {
    const scenarioIds = new Set(BENCHMARK_SCENARIOS.map((scenario) => scenario.id));
    for (const suite of BENCHMARK_SUITES) {
      expect(suite.scenarioIds.length).toBeGreaterThan(0);
      for (const scenarioId of suite.scenarioIds) {
        expect(scenarioIds.has(scenarioId)).toBe(true);
      }
    }
    expect(BENCHMARK_SUITES.find((suite) => suite.id === "all")?.scenarioIds)
      .toEqual(BENCHMARK_SCENARIOS.map((scenario) => scenario.id));
  });
});
