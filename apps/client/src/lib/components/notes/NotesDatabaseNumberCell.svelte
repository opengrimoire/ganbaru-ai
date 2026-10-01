<script lang="ts">
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { notesDatabasePropertyDisplayText } from "$lib/notes/database-property-display";
  import { notesDatabaseTableCellText, type NotesDatabaseTableColumn } from "$lib/notes/database-table";
  import type { NotesPage } from "$lib/notes/types";

  let { row, column, rowIndex, columnIndex, mutating, onSave, onNavigate, onEditingChange = () => {} }: {
    row: NotesPage;
    column: NotesDatabaseTableColumn;
    rowIndex: number;
    columnIndex: number;
    mutating: boolean;
    onSave: (value: string) => Promise<boolean>;
    onNavigate: (event: KeyboardEvent, rowIndex: number, columnIndex: number) => void;
    onEditingChange?: (editing: boolean) => void;
  } = $props();
  const localization = getLocalization();
  let focused = $state(false);
  let draft = $state("");
  let failed = $state(false);
  const raw = $derived(notesDatabaseTableCellText(row, column));
  const display = $derived(notesDatabasePropertyDisplayText(row, column, localization));

  /** Submit raw scalar text while retaining rejected edits for correction. */
  async function commit(): Promise<void> {
    onEditingChange(false);
    focused = false;
    failed = !(await onSave(draft));
  }
</script>

<input data-table-cell="true" data-row-index={rowIndex} data-column-index={columnIndex}
  class="h-8 w-full min-w-0 rounded-sm border border-transparent bg-transparent px-1 text-foreground outline-none hover:bg-accent/20 focus:bg-accent/20"
  value={focused || failed ? draft : display} inputmode="decimal" aria-label={column.name} disabled={mutating}
  onfocus={() => { if (!failed) draft = raw; focused = true; onEditingChange(true); }}
  oninput={(event) => { draft = event.currentTarget.value; }} onblur={() => { void commit(); }}
  onkeydown={(event) => onNavigate(event, rowIndex, columnIndex)} />
