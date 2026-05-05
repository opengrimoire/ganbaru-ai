<script lang="ts">
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import Copy from "@lucide/svelte/icons/copy";
  import Check from "@lucide/svelte/icons/check";
  import { getBenchmarkRunner } from "$lib/stores/benchmarkRunner.svelte";
  import { buildBenchmarkSuitePreview, formatBenchmarkSuiteMarkdown } from "$lib/benchmark/output";
  import { SYNTH_VERSION } from "$lib/benchmark/types";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";

  const runner = getBenchmarkRunner();
  const tableWrapClass = "overflow-x-auto rounded-md border border-border";
  const tableClass = "min-w-full border-collapse text-left text-[12px]";
  const thClass = "sticky top-0 whitespace-nowrap border-b border-border bg-muted px-3 py-2 font-medium text-muted-foreground";
  const tdClass = "whitespace-nowrap border-b border-border/70 px-3 py-2 text-foreground";

  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | undefined;

  const summaryPreview = $derived.by(() => {
    if (runner.status !== "summary" || runner.results.length === 0) return null;
    return buildBenchmarkSuitePreview(runner.results, {});
  });

  // Materialize the markdown lazily so the overlay does not recompute every
  // render while the user is just looking at it.
  const summaryMarkdown = $derived.by(() => {
    if (runner.status !== "summary" || runner.results.length === 0) return "";
    return formatBenchmarkSuiteMarkdown(runner.results, {});
  });

  const confirmTitle = $derived(
    runner.pendingMode === "suite" ? "Run all benchmarks?" : "Run benchmark?",
  );
  const confirmMessage = $derived.by(() => {
    const labels = runner.pendingScenarioLabels;
    const prefix = runner.pendingMode === "suite"
      ? `Runs ${labels.length} benchmarks sequentially against isolated databases.`
      : "Restarts the app a few times against an isolated database.";
    const listed = runner.pendingMode === "suite"
      ? `\n\nScenarios:\n${labels.map((label) => `- ${label}`).join("\n")}`
      : "";
    return `${prefix}\nYour real calendar is not touched. A desktop notification fires when the run finishes.${listed}`;
  });

  function copyMarkdown() {
    if (!summaryMarkdown) return;
    void navigator.clipboard.writeText(summaryMarkdown);
    copied = true;
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      copied = false;
    }, 2000);
  }

  function runningDatasetLabel(phase: "A" | "B"): string {
    return phase === "A" ? "base" : `synth-${SYNTH_VERSION}`;
  }
</script>

{#if runner.status === "confirming"}
  <ConfirmDialog
    title={confirmTitle}
    message={confirmMessage}
    confirmLabel="Run (Enter)"
    cancelLabel="Cancel (Esc)"
    onConfirm={() => void runner.confirm()}
    onCancel={() => runner.cancelConfirm()}
  />
{/if}

{#if runner.status === "running" && runner.running}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="fixed inset-0 z-[75] flex items-center justify-center">
    <div class="absolute inset-0 bg-black/60 cursor-not-allowed"></div>
    <div
      class="relative z-10 flex w-[min(520px,90vw)] flex-col gap-4 rounded-lg border border-border bg-card px-6 py-5 shadow-2xl dark:bg-background"
    >
      <div class="flex items-center gap-2.5">
        <LoaderCircle size={16} strokeWidth={2.25} class="animate-spin text-primary" />
        <h2 class="text-[14px] font-semibold text-foreground">
          Running benchmark: {runner.running.scenarioLabel}
        </h2>
      </div>

      <div class="text-[13px] text-foreground">
        {#if runner.running.suite}
          Benchmark {runner.running.suite.index + 1}/{runner.running.suite.total}.
        {/if}
        Dataset: {runningDatasetLabel(runner.running.phase)}. {runner.running.step}
        {#if runner.running.curve}
          <span class="text-muted-foreground"
            >({runner.running.curve.done}/{runner.running.curve.total}: {runner.running.curve.label})</span
          >
        {/if}
      </div>

      <p class="text-[12px] text-muted-foreground">
        Avoid interacting with the app: clicks and key presses can skew the measurements.
        Your real calendar lives on a separate database and stays untouched even if the run is
        interrupted, the app is force-closed, or the system shuts down. Cancel discards the
        partial run and restarts on your real data.
      </p>

      <div class="flex justify-end">
        <button
          type="button"
          onclick={() => void runner.cancel()}
          class="rounded-md border border-border bg-card px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-accent dark:bg-transparent"
        >
          Cancel
        </button>
      </div>
    </div>
  </div>
{/if}

{#if runner.status === "summary" && runner.result}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="fixed inset-0 z-[75] flex items-center justify-center">
    <div class="absolute inset-0 bg-black/60 cursor-not-allowed"></div>
    <div
      class="relative z-10 flex h-[80vh] w-[min(1040px,94vw)] flex-col rounded-lg border border-border bg-card shadow-2xl dark:bg-background"
    >
      <header class="flex items-center justify-between border-b border-border px-5 py-3">
        <div>
          <h2 class="text-[14px] font-semibold text-foreground">Benchmark complete</h2>
          <p class="mt-0.5 text-[12px] text-muted-foreground">
            Review the tables, then copy markdown for an agent to place carefully in the performance record.
          </p>
        </div>
        <button
          type="button"
          onclick={copyMarkdown}
          class="flex items-center gap-1.5 rounded-md border border-border bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          {#if copied}
            <Check size={12} strokeWidth={2.25} />
            <span>Copied</span>
          {:else}
            <Copy size={12} strokeWidth={2.25} />
            <span>Copy markdown</span>
          {/if}
        </button>
      </header>

      <div class="flex-1 space-y-5 overflow-y-auto px-5 py-4">
        {#if summaryPreview}
          <section class="space-y-2">
            <h3 class="text-[13px] font-semibold text-foreground">Index</h3>
            <div class={tableWrapClass}>
              <table class={tableClass}>
                <thead>
                  <tr>
                    <th class={thClass}>Section</th>
                    <th class={thClass}>Output</th>
                    <th class={thClass}>Rows</th>
                  </tr>
                </thead>
                <tbody>
                  {#each summaryPreview.index as row}
                    <tr>
                      <td class={tdClass}>{row.section}</td>
                      <td class={tdClass}>{row.output}</td>
                      <td class={tdClass}>{row.rows}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          </section>

          <section class="space-y-2">
            <h3 class="text-[13px] font-semibold text-foreground">Run metadata</h3>
            <div class={tableWrapClass}>
              <table class={tableClass}>
                <thead>
                  <tr>
                    <th class={thClass}>Run</th>
                    <th class={thClass}>Harness</th>
                    <th class={thClass}>Build ref</th>
                    <th class={thClass}>Platform</th>
                    <th class={thClass}>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td class={tdClass}>{summaryPreview.metadata.run}</td>
                    <td class={tdClass}>{summaryPreview.metadata.harness}</td>
                    <td class={tdClass}>{summaryPreview.metadata.buildRef}</td>
                    <td class={tdClass}>{summaryPreview.metadata.platform}</td>
                    <td class={tdClass}>{summaryPreview.metadata.notes}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {#each summaryPreview.sections as section, sectionIndex (section.id + sectionIndex)}
            <section class="space-y-2">
              <h3 class="text-[13px] font-semibold text-foreground">{section.title}</h3>
              <div class={section.kind === "metrics" ? "space-y-3" : tableWrapClass}>
                {#if section.kind === "startup"}
                  <table class={tableClass}>
                    <thead>
                      <tr>
                        <th class={thClass}>Run</th>
                        <th class={thClass}>Dataset</th>
                        <th class={thClass}>Runs</th>
                        <th class={thClass}>First paint median ms</th>
                        <th class={thClass}>Usable paint median ms</th>
                        <th class={thClass}>Launch min ms</th>
                        <th class={thClass}>Launch P95 ms</th>
                        <th class={thClass}>Launch max ms</th>
                        <th class={thClass}>Launch median ms</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each section.rows as row}
                        <tr>
                          <td class={tdClass}>{row.run}</td>
                          <td class={tdClass}>{row.dataset}</td>
                          <td class={tdClass}>{row.runs}</td>
                          <td class={tdClass}>{row.firstPaintMedianMs}</td>
                          <td class={tdClass}>{row.usablePaintMedianMs}</td>
                          <td class={tdClass}>{row.launchMinMs}</td>
                          <td class={tdClass}>{row.launchP95Ms}</td>
                          <td class={tdClass}>{row.launchMaxMs}</td>
                          <td class={tdClass}>{row.launchMedianMs}</td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                {:else if section.kind === "memory"}
                  <table class={tableClass}>
                    <thead>
                      <tr>
                        <th class={thClass}>Run</th>
                        <th class={thClass}>Dataset</th>
                        <th class={thClass}>Timepoint</th>
                        <th class={thClass}>Backend MB</th>
                        <th class={thClass}>Frontend MB</th>
                        <th class={thClass}>Network MB</th>
                        <th class={thClass}>Total MB</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each section.rows as row}
                        <tr>
                          <td class={tdClass}>{row.run}</td>
                          <td class={tdClass}>{row.dataset}</td>
                          <td class={tdClass}>{row.timepoint}</td>
                          <td class={tdClass}>{row.backendMb}</td>
                          <td class={tdClass}>{row.frontendMb}</td>
                          <td class={tdClass}>{row.networkMb}</td>
                          <td class={tdClass}>{row.totalMb}</td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                {:else}
                  {#if section.latencyRows.length > 0}
                    <div class={tableWrapClass}>
                      <table class={tableClass}>
                        <thead>
                          <tr>
                            <th class={thClass}>Run</th>
                            <th class={thClass}>Dataset</th>
                            <th class={thClass}>Metric</th>
                            <th class={thClass}>Value</th>
                            <th class={thClass}>Unit</th>
                            <th class={thClass}>Runs</th>
                            <th class={thClass}>Min</th>
                            <th class={thClass}>Median</th>
                            <th class={thClass}>P95</th>
                            <th class={thClass}>Max</th>
                          </tr>
                        </thead>
                        <tbody>
                          {#each section.latencyRows as row}
                            <tr>
                              <td class={tdClass}>{row.run}</td>
                              <td class={tdClass}>{row.dataset}</td>
                              <td class={tdClass}>{row.metric}</td>
                              <td class={tdClass}>{row.value}</td>
                              <td class={tdClass}>{row.unit}</td>
                              <td class={tdClass}>{row.runs}</td>
                              <td class={tdClass}>{row.min}</td>
                              <td class={tdClass}>{row.median}</td>
                              <td class={tdClass}>{row.p95}</td>
                              <td class={tdClass}>{row.max}</td>
                            </tr>
                          {/each}
                        </tbody>
                      </table>
                    </div>
                  {/if}
                  {#if section.scalarRows.length > 0}
                    <div class={tableWrapClass}>
                      <table class={tableClass}>
                        <thead>
                          <tr>
                            <th class={thClass}>Run</th>
                            <th class={thClass}>Dataset</th>
                            <th class={thClass}>Metric</th>
                            <th class={thClass}>Value</th>
                            <th class={thClass}>Unit</th>
                          </tr>
                        </thead>
                        <tbody>
                          {#each section.scalarRows as row}
                            <tr>
                              <td class={tdClass}>{row.run}</td>
                              <td class={tdClass}>{row.dataset}</td>
                              <td class={tdClass}>{row.metric}</td>
                              <td class={tdClass}>{row.value}</td>
                              <td class={tdClass}>{row.unit}</td>
                            </tr>
                          {/each}
                        </tbody>
                      </table>
                    </div>
                  {/if}
                  {#if section.latencyRows.length === 0 && section.scalarRows.length === 0}
                    <p class="text-[12px] text-muted-foreground">No primary metrics were captured.</p>
                  {/if}
                {/if}
              </div>
            </section>
          {/each}
        {/if}
      </div>

      <footer class="flex justify-end border-t border-border px-5 py-3">
        <button
          type="button"
          onclick={() => runner.closeSummary()}
          class="rounded-md border border-border bg-card px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-accent dark:bg-transparent"
        >
          Return to your data
        </button>
      </footer>
    </div>
  </div>
{/if}

{#if runner.status === "error"}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="fixed inset-0 z-[75] flex items-center justify-center">
    <div class="absolute inset-0 bg-black/60 cursor-not-allowed"></div>
    <div
      class="relative z-10 flex w-[min(480px,90vw)] flex-col gap-3 rounded-lg border border-border bg-card px-6 py-5 shadow-2xl dark:bg-background"
    >
      <h2 class="text-[14px] font-semibold text-destructive">Benchmark failed</h2>
      <p class="text-[12px] text-foreground">
        {runner.errorMessage ?? "Unknown error."}
      </p>
      <div class="flex justify-end">
        <button
          type="button"
          onclick={() => runner.closeSummary()}
          class="rounded-md border border-border bg-card px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-accent dark:bg-transparent"
        >
          Return to your data
        </button>
      </div>
    </div>
  </div>
{/if}
