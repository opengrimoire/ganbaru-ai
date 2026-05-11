import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HeldNavigationController,
  type HeldNavigationDirection,
  type HeldNavigationEvent,
} from "./held-navigation";

type Navigation = {
  direction: HeldNavigationDirection;
  source: "key" | "hold-repeat";
};

describe("HeldNavigationController", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls default window timers with the global receiver", () => {
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const guardedSetTimeout = function (
      this: typeof globalThis,
      callback: () => void,
      delayMs?: number,
    ): ReturnType<typeof setTimeout> {
      if (this !== globalThis) throw new TypeError("wrong setTimeout receiver");
      const timer = originalSetTimeout.call(globalThis, callback, delayMs);
      timers.push(timer);
      return timer;
    };
    const guardedClearTimeout = function (
      this: typeof globalThis,
      timer: ReturnType<typeof setTimeout>,
    ): void {
      if (this !== globalThis) throw new TypeError("wrong clearTimeout receiver");
      originalClearTimeout.call(globalThis, timer);
    };

    globalThis.setTimeout = guardedSetTimeout as typeof globalThis.setTimeout;
    globalThis.clearTimeout = guardedClearTimeout as typeof globalThis.clearTimeout;
    try {
      const controller = new HeldNavigationController({
        holdDelayMs: 280,
        repeatMs: 120,
        navigate: () => undefined,
        canRepeat: () => true,
      });

      expect(() => {
        controller.start("ArrowRight", "forward");
        controller.stop("ArrowRight");
      }).not.toThrow();
    } finally {
      for (const timer of timers) originalClearTimeout.call(globalThis, timer);
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  });

  it("keeps a quick key tap to one navigation", () => {
    vi.useFakeTimers();
    const navigations: Navigation[] = [];
    const controller = new HeldNavigationController({
      holdDelayMs: 280,
      repeatMs: 120,
      navigate: (direction, source) => navigations.push({ direction, source }),
      canRepeat: () => true,
    });

    controller.start("ArrowRight", "forward");
    vi.advanceTimersByTime(100);
    controller.stop("ArrowRight");
    vi.advanceTimersByTime(1_000);

    expect(navigations).toEqual([{ direction: "forward", source: "key" }]);
  });

  it("repeats a ready held key at the configured cadence", () => {
    vi.useFakeTimers();
    const navigations: Navigation[] = [];
    const controller = new HeldNavigationController({
      holdDelayMs: 280,
      repeatMs: 120,
      navigate: (direction, source) => navigations.push({ direction, source }),
      canRepeat: () => true,
    });

    controller.start("ArrowRight", "forward");
    vi.advanceTimersByTime(279);
    expect(navigations).toEqual([{ direction: "forward", source: "key" }]);

    vi.advanceTimersByTime(1);
    expect(navigations).toEqual([
      { direction: "forward", source: "key" },
      { direction: "forward", source: "hold-repeat" },
    ]);

    vi.advanceTimersByTime(119);
    expect(navigations).toHaveLength(2);

    vi.advanceTimersByTime(1);
    vi.advanceTimersByTime(120);
    expect(navigations).toEqual([
      { direction: "forward", source: "key" },
      { direction: "forward", source: "hold-repeat" },
      { direction: "forward", source: "hold-repeat" },
      { direction: "forward", source: "hold-repeat" },
    ]);
  });

  it("uses repeated keydown events as a repeat driver", () => {
    let now = 0;
    const timerId = 0 as unknown as ReturnType<typeof setTimeout>;
    const navigations: Navigation[] = [];
    const controller = new HeldNavigationController({
      holdDelayMs: 280,
      repeatMs: 120,
      navigate: (direction, source) => navigations.push({ direction, source }),
      canRepeat: () => true,
      setTimer: () => timerId,
      clearTimer: () => undefined,
      now: () => now,
    });

    controller.start("ArrowRight", "forward");
    now = 279;
    controller.repeatFromKeydown("ArrowRight");
    expect(navigations).toEqual([{ direction: "forward", source: "key" }]);

    now = 280;
    controller.repeatFromKeydown("ArrowRight");
    expect(navigations).toEqual([
      { direction: "forward", source: "key" },
      { direction: "forward", source: "hold-repeat" },
    ]);

    now = 399;
    controller.repeatFromKeydown("ArrowRight");
    expect(navigations).toHaveLength(2);

    now = 400;
    controller.repeatFromKeydown("ArrowRight");
    expect(navigations).toEqual([
      { direction: "forward", source: "key" },
      { direction: "forward", source: "hold-repeat" },
      { direction: "forward", source: "hold-repeat" },
    ]);
  });

  it("skips busy calendar ticks instead of queuing repeats", () => {
    vi.useFakeTimers();
    let ready = false;
    const navigations: Navigation[] = [];
    const events: HeldNavigationEvent[] = [];
    const controller = new HeldNavigationController({
      holdDelayMs: 280,
      repeatMs: 120,
      navigate: (direction, source) => navigations.push({ direction, source }),
      canRepeat: () => ready,
      mark: (event) => events.push(event),
    });

    controller.start("ArrowRight", "forward");
    vi.advanceTimersByTime(280);
    vi.advanceTimersByTime(120);

    expect(navigations).toEqual([{ direction: "forward", source: "key" }]);
    expect(events.filter((event) => event.type === "repeat-skip")).toHaveLength(2);

    ready = true;
    vi.advanceTimersByTime(119);
    expect(navigations).toEqual([{ direction: "forward", source: "key" }]);

    vi.advanceTimersByTime(1);
    expect(navigations).toEqual([
      { direction: "forward", source: "key" },
      { direction: "forward", source: "hold-repeat" },
    ]);
  });

  it("does not navigate later when released during a busy period", () => {
    vi.useFakeTimers();
    let ready = false;
    const navigations: Navigation[] = [];
    const controller = new HeldNavigationController({
      holdDelayMs: 280,
      repeatMs: 120,
      navigate: (direction, source) => navigations.push({ direction, source }),
      canRepeat: () => ready,
    });

    controller.start("ArrowRight", "forward");
    vi.advanceTimersByTime(280);
    controller.stop("ArrowRight");
    ready = true;
    vi.advanceTimersByTime(1_000);

    expect(navigations).toEqual([{ direction: "forward", source: "key" }]);
  });

  it("cancels the previous held sequence when direction changes", () => {
    vi.useFakeTimers();
    const navigations: Navigation[] = [];
    const controller = new HeldNavigationController({
      holdDelayMs: 280,
      repeatMs: 120,
      navigate: (direction, source) => navigations.push({ direction, source }),
      canRepeat: () => true,
    });

    controller.start("ArrowRight", "forward");
    vi.advanceTimersByTime(279);
    controller.start("ArrowLeft", "back");

    expect(navigations).toEqual([
      { direction: "forward", source: "key" },
      { direction: "back", source: "key" },
    ]);

    vi.advanceTimersByTime(1);
    expect(navigations).toHaveLength(2);

    vi.advanceTimersByTime(279);
    expect(navigations).toEqual([
      { direction: "forward", source: "key" },
      { direction: "back", source: "key" },
      { direction: "back", source: "hold-repeat" },
    ]);
  });
});
