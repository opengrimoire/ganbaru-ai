import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HeldNavigationController,
  type HeldNavigationDirection,
  type HeldNavigationEvent,
} from "./held-navigation";

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("HeldNavigationController", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps a quick key tap to one navigation", () => {
    vi.useFakeTimers();
    const navigations: HeldNavigationDirection[] = [];
    const controller = new HeldNavigationController({
      holdDelayMs: 280,
      repeatMs: 120,
      navigate: (direction) => navigations.push(direction),
      waitUntilSettled: () => Promise.resolve(),
    });

    controller.start("ArrowRight", "forward");
    vi.advanceTimersByTime(100);
    controller.stop("ArrowRight");
    vi.advanceTimersByTime(1_000);

    expect(navigations).toEqual(["forward"]);
  });

  it("does not repeat while the previous navigation is still settling", async () => {
    vi.useFakeTimers();
    const settled = deferred();
    const navigations: Array<{ direction: HeldNavigationDirection; source: string }> = [];
    const events: HeldNavigationEvent[] = [];
    const controller = new HeldNavigationController({
      holdDelayMs: 280,
      repeatMs: 120,
      navigate: (direction, source) => navigations.push({ direction, source }),
      waitUntilSettled: () => settled.promise,
      mark: (event) => events.push(event),
    });

    controller.start("ArrowRight", "forward");
    vi.advanceTimersByTime(280);
    await flushPromises();
    vi.advanceTimersByTime(1_000);
    await flushPromises();

    expect(navigations).toEqual([{ direction: "forward", source: "key" }]);
    expect(events.some((event) => event.type === "repeat-wait")).toBe(true);

    settled.resolve();
    await flushPromises();

    expect(navigations).toEqual([
      { direction: "forward", source: "key" },
      { direction: "forward", source: "hold-repeat" },
    ]);
  });

  it("cancels a pending repeat when keyup happens during settle wait", async () => {
    vi.useFakeTimers();
    const settled = deferred();
    const navigations: Array<{ direction: HeldNavigationDirection; source: string }> = [];
    const events: HeldNavigationEvent[] = [];
    const controller = new HeldNavigationController({
      holdDelayMs: 280,
      repeatMs: 120,
      navigate: (direction, source) => navigations.push({ direction, source }),
      waitUntilSettled: () => settled.promise,
      mark: (event) => events.push(event),
    });

    controller.start("ArrowRight", "forward");
    vi.advanceTimersByTime(280);
    await flushPromises();
    controller.stop("ArrowRight");
    settled.resolve();
    await flushPromises();
    vi.advanceTimersByTime(1_000);

    expect(navigations).toEqual([{ direction: "forward", source: "key" }]);
    expect(events).toContainEqual({ type: "repeat-cancelled", key: "ArrowRight", stage: "settle" });
  });

  it("waits for settle before every repeated navigation", async () => {
    vi.useFakeTimers();
    const firstSettle = deferred();
    const secondSettle = deferred();
    const settleWaits = [firstSettle, secondSettle];
    const navigations: Array<{ direction: HeldNavigationDirection; source: string }> = [];
    const controller = new HeldNavigationController({
      holdDelayMs: 280,
      repeatMs: 120,
      navigate: (direction, source) => navigations.push({ direction, source }),
      waitUntilSettled: () => settleWaits.shift()?.promise ?? Promise.resolve(),
    });

    controller.start("ArrowRight", "forward");
    vi.advanceTimersByTime(280);
    await flushPromises();
    firstSettle.resolve();
    await flushPromises();
    vi.advanceTimersByTime(120);
    await flushPromises();

    expect(navigations).toHaveLength(2);

    vi.advanceTimersByTime(1_000);
    await flushPromises();
    expect(navigations).toHaveLength(2);

    secondSettle.resolve();
    await flushPromises();
    expect(navigations).toHaveLength(3);
  });
});
