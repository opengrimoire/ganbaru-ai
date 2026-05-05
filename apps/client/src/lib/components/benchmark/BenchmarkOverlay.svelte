<script lang="ts">
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import Copy from "@lucide/svelte/icons/copy";
  import Check from "@lucide/svelte/icons/check";
  import { getBenchmarkRunner } from "$lib/stores/benchmarkRunner.svelte";
  import { formatBenchmarkSuiteMarkdown } from "$lib/benchmark/output";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";

  const runner = getBenchmarkRunner();

  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | undefined;

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
    navigator.clipboard.writeText(summaryMarkdown);
    copied = true;
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      copied = false;
    }, 2000);
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
        Phase {runner.running.phase}: {runner.running.step}
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
      class="relative z-10 flex h-[80vh] w-[min(720px,92vw)] flex-col rounded-lg border border-border bg-card shadow-2xl dark:bg-background"
    >
      <header class="flex items-center justify-between border-b border-border px-5 py-3">
        <div>
          <h2 class="text-[14px] font-semibold text-foreground">Benchmark complete</h2>
          <p class="mt-0.5 text-[12px] text-muted-foreground">
            Copy the block below and paste it into <code>docs/PERFORMANCE.md</code>.
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

      <div class="flex-1 overflow-y-auto px-5 py-4">
        <pre
          class="whitespace-pre-wrap rounded-md border border-border bg-muted/30 px-3 py-3 text-[11px] leading-relaxed text-foreground"
          style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace;">{summaryMarkdown}</pre>
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
