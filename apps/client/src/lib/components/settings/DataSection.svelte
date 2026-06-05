<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import FolderInput from "@lucide/svelte/icons/folder-input";
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import HardDrive from "@lucide/svelte/icons/hard-drive";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import {
    formatDataFolderError,
    getActiveVaultInfo,
    importDataFolder,
    pickDataFolderLocation,
    revealActiveVault,
    type DataFolderInfo,
  } from "$lib/vault/state";

  let activeDataFolder = $state<DataFolderInfo | null>(null);
  let busy = $state<"load" | "reveal" | "change" | "import" | null>("load");
  let error = $state<string | null>(null);

  async function loadDataFolderState(): Promise<void> {
    busy = "load";
    error = null;
    try {
      activeDataFolder = await getActiveVaultInfo();
    } catch (err) {
      error = formatDataFolderError(err, "startup");
    } finally {
      busy = null;
    }
  }

  function restartApp(): void {
    void invoke("restart_app");
  }

  async function revealDataFolder(): Promise<void> {
    busy = "reveal";
    error = null;
    try {
      await revealActiveVault();
    } catch (err) {
      error = formatDataFolderError(err);
    } finally {
      busy = null;
    }
  }

  async function chooseDataFolder(mode: "change" | "import"): Promise<void> {
    busy = mode;
    error = null;
    try {
      const info = mode === "change" ? await pickDataFolderLocation() : await importDataFolder();
      if (info) restartApp();
    } catch (err) {
      error = formatDataFolderError(err, mode);
    } finally {
      busy = null;
    }
  }

  $effect(() => {
    void loadDataFolderState();
  });
</script>

<section class="space-y-6">
  <div class="space-y-1">
    <h2 class="text-base font-semibold">Data</h2>
    <p class="text-sm leading-5 text-muted-foreground">
      Your Ganbaru AI folder contains settings, documents, and app.sqlite.
    </p>
  </div>

  <div class="space-y-3 rounded-lg border border-border bg-card/70 p-4">
    <div class="flex items-start gap-3">
      <span class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
        <HardDrive size={17} strokeWidth={1.8} />
      </span>
      <div class="min-w-0 flex-1">
        <h3 class="text-sm font-semibold">Ganbaru AI folder</h3>
        <p class="mt-1 break-all text-sm text-muted-foreground">
          {activeDataFolder?.path ?? "No active folder"}
        </p>
      </div>
    </div>

    <div class="flex flex-wrap gap-2">
      <button
        type="button"
        onclick={() => void revealDataFolder()}
        disabled={busy !== null || !activeDataFolder}
        class="flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
      >
        {#if busy === "reveal"}
          <LoaderCircle size={15} strokeWidth={2} class="animate-spin" />
        {:else}
          <FolderOpen size={15} strokeWidth={1.8} />
        {/if}
        <span>Reveal</span>
      </button>
      <button
        type="button"
        onclick={() => void chooseDataFolder("change")}
        disabled={busy !== null}
        class="flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
      >
        {#if busy === "change"}
          <LoaderCircle size={15} strokeWidth={2} class="animate-spin" />
        {:else}
          <FolderOpen size={15} strokeWidth={1.8} />
        {/if}
        <span>Change folder and restart</span>
      </button>
      <button
        type="button"
        onclick={() => void chooseDataFolder("import")}
        disabled={busy !== null}
        class="flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {#if busy === "import"}
          <LoaderCircle size={15} strokeWidth={2} class="animate-spin" />
        {:else}
          <FolderInput size={15} strokeWidth={1.8} />
        {/if}
        <span>Import existing folder and restart</span>
      </button>
    </div>
  </div>

  {#if error}
    <p
      role="alert"
      class="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      {error}
    </p>
  {/if}
</section>
