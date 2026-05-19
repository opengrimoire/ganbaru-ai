<script lang="ts">
  import Plus from "@lucide/svelte/icons/plus";
  import ClipboardPaste from "@lucide/svelte/icons/clipboard-paste";
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import X from "@lucide/svelte/icons/x";
  import { invoke } from "@tauri-apps/api/core";
  import { getTheme } from "$lib/stores/theme.svelte";
  import { getThemeEditor } from "$lib/stores/themeEditor.svelte";
  import type { ThemeId } from "$lib/stores/themes";
  import type { ThemePreset } from "$lib/data/themePresets";
  import ThemeRow from "./ThemeRow.svelte";
  import ThemePresetPicker from "./ThemePresetPicker.svelte";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";

  const themeStore = getTheme();
  const themeEditor = getThemeEditor();

  let pendingDelete = $state<ThemeId | undefined>(undefined);
  let importOpen = $state(false);
  let importDraft = $state("");
  let importErrors = $state<string[]>([]);
  let presetPickerOpen = $state(false);
  let toast = $state<string | undefined>(undefined);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  const orderedThemes = $derived.by(() => {
    const all = Object.values(themeStore.registry);
    return [
      ...all.filter((t) => themeStore.isBuiltin(t.id)),
      ...all.filter((t) => !themeStore.isBuiltin(t.id)),
    ];
  });

  function flashToast(message: string) {
    toast = message;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast = undefined;
    }, 1800);
  }

  function handleApply(id: ThemeId) {
    themeStore.setTheme(id);
  }

  // Fresh themes (New, Duplicate and edit) open with the edited theme as
  // the active one so the floating panel reflects changes live. Editing an
  // existing user theme also activates it for the same reason and captures
  // a JSON snapshot so cancel can roll back the edits. Built-ins carry no
  // snapshot: they cannot be mutated while the editor is open, so there is
  // nothing to restore.
  async function handleDuplicate(id: ThemeId) {
    const previousActiveId = themeStore.id;
    const newId = await themeStore.duplicateTheme(id);
    if (!newId) return;
    themeStore.setTheme(newId);
    themeEditor.open(newId, { createdFresh: true, previousActiveId });
  }

  function handleOpen(id: ThemeId) {
    const previousActiveId = themeStore.id;
    const isBuiltin = themeStore.isBuiltin(id);
    const snapshot = isBuiltin ? undefined : themeStore.exportTheme(id);
    if (themeStore.id !== id) themeStore.setTheme(id);
    themeEditor.open(id, { snapshot, previousActiveId });
  }

  function handleNew() {
    presetPickerOpen = true;
  }

  async function openEditorForNew(preset?: ThemePreset) {
    const previousActiveId = themeStore.id;
    const newId = await themeStore.createTheme();
    if (preset) {
      await themeStore.applyPreset(newId, preset);
      await themeStore.renameTheme(newId, preset.displayName);
    }
    themeStore.setTheme(newId);
    themeEditor.open(newId, { createdFresh: true, previousActiveId });
  }

  function handlePresetPicked(preset: ThemePreset) {
    presetPickerOpen = false;
    void openEditorForNew(preset);
  }

  function handlePresetBlank() {
    presetPickerOpen = false;
    void openEditorForNew();
  }

  function handlePresetClose() {
    presetPickerOpen = false;
  }

  function handleImportToggle() {
    importOpen = !importOpen;
    importDraft = "";
    importErrors = [];
  }

  async function handlePasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      importDraft = text;
    } catch (err) {
      console.error("clipboard read failed", err);
      importErrors = ["Could not read from clipboard. Paste manually below."];
    }
  }

  async function handleImportFromFile() {
    try {
      const text = await invoke<string | null>("vault_pick_and_read_theme_json");
      if (text === null) return;
      const result = await themeStore.importTheme(text);
      if (!result.ok) {
        importErrors = result.errors;
        importDraft = text;
        return;
      }
      importErrors = [];
      importDraft = "";
      importOpen = false;
      flashToast("Theme imported");
    } catch (err) {
      console.error("import from file failed", err);
      importErrors = [
        err instanceof Error ? err.message : "Could not read the selected file.",
      ];
    }
  }

  async function handleImport() {
    if (importDraft.trim().length === 0) {
      importErrors = ["Paste a theme JSON object first."];
      return;
    }
    const result = await themeStore.importTheme(importDraft);
    if (!result.ok) {
      importErrors = result.errors;
      return;
    }
    importErrors = [];
    importDraft = "";
    importOpen = false;
    flashToast("Theme imported");
  }

  function handleDelete(id: ThemeId) {
    pendingDelete = id;
  }

  function confirmDelete() {
    if (!pendingDelete) return;
    void themeStore.deleteTheme(pendingDelete);
    pendingDelete = undefined;
  }

  function cancelDelete() {
    pendingDelete = undefined;
  }
</script>

<div class="flex flex-col gap-4">
  <header class="flex items-start justify-between gap-3 px-1 max-[520px]:flex-col">
    <div class="min-w-0 flex-1">
      <h2 class="text-[0.866667rem] font-semibold text-foreground">Themes</h2>
      <p class="mt-0.5 text-[0.8rem] text-muted-foreground">
        Apply, duplicate, or edit themes. Built-in themes are read-only; use
        Duplicate to fork one into an editable copy.
      </p>
    </div>
    <div class="flex shrink-0 items-center gap-1.5 max-[520px]:w-full max-[520px]:justify-end">
      <button
        type="button"
        onclick={handleImportToggle}
        class="flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-card px-2.5 text-[0.8rem] font-medium text-foreground transition-colors hover:bg-accent dark:bg-transparent"
      >
        <ClipboardPaste size={12} strokeWidth={2.25} />
        <span>Import</span>
      </button>
      <button
        type="button"
        onclick={handleNew}
        class="flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-primary px-2.5 text-[0.8rem] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        <Plus size={12} strokeWidth={2.25} />
        <span>New theme</span>
      </button>
    </div>
  </header>

  {#if importOpen}
    <div
      class="flex flex-col gap-2 overflow-hidden rounded-lg border border-border bg-card p-3 dark:bg-background"
    >
      <div class="flex items-center justify-between gap-2">
        <span class="text-[0.8rem] font-medium text-foreground">
          Paste theme JSON
        </span>
        <button
          type="button"
          onclick={handleImportToggle}
          aria-label="Close import"
          class="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X size={13} strokeWidth={2} />
        </button>
      </div>
      <textarea
        bind:value={importDraft}
        placeholder={'{\n  "id": "midnight",\n  "displayName": "Midnight",\n  ...\n}'}
        rows={8}
        spellcheck={false}
        class="w-full resize-y rounded-md border border-border bg-background p-2 text-[0.733333rem] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      ></textarea>
      {#if importErrors.length > 0}
        <ul
          class="flex flex-col gap-0.5 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-[0.733333rem] text-destructive"
        >
          {#each importErrors as err}
            <li>{err}</li>
          {/each}
        </ul>
      {/if}
      <div class="flex items-center justify-between gap-2 max-[520px]:flex-col max-[520px]:items-stretch">
        <div class="flex items-center gap-1.5 max-[520px]:flex-wrap">
          <button
            type="button"
            onclick={handlePasteFromClipboard}
            class="rounded-md border border-border bg-card px-2.5 py-1 text-[0.733333rem] text-foreground transition-colors hover:bg-accent dark:bg-transparent"
          >
            Paste from clipboard
          </button>
          <button
            type="button"
            onclick={handleImportFromFile}
            class="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-[0.733333rem] text-foreground transition-colors hover:bg-accent dark:bg-transparent"
          >
            <FolderOpen size={11} strokeWidth={2.25} />
            <span>Open file</span>
          </button>
        </div>
        <button
          type="button"
          onclick={handleImport}
          class="rounded-md border border-border bg-primary px-3 py-1 text-[0.8rem] font-medium text-primary-foreground transition-colors hover:bg-primary/90 max-[520px]:self-end"
        >
          Import
        </button>
      </div>
    </div>
  {/if}

  <div
    class="divide-y divide-border overflow-hidden rounded-lg bg-card dark:bg-background"
  >
    {#each orderedThemes as t (t.id)}
      <ThemeRow
        theme={t}
        isActive={t.id === themeStore.id}
        isBuiltin={themeStore.isBuiltin(t.id)}
        onApply={() => handleApply(t.id)}
        onOpen={() => handleOpen(t.id)}
        onDuplicate={() => handleDuplicate(t.id)}
        onDelete={() => handleDelete(t.id)}
      />
    {/each}
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
  {@const target = themeStore.registry[pendingDelete]}
  <ConfirmDialog
    title="Delete theme"
    message={`Delete "${target?.displayName ?? "this theme"}"? This cannot be undone.`}
    confirmLabel="Delete (Enter)"
    cancelLabel="Cancel (Esc)"
    onConfirm={confirmDelete}
    onCancel={cancelDelete}
  />
{/if}

{#if presetPickerOpen}
  <ThemePresetPicker
    onPick={handlePresetPicked}
    onStartBlank={handlePresetBlank}
    onClose={handlePresetClose}
  />
{/if}
