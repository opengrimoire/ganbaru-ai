<script lang="ts">
  import { onMount } from "svelte";
  import Upload from "@lucide/svelte/icons/upload";
  import Download from "@lucide/svelte/icons/download";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import { invoke } from "@tauri-apps/api/core";
  import { getCalendars } from "$lib/stores/calendars.svelte";
  import { getCalendar } from "$lib/stores/calendar.svelte";
  import type { Calendar } from "$lib/components/calendar/types";
  import { calendarDisplayName, calendarImportDate } from "$lib/calendar/calendar-display";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";

  const calendarsStore = getCalendars();
  const calendarStore = getCalendar();

  /**
   * One `.ics` entry as returned by the Rust import command. `name` is
   * always a basename (no directory components) and `contents` is the
   * UTF-8 decoded entry body.
   */
  type IcsZipEntry = { name: string; contents: string };

  /** Aggregate counters used to build the summary toast after an import. */
  type ImportTotals = {
    added: number;
    updated: number;
    skippedOlder: number;
    calendars: number;
    warnings: string[];
  };

  let toast = $state<string | undefined>(undefined);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingDelete = $state<Calendar | undefined>(undefined);
  let counts = $state<Record<string, number>>({});

  /**
   * Live progress reporter for `.ics.zip` imports. `total` is set once
   * the archive entry list resolves; `current` increments before each
   * entry begins. Plain single-file imports leave this undefined and
   * rely on the spinner-only button state.
   */
  let isImporting = $state(false);
  let importProgress = $state<
    { current: number; total: number; label: string } | undefined
  >(undefined);
  let loadingIcsParser: Promise<typeof import("$lib/calendar/ics/parser")> | null = null;

  function loadIcsParser(): Promise<typeof import("$lib/calendar/ics/parser")> {
    loadingIcsParser ??= import("$lib/calendar/ics/parser");
    return loadingIcsParser;
  }

  function flashToast(message: string) {
    toast = message;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast = undefined;
    }, 2400);
  }

  async function refreshCounts() {
    const next: Record<string, number> = {};
    for (const cal of calendarsStore.list) {
      next[cal.id] = await calendarsStore.countEvents(cal.id);
    }
    counts = next;
  }

  onMount(() => {
    void refreshCounts();
  });

  $effect(() => {
    // Re-count whenever the calendars list changes (add/remove).
    calendarsStore.list.length;
    void refreshCounts();
  });

  /**
   * Parse a single `.ics` payload, upsert into a calendar grouping keyed by
   * `groupingFilename`, and fold the result into `totals`. Same code path
   * for plain `.ics` files and individual entries inside `.ics.zip` bundles.
   */
  async function importIcsText(
    text: string,
    groupingFilename: string,
    totals: ImportTotals,
    sourceKind: "import-file" | "import-zip-entry",
  ): Promise<void> {
    const { parseIcs } = await loadIcsParser();
    const parsed = parseIcs(text);
    const hasPreservation = (parsed.preservation?.objects.length ?? 0) > 0;
    if (parsed.events.length === 0 && !hasPreservation) {
      if (parsed.warnings.length > 0) totals.warnings.push(...parsed.warnings);
      return;
    }
    const targetCalendar = await calendarsStore.findOrCreateImported(groupingFilename);
    const summary = await calendarStore.bulkImport(parsed.events, targetCalendar.id, {
      preservation: parsed.preservation,
      sourceName: groupingFilename,
      sourceKind,
    });
    totals.added += summary.added;
    totals.updated += summary.updated;
    totals.skippedOlder += summary.skippedOlder;
    totals.calendars += 1;
    if (summary.warnings.length > 0) totals.warnings.push(...summary.warnings);
    if (parsed.warnings.length > 0) totals.warnings.push(...parsed.warnings);
  }

  function summarizeTotals(totals: ImportTotals): string {
    const parts: string[] = [];
    if (totals.added) parts.push(`${totals.added} new`);
    if (totals.updated) parts.push(`${totals.updated} updated`);
    if (totals.skippedOlder) parts.push(`${totals.skippedOlder} older skipped`);
    const summaryLine = parts.length > 0 ? parts.join(", ") : "no changes";
    if (totals.calendars > 1) {
      return `Imported ${totals.calendars} calendars: ${summaryLine}`;
    }
    return `Imported: ${summaryLine}`;
  }

  async function handleImport() {
    if (isImporting) return;

    isImporting = true;
    try {
      const entries = await invoke<IcsZipEntry[] | null>("vault_pick_and_read_ics_import");
      if (!entries) return;

      const totals: ImportTotals = {
        added: 0,
        updated: 0,
        skippedOlder: 0,
        calendars: 0,
        warnings: [],
      };

      if (entries.length === 0) {
        flashToast("No .ics files found.");
        return;
      }
      importProgress = { current: 0, total: entries.length, label: entries[0].name };
      const sourceKind = entries.length > 1 ? "import-zip-entry" : "import-file";
      for (let i = 0; i < entries.length; i++) {
        importProgress = {
          current: i + 1,
          total: entries.length,
          label: entries[i].name,
        };
        await importIcsText(entries[i].contents, entries[i].name, totals, sourceKind);
      }

      if (totals.calendars === 0) {
        flashToast(totals.warnings[0] ?? "No events found in file.");
        return;
      }

      const summaryLine = summarizeTotals(totals);
      if (totals.warnings.length > 0) {
        for (const w of totals.warnings) console.warn("[ics import]", w);
        flashToast(
          `${summaryLine} (with ${totals.warnings.length} warning${totals.warnings.length === 1 ? "" : "s"})`,
        );
      } else {
        flashToast(summaryLine);
      }
      await refreshCounts();
    } catch (err) {
      console.error("ics import failed", err);
      flashToast(err instanceof Error ? err.message : "Import failed.");
    } finally {
      isImporting = false;
      importProgress = undefined;
    }
  }

  async function handleExport(calendar: Calendar) {
    try {
      const ics = await calendarStore.exportCalendarAsIcs(calendar);
      const displayName = calendarDisplayName(calendar);
      const saved = await invoke<boolean>("vault_pick_and_write_ics_export", {
        defaultName: `${displayName.replace(/[^\w.-]+/g, "_")}.ics`,
        contents: ics,
      });
      if (saved) flashToast("Exported to file.");
    } catch (err) {
      console.error("ics export failed", err);
      flashToast(err instanceof Error ? err.message : "Export failed.");
    }
  }

  function handleDelete(calendar: Calendar) {
    pendingDelete = calendar;
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const target = pendingDelete;
    pendingDelete = undefined;
    try {
      await calendarsStore.remove(target.id);
      await calendarStore.load();
      await refreshCounts();
      flashToast(`Deleted "${calendarDisplayName(target)}".`);
    } catch (err) {
      console.error("delete calendar failed", err);
      flashToast(err instanceof Error ? err.message : "Delete failed.");
    }
  }

  function cancelDelete() {
    pendingDelete = undefined;
  }
</script>

<div class="flex flex-col gap-4">
  <header class="flex items-start justify-between gap-3 px-1 max-[520px]:flex-col">
    <div class="min-w-0 flex-1">
      <h2 class="text-[0.866667rem] font-semibold text-foreground">Calendars</h2>
    </div>
  </header>

  {#if isImporting && importProgress}
    <div
      class="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-[0.8rem] text-muted-foreground"
    >
      <LoaderCircle size={12} strokeWidth={2.25} class="animate-spin" />
      <span class="truncate">
        Importing {importProgress.label}
        {#if importProgress.total > 1}
          ({importProgress.current}/{importProgress.total})
        {/if}
      </span>
    </div>
  {/if}

  <div
    class="divide-y divide-border overflow-hidden rounded-lg bg-card dark:bg-background"
  >
    {#each calendarsStore.list as cal (cal.id)}
      {@const displayName = calendarDisplayName(cal)}
      {@const importDate = calendarImportDate(cal)}
      <div class="flex items-center gap-3 px-3 py-2.5 max-[520px]:flex-col max-[520px]:items-stretch">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="truncate text-[0.866667rem] font-medium text-foreground">
              {displayName}
            </span>
            <span
              class="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[0.666667rem] font-medium uppercase tracking-wide text-muted-foreground"
            >
              {cal.source}
            </span>
          </div>
          <div class="mt-0.5 flex items-center gap-2 text-[0.733333rem] text-muted-foreground">
            <span>{counts[cal.id] ?? 0} event{counts[cal.id] === 1 ? "" : "s"}</span>
            {#if importDate}
              <span>imported {importDate}</span>
            {/if}
          </div>
        </div>
        <div class="flex shrink-0 items-center justify-end gap-1.5">
          <button
            type="button"
            onclick={() => handleExport(cal)}
            disabled={(counts[cal.id] ?? 0) === 0}
            class="flex h-7 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-[0.8rem] font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 dark:bg-transparent"
          >
            <Download size={12} strokeWidth={2.25} />
            <span>Export</span>
          </button>
          {#if cal.id === "local"}
            <button
              type="button"
              disabled
              title="The local calendar can't be deleted"
              aria-label="Local calendar can't be deleted"
              class="flex h-7 w-7 cursor-not-allowed items-center justify-center rounded-md border border-border/60 bg-muted/30 text-muted-foreground/35"
            >
              <Trash2 size={12} strokeWidth={2.25} />
            </button>
          {:else}
            <button
              type="button"
              onclick={() => handleDelete(cal)}
              aria-label={`Delete ${displayName}`}
              class="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-card text-destructive transition-colors hover:bg-destructive/10 dark:bg-transparent"
            >
              <Trash2 size={12} strokeWidth={2.25} />
            </button>
          {/if}
        </div>
      </div>
    {/each}
    <div class="px-3 py-2.5">
      <button
        type="button"
        onclick={handleImport}
        disabled={isImporting}
        class="flex h-8 w-full items-center justify-center gap-2 rounded-md border border-dashed border-border bg-card text-[0.8rem] font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60 dark:bg-transparent"
      >
        {#if isImporting}
          <LoaderCircle size={13} strokeWidth={2.25} class="animate-spin" />
          <span>Importing calendar</span>
        {:else}
          <Upload size={13} strokeWidth={2.25} />
          <span>Import calendar</span>
        {/if}
      </button>
    </div>
  </div>

  {#if toast}
    <div
      class="pointer-events-none fixed bottom-6 left-1/2 z-80 -translate-x-1/2 rounded-md border border-border bg-popover px-3 py-1.5 text-[0.8rem] text-foreground shadow-lg"
    >
      {toast}
    </div>
  {/if}
</div>

{#if pendingDelete}
  <ConfirmDialog
    title="Delete calendar"
    message={`Delete "${calendarDisplayName(pendingDelete)}" and all of its ${counts[pendingDelete.id] ?? 0} event(s)? This cannot be undone.`}
    confirmLabel="Delete (Enter)"
    cancelLabel="Cancel (Esc)"
    onConfirm={confirmDelete}
    onCancel={cancelDelete}
  />
{/if}
