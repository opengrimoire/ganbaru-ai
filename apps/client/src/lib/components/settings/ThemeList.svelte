<script lang="ts">
  import Upload from "@lucide/svelte/icons/upload";
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import X from "@lucide/svelte/icons/x";
  import Sun from "@lucide/svelte/icons/sun";
  import Moon from "@lucide/svelte/icons/moon";
  import { invoke } from "@tauri-apps/api/core";
  import { getTheme } from "$lib/stores/theme.svelte";
  import { getThemeEditor } from "$lib/stores/themeEditor.svelte";
  import type { ThemeId } from "$lib/stores/themes";
  import ThemeRow from "./ThemeRow.svelte";
  import CustomSelect from "./CustomSelect.svelte";
  import ShortcutDescription from "./ShortcutDescription.svelte";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";

  const themeStore = getTheme();
  const themeEditor = getThemeEditor();

  let pendingDelete = $state<ThemeId | undefined>(undefined);
  let importOpen = $state(false);
  let importDraft = $state("");
  let importErrors = $state<string[]>([]);
  let toast = $state<string | undefined>(undefined);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  const quickToggleShortcuts = ["Mod + Shift + L"] as const;
  const themePickerShortcuts = ["Mod + Shift + T"] as const;

  const orderedThemes = $derived.by(() => {
    const all = Object.values(themeStore.registry);
    return [
      ...all.filter((t) => themeStore.isBuiltin(t.id)),
      ...all.filter((t) => !themeStore.isBuiltin(t.id)),
    ];
  });
  const themeOptions = $derived(
    orderedThemes.map((theme) => ({
      value: theme.id,
      label: theme.displayName,
    })),
  );

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

  function handleQuickToggleLight(id: string) {
    themeStore.setQuickToggleTheme("light", id);
  }

  function handleQuickToggleDark(id: string) {
    themeStore.setQuickToggleTheme("dark", id);
  }

  // Duplicated themes open with the edited theme as the active one so the
  // floating panel reflects changes live. Editing an existing user theme also
  // activates it for the same reason and captures a JSON snapshot so cancel can
  // roll back the edits. Built-ins carry no snapshot: they cannot be mutated
  // while the editor is open, so there is nothing to restore.
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

  async function handleExport(id: ThemeId) {
    const contents = themeStore.exportTheme(id);
    if (!contents) {
      flashToast("Could not export theme");
      return;
    }
    try {
      const saved = await invoke<boolean>("vault_pick_and_write_theme_json", {
        defaultName: `${id}.json`,
        contents,
      });
      if (saved) flashToast("Theme exported");
    } catch (err) {
      console.error("theme export failed", err);
      flashToast("Could not export theme");
    }
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
    </div>
  </header>

  <section
    class="flex items-center justify-between gap-4 px-1 py-1 max-[640px]:flex-col max-[640px]:items-stretch max-[640px]:gap-2"
  >
    <div class="min-w-0 flex-1">
      <h3 class="text-[0.866667rem] font-normal text-foreground">Quick toggle</h3>
      <ShortcutDescription shortcuts={quickToggleShortcuts} />
    </div>
    <div
      class="flex flex-wrap items-center justify-end gap-x-3 gap-y-2 max-[640px]:justify-start"
    >
      <div class="flex items-center gap-1.5">
        <Sun
          size={13}
          strokeWidth={1.75}
          class="shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <CustomSelect
          ariaLabel="Light mode quick toggle theme"
          value={themeStore.quickToggleLightId}
          options={themeOptions}
          onChange={handleQuickToggleLight}
          class="w-36"
        />
      </div>
      <div class="flex items-center gap-1.5">
        <Moon
          size={13}
          strokeWidth={1.75}
          class="shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <CustomSelect
          ariaLabel="Dark mode quick toggle theme"
          value={themeStore.quickToggleDarkId}
          options={themeOptions}
          onChange={handleQuickToggleDark}
          class="w-36"
        />
      </div>
    </div>
  </section>

  <section class="flex flex-col gap-3">
    <div class="px-1">
      <h3 class="text-[0.866667rem] font-normal text-foreground">All themes</h3>
      <ShortcutDescription shortcuts={themePickerShortcuts} />
    </div>

    <div class="flex flex-col">
      {#each orderedThemes as t (t.id)}
        <ThemeRow
          theme={t}
          isActive={t.id === themeStore.id}
          isBuiltin={themeStore.isBuiltin(t.id)}
          onApply={() => handleApply(t.id)}
          onOpen={() => handleOpen(t.id)}
          onDuplicate={() => handleDuplicate(t.id)}
          onExport={() => handleExport(t.id)}
          onDelete={() => handleDelete(t.id)}
        />
      {/each}
      {#if importOpen}
        <div class="px-1 py-1">
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between gap-2">
              <span class="text-[0.8rem] font-medium text-foreground">
                Paste theme JSON
              </span>
              <button
                type="button"
                onclick={handleImportToggle}
                aria-label="Close import"
                data-app-tooltip-disabled="true"
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
        </div>
      {:else}
        <button
          type="button"
          onclick={handleImportToggle}
          class="flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-1 text-[0.866667rem] text-foreground transition-colors hover:bg-accent/25 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Upload
            size={13}
            strokeWidth={1.75}
            class="shrink-0 text-muted-foreground"
          />
          <span>Import theme</span>
        </button>
      {/if}
    </div>
  </section>

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
