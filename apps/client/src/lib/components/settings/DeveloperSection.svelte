<script lang="ts">
  import Play from "@lucide/svelte/icons/play";
  import { BENCHMARK_SCENARIOS } from "$lib/benchmark/registry";
  import { STRESS_DURATION_MS } from "$lib/benchmark/types";
  import { getBenchmarkRunner } from "$lib/stores/benchmarkRunner.svelte";

  const runner = getBenchmarkRunner();
  const stressSeconds = Math.round(STRESS_DURATION_MS / 1000);

  function handleRun(scenarioId: string) {
    runner.request(scenarioId);
  }
</script>

<div class="flex flex-col gap-6">
  <header class="px-1">
    <h2 class="text-[13px] font-semibold text-foreground">Developer</h2>
    <p class="mt-0.5 text-[12px] text-muted-foreground">
      Run a programmatic benchmark to measure memory and boot timing on this build. Each scenario
      drives a {stressSeconds}-second stress sequence, samples memory across the full GC-decay
      window, restarts the app, and re-runs the same shape against a synthetic dataset. Total wall
      time is around 11 minutes per run.
    </p>
  </header>

  <div class="divide-y divide-border overflow-hidden rounded-lg bg-card dark:bg-background">
    {#each BENCHMARK_SCENARIOS as scenario (scenario.id)}
      <div class="flex items-start gap-3 px-3 py-3">
        <div class="min-w-0 flex-1">
          <div class="text-[13px] font-medium text-foreground">{scenario.label}</div>
          <p class="mt-0.5 text-[12px] text-muted-foreground">{scenario.description}</p>
          <div class="mt-1 text-[11px] text-muted-foreground">
            Default seed: {scenario.defaultSeedSize.toLocaleString("en")} events.
          </div>
        </div>
        <div class="shrink-0">
          <button
            type="button"
            onclick={() => handleRun(scenario.id)}
            disabled={runner.status !== "idle"}
            class="flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-primary px-2.5 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70"
          >
            <Play size={12} strokeWidth={2.25} />
            <span>Run</span>
          </button>
        </div>
      </div>
    {/each}
  </div>

  {#if runner.status !== "idle"}
    <p class="px-1 text-[12px] text-muted-foreground">
      A benchmark is currently running. Watch the overlay for progress; do not interact with the app
      while it runs.
    </p>
  {/if}
</div>
