import { describe, expect, it } from "vitest";
import {
  BoundedWindowCache,
  LatestWindowLoadCoordinator,
  type WindowLoadOutcome,
} from "./window-load-coordinator";

type TestDeferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): TestDeferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("LatestWindowLoadCoordinator", () => {
  it("runs only the latest queued request after the active request", async () => {
    const active = deferred<WindowLoadOutcome>();
    const latest = deferred<WindowLoadOutcome>();
    const started: string[] = [];
    const outcomes: string[] = [];
    const waits = new Map<string, TestDeferred<WindowLoadOutcome>>([
      ["a", active],
      ["c", latest],
    ]);
    const coordinator = new LatestWindowLoadCoordinator<string>(async (request) => {
      started.push(request);
      return waits.get(request)?.promise ?? "applied";
    });

    const first = coordinator.enqueue("a", "a");
    const dropped = coordinator.enqueue("b", "b");
    const last = coordinator.enqueue("c", "c");
    dropped.then((outcome) => outcomes.push(`b:${outcome}`));

    await Promise.resolve();
    expect(started).toEqual(["a"]);
    await expect(dropped).resolves.toBe("superseded");
    expect(outcomes).toEqual(["b:superseded"]);

    active.resolve("superseded");
    await expect(first).resolves.toBe("superseded");
    await Promise.resolve();
    expect(started).toEqual(["a", "c"]);

    latest.resolve("applied");
    await expect(last).resolves.toBe("applied");
  });

  it("lets an active runner detect that a newer request superseded it", async () => {
    const active = deferred<WindowLoadOutcome>();
    const supersededChecks = new Map<string, boolean[]>();
    const coordinator = new LatestWindowLoadCoordinator<string>(async (request, isSuperseded) => {
      const checks = supersededChecks.get(request) ?? [];
      supersededChecks.set(request, checks);
      checks.push(isSuperseded());
      await active.promise;
      checks.push(isSuperseded());
      return isSuperseded() ? "superseded" : "applied";
    });

    const first = coordinator.enqueue("a", "a");
    const second = coordinator.enqueue("b", "b");
    active.resolve("applied");

    await expect(first).resolves.toBe("superseded");
    await expect(second).resolves.toBe("applied");
    expect(supersededChecks.get("a")).toEqual([false, true]);
    expect(supersededChecks.get("b")).toEqual([false, false]);
  });

  it("can supersede active work without queueing another request", async () => {
    const active = deferred<WindowLoadOutcome>();
    const supersededChecks: boolean[] = [];
    const coordinator = new LatestWindowLoadCoordinator<string>(async (_request, isSuperseded) => {
      supersededChecks.push(isSuperseded());
      await active.promise;
      supersededChecks.push(isSuperseded());
      return isSuperseded() ? "superseded" : "applied";
    });

    const result = coordinator.enqueue("a", "a");
    coordinator.supersedeActive();
    active.resolve("applied");

    await expect(result).resolves.toBe("superseded");
    expect(supersededChecks).toEqual([false, true]);
    await coordinator.whenIdle();
  });

  it("can supersede active and queued work together", async () => {
    const active = deferred<WindowLoadOutcome>();
    const coordinator = new LatestWindowLoadCoordinator<string>(async (_request, isSuperseded) => {
      await active.promise;
      return isSuperseded() ? "superseded" : "applied";
    });

    const first = coordinator.enqueue("a", "a");
    const second = coordinator.enqueue("b", "b");
    coordinator.supersedePending();
    active.resolve("applied");

    await expect(first).resolves.toBe("superseded");
    await expect(second).resolves.toBe("superseded");
    await coordinator.whenIdle();
  });

  it("resolves when idle after active and queued work finish", async () => {
    const active = deferred<WindowLoadOutcome>();
    const queued = deferred<WindowLoadOutcome>();
    const waits = new Map<string, TestDeferred<WindowLoadOutcome>>([
      ["a", active],
      ["b", queued],
    ]);
    const coordinator = new LatestWindowLoadCoordinator<string>(async (request) =>
      waits.get(request)?.promise ?? "applied"
    );

    void coordinator.enqueue("a", "a");
    void coordinator.enqueue("b", "b");
    let idle = false;
    coordinator.whenIdle().then(() => {
      idle = true;
    });

    active.resolve("applied");
    await Promise.resolve();
    expect(idle).toBe(false);

    queued.resolve("applied");
    await coordinator.whenIdle();
    expect(idle).toBe(true);
  });
});

describe("BoundedWindowCache", () => {
  it("evicts the least recently used entry", () => {
    const cache = new BoundedWindowCache<number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(1);
    cache.set("c", 3);

    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
    expect(cache.has("c")).toBe(true);
  });

  it("can read without changing recency", () => {
    const cache = new BoundedWindowCache<number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.peek("a")).toBe(1);
    cache.set("c", 3);

    expect(cache.has("a")).toBe(false);
    expect(cache.has("b")).toBe(true);
    expect(cache.has("c")).toBe(true);
  });
});
