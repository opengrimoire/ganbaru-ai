<script lang="ts">
  import CollectionSettings from "$lib/components/collections/CollectionSettings.svelte";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { notesDatabaseDateBoundaryOrder, notesDatabaseIsDateBoundaryValid, notesDatabaseIsTimeZoneValid, type NotesDatabaseDateValue } from "$lib/notes/database/date";
  import { notesDatabaseDateDisplay } from "$lib/notes/database/property-display";
  import { notesDatabaseTableDateValue, type NotesDatabaseTableColumn } from "$lib/notes/database/table";
  import type { NotesPage } from "$lib/notes/types";

  let { row, column, rowIndex, columnIndex, mutating, onSave, onNavigate, onEditingChange = () => {} }: {
    row: NotesPage;
    column: NotesDatabaseTableColumn;
    rowIndex: number;
    columnIndex: number;
    mutating: boolean;
    onSave: (value: NotesDatabaseDateValue | null) => Promise<boolean>;
    onNavigate: (event: KeyboardEvent, rowIndex: number, columnIndex: number) => void;
    onEditingChange?: (editing: boolean) => void;
  } = $props();

  const localization = getLocalization();
  const { t } = localization;
  const date = $derived(notesDatabaseTableDateValue(row, column));
  const text = $derived(notesDatabaseDateDisplay(date, localization, column.displayFormat));
  let anchor: HTMLButtonElement | null = $state(null);
  let expanded = $state(false);
  let saving = $state(false);
  let start = $state("");
  let end = $state("");
  let timeZone = $state("");
  let error = $state<string | null>(null);

  /** Start a bounded local edit of all date fields from the current canonical value. */
  function open(): void {
    if (mutating || saving) return;
    start = date?.start ?? "";
    end = date?.end ?? "";
    timeZone = date?.time_zone ?? "";
    error = null;
    expanded = true;
    onEditingChange(true);
  }

  /** Close the draft editor and allow canonical refresh again. */
  function close(): void {
    expanded = false;
    onEditingChange(false);
  }

  /** Validate explicit fields before applying one canonical date update. */
  async function save(clear = false): Promise<void> {
    if (mutating || saving) return;
    const value: NotesDatabaseDateValue | null = clear ? null : { start: start.trim(), end: end.trim() || null, time_zone: timeZone.trim() || null };
    if (value) {
      if (!notesDatabaseIsDateBoundaryValid(value.start)) { error = t("notes.databaseDateInvalidStart"); return; }
      if (value.end && !notesDatabaseIsDateBoundaryValid(value.end)) { error = t("notes.databaseDateInvalidEnd"); return; }
      if (value.end && notesDatabaseDateBoundaryOrder(value.end) < notesDatabaseDateBoundaryOrder(value.start)) { error = t("notes.databaseDateReversedRange"); return; }
      if (value.time_zone && !notesDatabaseIsTimeZoneValid(value.time_zone)) { error = t("notes.databaseDateInvalidZone"); return; }
    }
    saving = true;
    error = null;
    try {
      if (await onSave(value)) close();
      else error = t("notes.databaseDateSaveFailed");
    } catch (caught: unknown) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally { saving = false; }
  }
</script>

<button bind:this={anchor} data-table-cell="true" data-collection-cell-primary data-row-index={rowIndex} data-column-index={columnIndex}
  type="button" class="flex h-8 w-full min-w-0 items-center rounded-sm px-1 text-left text-foreground outline-none"
  disabled={mutating || saving} aria-label={column.name} aria-haspopup="dialog" aria-expanded={expanded} title={text}
  onclick={open} onkeydown={(event) => { if (event.key !== "Enter" && event.key !== " ") onNavigate(event, rowIndex, columnIndex); }}>
  <span class="min-w-0 truncate">{text || t("notes.databaseTableEmptyCell")}</span>
</button>

{#if expanded}
  <CollectionSettings label={column.name} {anchor} onClose={close}>
    <fieldset disabled={saving || mutating} class="m-0 grid min-w-0 gap-2 border-0 p-1 font-normal">
      <label class="grid gap-1">{t("notes.databaseDateStart")}<input class="h-8 min-w-0 rounded-md border border-border bg-transparent px-2 outline-none" aria-label={t("notes.databaseDateStart")} placeholder={t("notes.databaseDateBoundaryHint")} bind:value={start} /></label>
      <label class="grid gap-1">{t("notes.databaseDateEnd")}<input class="h-8 min-w-0 rounded-md border border-border bg-transparent px-2 outline-none" aria-label={t("notes.databaseDateEnd")} placeholder={t("notes.databaseDateBoundaryHint")} bind:value={end} /></label>
      <label class="grid gap-1">{t("notes.databaseDateTimeZone")}<input class="h-8 min-w-0 rounded-md border border-border bg-transparent px-2 outline-none" aria-label={t("notes.databaseDateTimeZone")} placeholder={t("notes.databaseDateZoneHint")} bind:value={timeZone} /></label>
      {#if error}<p class="text-destructive" role="alert">{error}</p>{/if}
      <div class="flex items-center gap-2">
        <button type="button" class="min-h-8 rounded-md bg-primary px-2 text-primary-foreground disabled:opacity-50" onclick={() => { void save(); }}>{t("notes.databaseDateApply")}</button>
        <button type="button" class="min-h-8 rounded-md px-2 text-muted-foreground hover:bg-accent" disabled={!date} onclick={() => { void save(true); }}>{t("notes.databaseDateClear")}</button>
      </div>
    </fieldset>
  </CollectionSettings>
{/if}
