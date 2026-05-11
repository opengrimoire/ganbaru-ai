import { beforeEach, describe, expect, it, vi } from "vitest";
import { sampleIdleCurve, startPeakSampler } from "./sampler";

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

  it("calls peak timers with the global receiver", async () => {
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    const intervalId = 1 as ReturnType<typeof setInterval>;
    let scheduled = false;
    let cleared = false;

    const guardedSetInterval = function (
      this: typeof globalThis,
      _callback: () => void,
      _delayMs?: number,
    ): ReturnType<typeof setInterval> {
      if (this !== globalThis) throw new TypeError("wrong setInterval receiver");
      scheduled = true;
      return intervalId;
    };
    const guardedClearInterval = function (
      this: typeof globalThis,
      timer: ReturnType<typeof setInterval>,
    ): void {
      if (this !== globalThis) throw new TypeError("wrong clearInterval receiver");
      expect(timer).toBe(intervalId);
      cleared = true;
    };

    invokeMock.mockResolvedValueOnce(memoryReport(64));
    globalThis.setInterval = guardedSetInterval as typeof globalThis.setInterval;
    globalThis.clearInterval = guardedClearInterval as typeof globalThis.clearInterval;
    try {
      const sampler = startPeakSampler();
      await expect(sampler.stop()).resolves.toMatchObject([
        {
          label: "peak",
          totalMb: 64,
        },
      ]);
      expect(scheduled).toBe(true);
      expect(cleared).toBe(true);
    } finally {
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    }
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

describe("sampleIdleCurve", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("calls idle timers with the global receiver", async () => {
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const timeoutId = 1 as ReturnType<typeof setTimeout>;
    let scheduled = false;

    const guardedSetTimeout = function (
      this: typeof globalThis,
      callback: () => void,
      _delayMs?: number,
    ): ReturnType<typeof setTimeout> {
      if (this !== globalThis) throw new TypeError("wrong setTimeout receiver");
      scheduled = true;
      void Promise.resolve().then(callback);
      return timeoutId;
    };

    invokeMock.mockResolvedValueOnce(memoryReport(80));
    globalThis.setTimeout = guardedSetTimeout as typeof globalThis.setTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    try {
      await expect(sampleIdleCurve({ signal: new AbortController().signal })).resolves.toMatchObject([
        {
          label: "+30s",
          totalMb: 80,
        },
      ]);
      expect(scheduled).toBe(true);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  });

  it("clears idle timers with the global receiver on abort", async () => {
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const timeoutId = 1 as ReturnType<typeof setTimeout>;
    let cleared = false;

    const guardedSetTimeout = function (
      this: typeof globalThis,
      _callback: () => void,
      _delayMs?: number,
    ): ReturnType<typeof setTimeout> {
      if (this !== globalThis) throw new TypeError("wrong setTimeout receiver");
      return timeoutId;
    };
    const guardedClearTimeout = function (
      this: typeof globalThis,
      timer: ReturnType<typeof setTimeout>,
    ): void {
      if (this !== globalThis) throw new TypeError("wrong clearTimeout receiver");
      expect(timer).toBe(timeoutId);
      cleared = true;
    };

    const controller = new AbortController();
    globalThis.setTimeout = guardedSetTimeout as typeof globalThis.setTimeout;
    globalThis.clearTimeout = guardedClearTimeout as typeof globalThis.clearTimeout;
    try {
      const curvePromise = sampleIdleCurve({ signal: controller.signal });
      controller.abort();
      await expect(curvePromise).resolves.toEqual([]);
      expect(cleared).toBe(true);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  });
});
