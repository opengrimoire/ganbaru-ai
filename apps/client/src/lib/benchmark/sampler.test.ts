import { beforeEach, describe, expect, it, vi } from "vitest";
import { startPeakSampler } from "./sampler";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("$lib/stores/perflog.svelte", () => ({
  perfLog: { entries: [], tracking: false },
  snapshot: () => [],
}));

function memoryReport(totalMb: number) {
  return {
    processes: [
      { name: "backend", mb: 10 },
      { name: "frontend", mb: totalMb - 15 },
      { name: "network", mb: 5 },
    ],
    total_mb: totalMb,
    platform: "Linux",
  };
}

describe("startPeakSampler", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("keeps an in-flight peak sample that resolves after stop", async () => {
    let resolveReport: (value: ReturnType<typeof memoryReport>) => void = () => undefined;
    const reportPromise = new Promise<ReturnType<typeof memoryReport>>((resolve) => {
      resolveReport = resolve;
    });
    invokeMock.mockReturnValueOnce(reportPromise);

    const sampler = startPeakSampler();
    const stopPromise = sampler.stop();
    resolveReport(memoryReport(42));

    await expect(stopPromise).resolves.toMatchObject([
      {
        label: "peak",
        totalMb: 42,
        backendMb: 10,
        frontendMb: 27,
        networkMb: 5,
      },
    ]);
  });

  it("fails instead of returning an empty peak set", async () => {
    invokeMock.mockRejectedValueOnce(new Error("memory unavailable"));

    const sampler = startPeakSampler();

    await expect(sampler.stop()).rejects.toThrow(
      "Peak memory sampling failed after 1 attempt(s): memory unavailable",
    );
  });
});
