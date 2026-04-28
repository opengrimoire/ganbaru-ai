<script lang="ts">
  import { onMount } from "svelte";
  import Upload from "@lucide/svelte/icons/upload";
  import Download from "@lucide/svelte/icons/download";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
  import { invoke } from "@tauri-apps/api/core";
  import { getCalendars } from "$lib/stores/calendars.svelte";
  import { getCalendar } from "$lib/stores/calendar.svelte";
  import { parseIcs } from "$lib/calendar/ics/parser";
  import type { Calendar } from "$lib/components/calendar/types";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";

  const calendarsStore = getCalendars();
  const calendarStore = getCalendar();
  const ICS_FILE_FILTER = [{ name: "iCalendar", extensions: ["ics"] }];

  let toast = $state<string | undefined>(undefined);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingDelete = $state<Calendar | undefined>(undefined);
  let counts = $state<Record<string, number>>({});

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

  function basenameFromPath(path: string): string {
    const parts = path.split(/[\\/]/);
    return parts[parts.length - 1] || path;
  }

  async function handleImport() {
    try {
      const picked = await openDialog({
        multiple: false,
        directory: false,
        filters: ICS_FILE_FILTER,
      });
      if (!picked || typeof picked !== "string") return;
      const text = await invoke<string>("vault_read_text", { path: picked });
      const filename = basenameFromPath(picked);

      const parsed = parseIcs(text);
      if (parsed.events.length === 0) {
        flashToast(parsed.warnings[0] ?? "No events found in file.");
        return;
      }

      const targetCalendar = await calendarsStore.findOrCreateImported(filename);
      const summary = await calendarStore.bulkImport(parsed.events, targetCalendar.id);

      const parts: string[] = [];
      if (summary.added) parts.push(`${summary.added} new`);
      if (summary.updated) parts.push(`${summary.updated} updated`);
      if (summary.skippedOlder) parts.push(`${summary.skippedOlder} older skipped`);
      const summaryLine = parts.length > 0 ? parts.join(", ") : "no changes";
      const allWarnings = [...summary.warnings, ...parsed.warnings];
      if (allWarnings.length > 0) {
        for (const w of allWarnings) console.warn("[ics import]", w);
        flashToast(`${summaryLine} (with ${allWarnings.length} warning${allWarnings.length === 1 ? "" : "s"})`);
      } else {
        flashToast(`Imported: ${summaryLine}`);
      }
      await refreshCounts();
    } catch (err) {
      console.error("ics import failed", err);
      flashToast(err instanceof Error ? err.message : "Import failed.");
    }
  }

  async function handleExport(calendar: Calendar) {
    try {
      const target = await saveDialog({
        defaultPath: `${calendar.name.replace(/[^\w.-]+/g, "_")}.ics`,
        filters: ICS_FILE_FILTER,
      });
      if (!target) return;
      const ics = calendarStore.exportCalendarAsIcs(calendar);
      await invoke("vault_write_text", { path: target, contents: ics });
      flashToast("Exported to file.");
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
      flashToast(`Deleted "${target.name}".`);
    } catch (err) {
      console.error("delete calendar failed", err);
      flashToast(err instanceof Error ? err.message : "Delete failed.");
    }
  }

  function cancelDelete() {
    pendingDelete = undefined;
  }
</script>

<div class="flex flex-col gap-6">
  <header class="flex items-start justify-between gap-3 px-1">
    <div class="min-w-0 flex-1">
      <h2 class="text-[13px] font-semibold text-foreground">Calendars</h2>
      <p class="mt-0.5 text-[12px] text-muted-foreground">
        Import a Google Calendar or Outlook .ics file as a separate calendar
        you can delete in one click. Re-importing the same file deduplicates
        by event UID, so it stays safe to test against your real export.
      </p>
    </div>
    <div class="flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        onclick={handleImport}
        class="flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-primary px-2.5 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        <Upload size={12} strokeWidth={2.25} />
        <span>Import .ics</span>
      </button>
    </div>
  </header>

  <div
    class="divide-y divide-border overflow-hidden rounded-lg bg-card dark:bg-background"
  >
    {#each calendarsStore.list as cal (cal.id)}
      <div class="flex items-center gap-3 px-3 py-2.5">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="truncate text-[13px] font-medium text-foreground">
              {cal.name}
            </span>
            <span
              class="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
            >
              {cal.source}
            </span>
          </div>
          <div class="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>{counts[cal.id] ?? 0} event{counts[cal.id] === 1 ? "" : "s"}</span>
            {#if cal.sourceUrl}
              <span class="truncate">from {cal.sourceUrl}</span>
            {/if}
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onclick={() => handleExport(cal)}
            disabled={(counts[cal.id] ?? 0) === 0}
            class="flex h-7 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-[12px] font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 dark:bg-transparent"
          >
            <Download size={12} strokeWidth={2.25} />
            <span>Export</span>
          </button>
          {#if cal.id !== "local"}
            <button
              type="button"
              onclick={() => handleDelete(cal)}
              aria-label={`Delete ${cal.name}`}
              class="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-card text-destructive transition-colors hover:bg-destructive/10 dark:bg-transparent"
            >
              <Trash2 size={12} strokeWidth={2.25} />
            </button>
          {/if}
        </div>
      </div>
    {/each}
  </div>

  {#if toast}
    <div
      class="pointer-events-none fixed bottom-6 left-1/2 z-[80] -translate-x-1/2 rounded-md border border-border bg-popover px-3 py-1.5 text-[12px] text-foreground shadow-lg"
    >
      {toast}
    </div>
  {/if}
</div>

{#if pendingDelete}
  <ConfirmDialog
    title="Delete calendar"
    message={`Delete "${pendingDelete.name}" and all of its ${counts[pendingDelete.id] ?? 0} event(s)? This cannot be undone.`}
    confirmLabel="Delete (Enter)"
    cancelLabel="Cancel (Esc)"
    onConfirm={confirmDelete}
    onCancel={cancelDelete}
  />
{/if}
