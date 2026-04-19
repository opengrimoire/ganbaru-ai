<script lang="ts">
  import Plus from "@lucide/svelte/icons/plus";
  import ClipboardPaste from "@lucide/svelte/icons/clipboard-paste";
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import X from "@lucide/svelte/icons/x";
  import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
  import { invoke } from "@tauri-apps/api/core";
  import { getTheme } from "$lib/stores/theme.svelte";
  import type { ThemeId } from "$lib/stores/themes";
  import ThemeRow from "./ThemeRow.svelte";
  import ThemeEditor from "./ThemeEditor.svelte";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";

  const themeStore = getTheme();

  const THEME_FILE_FILTER = [{ name: "Theme JSON", extensions: ["json"] }];

  let mode = $state<"list" | "editor">("list");
  let editingId = $state<ThemeId | undefined>(undefined);
  let pendingDelete = $state<ThemeId | undefined>(undefined);
  let importOpen = $state(false);
  let importDraft = $state("");
  let importErrors = $state<string[]>([]);
  let toast = $state<string | undefined>(undefined);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  // Both built-in and user themes show in the same list, built-ins first so
  // the user can compare the seeds against their derivatives at a glance.
  const orderedThemes = $derived.by(() => {
    const all = Object.values(themeStore.registry);
    return [
      ...all.filter((t) => themeStore.isBuiltin(t.id)),
      ...all.filter((t) => !themeStore.isBuiltin(t.id)),
    ];
  });

  const editingTheme = $derived(
    editingId ? themeStore.registry[editingId] : undefined,
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

  function handleDuplicate(id: ThemeId) {
    const newId = themeStore.duplicateTheme(id);
    if (newId) flashToast("Theme duplicated");
  }

  function handleEdit(id: ThemeId) {
    if (themeStore.isBuiltin(id)) {
      const newId = themeStore.duplicateTheme(id);
      if (!newId) return;
      editingId = newId;
    } else {
      editingId = id;
    }
    mode = "editor";
  }

  async function handleExport(id: ThemeId) {
    const json = themeStore.exportTheme(id);
    if (!json) return;
    try {
      await navigator.clipboard.writeText(json);
      flashToast("Theme JSON copied to clipboard");
    } catch (err) {
      console.error("clipboard write failed", err);
      flashToast("Could not copy to clipboard");
    }
  }

  async function handleExportFile(id: ThemeId) {
    const json = themeStore.exportTheme(id);
    if (!json) return;
    try {
      const target = await saveDialog({
        defaultPath: `${id}.json`,
        filters: THEME_FILE_FILTER,
      });
      if (!target) return;
      await invoke("vault_write_text", { path: target, contents: json });
      flashToast("Theme saved to file");
    } catch (err) {
      console.error("save dialog failed", err);
      flashToast("Could not save theme");
    }
  }

  async function handleImportFromFile() {
    try {
      const picked = await openDialog({
        multiple: false,
        directory: false,
        filters: THEME_FILE_FILTER,
      });
      if (!picked || typeof picked !== "string") return;
      const text = await invoke<string>("vault_read_text", { path: picked });
      const result = themeStore.importTheme(text);
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

  function handleNew() {
    const newId = themeStore.createTheme();
    editingId = newId;
    mode = "editor";
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

  function handleImport() {
    if (importDraft.trim().length === 0) {
      importErrors = ["Paste a theme JSON object first."];
      return;
    }
    const result = themeStore.importTheme(importDraft);
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
    themeStore.deleteTheme(pendingDelete);
    pendingDelete = undefined;
  }

  function cancelDelete() {
    pendingDelete = undefined;
  }

  function exitEditor() {
    mode = "list";
    editingId = undefined;
  }
</script>

{#if mode === "editor" && editingTheme}
  <ThemeEditor theme={editingTheme} onDone={exitEditor} />
{:else}
  <div class="flex flex-col gap-4">
    <header class="flex items-center justify-between gap-2 px-1">
      <div>
        <h2 class="text-[13px] font-semibold text-foreground">Themes</h2>
        <p class="mt-0.5 text-[12px] text-muted-foreground">
          Apply, edit, or import theme JSON. Built-in themes are read-only;
          edit them to spawn an editable duplicate.
        </p>
      </div>
      <div class="flex items-center gap-1.5">
        <button
          type="button"
          onclick={handleImportToggle}
          class="flex h-7 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-[12px] font-medium text-foreground transition-colors hover:bg-accent dark:bg-transparent"
        >
          <ClipboardPaste size={12} strokeWidth={2.25} />
          <span>Import</span>
        </button>
        <button
          type="button"
          onclick={handleNew}
          class="flex h-7 items-center gap-1.5 rounded-md border border-border bg-primary px-2.5 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
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
          <span class="text-[12px] font-medium text-foreground">
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
          class="w-full resize-y rounded-md border border-border bg-background p-2 font-mono text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        ></textarea>
        {#if importErrors.length > 0}
          <ul
            class="flex flex-col gap-0.5 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive"
          >
            {#each importErrors as err}
              <li>{err}</li>
            {/each}
          </ul>
        {/if}
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-1.5">
            <button
              type="button"
              onclick={handlePasteFromClipboard}
              class="rounded-md border border-border bg-card px-2.5 py-1 text-[11px] text-foreground transition-colors hover:bg-accent dark:bg-transparent"
            >
              Paste from clipboard
            </button>
            <button
              type="button"
              onclick={handleImportFromFile}
              class="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-[11px] text-foreground transition-colors hover:bg-accent dark:bg-transparent"
            >
              <FolderOpen size={11} strokeWidth={2.25} />
              <span>Open file</span>
            </button>
          </div>
          <button
            type="button"
            onclick={handleImport}
            class="rounded-md border border-border bg-primary px-3 py-1 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
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
          onEdit={() => handleEdit(t.id)}
          onDuplicate={() => handleDuplicate(t.id)}
          onExport={() => handleExport(t.id)}
          onExportFile={() => handleExportFile(t.id)}
          onDelete={() => handleDelete(t.id)}
        />
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
{/if}

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
