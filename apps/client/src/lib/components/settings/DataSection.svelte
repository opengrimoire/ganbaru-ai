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

  const actionButtonClass =
    "inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md border border-border px-2.5 text-[0.8rem] font-medium transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-55";
  const secondaryButtonClass = `${actionButtonClass} bg-card text-foreground hover:bg-accent dark:bg-transparent`;
  const linkButtonClass =
    "inline-flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-md px-1 text-[0.8rem] font-medium text-foreground transition-colors hover:text-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-55";

  const currentFolderPath = $derived(
    busy === "load"
      ? "Loading folder..."
      : activeDataFolder?.path ?? "No active folder",
  );

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

<div class="flex flex-col gap-6">
  <section class="flex flex-col gap-4">
    <h2 class="px-1 text-[0.866667rem] font-semibold text-foreground">Folder</h2>

    <div class="flex flex-col gap-3">
      <div class="flex items-start justify-between gap-4 px-1 py-1 max-[520px]:flex-col max-[520px]:items-stretch max-[520px]:gap-2">
        <div class="min-w-0 flex-1">
          <div class="text-[0.866667rem] text-foreground">Current folder</div>
          <div class="mt-0.5 wrap-break-word text-[0.8rem] leading-5 text-muted-foreground">
            {currentFolderPath}
          </div>
        </div>
        <button
          type="button"
          onclick={() => void revealDataFolder()}
          disabled={busy !== null || !activeDataFolder}
          class={secondaryButtonClass}
        >
          {#if busy === "reveal"}
            <LoaderCircle size={14} strokeWidth={2.1} class="shrink-0 animate-spin" />
          {:else}
            <FolderOpen size={14} strokeWidth={1.9} class="shrink-0" />
          {/if}
          <span>Reveal</span>
        </button>
      </div>

      <div class="flex items-start justify-between gap-4 px-1 py-1 max-[520px]:flex-col max-[520px]:items-stretch max-[520px]:gap-2">
        <div class="min-w-0 flex-1">
          <div class="text-[0.866667rem] text-foreground">Change folder</div>
          <div class="mt-0.5 text-[0.8rem] leading-5 text-muted-foreground">
            Choose another Ganbaru AI folder and restart
          </div>
        </div>
        <button
          type="button"
          onclick={() => void chooseDataFolder("change")}
          disabled={busy !== null}
          class={secondaryButtonClass}
        >
          {#if busy === "change"}
            <LoaderCircle size={14} strokeWidth={2.1} class="shrink-0 animate-spin" />
          {:else}
            <FolderOpen size={14} strokeWidth={1.9} class="shrink-0" />
          {/if}
          <span>Change folder</span>
        </button>
      </div>

      <div class="flex items-start justify-between gap-4 px-1 py-1 max-[520px]:flex-col max-[520px]:items-stretch max-[520px]:gap-2">
        <div class="min-w-0 flex-1">
          <div class="text-[0.866667rem] text-foreground">Import folder</div>
          <div class="mt-0.5 text-[0.8rem] leading-5 text-muted-foreground">
            Use a Ganbaru AI folder from another installation
          </div>
        </div>
        <button
          type="button"
          onclick={() => void chooseDataFolder("import")}
          disabled={busy !== null}
          class={secondaryButtonClass}
        >
          {#if busy === "import"}
            <LoaderCircle size={14} strokeWidth={2.1} class="shrink-0 animate-spin" />
          {:else}
            <FolderInput size={14} strokeWidth={1.9} class="shrink-0" />
          {/if}
          <span>Import folder</span>
        </button>
      </div>
    </div>
  </section>

  {#if error}
    <div class="h-px bg-border/70" aria-hidden="true"></div>

    <section class="flex flex-col gap-4">
      <h2 class="px-1 text-[0.866667rem] font-semibold text-foreground">Status</h2>
      <div role="alert" class="px-1 text-[0.8rem] leading-5 text-destructive">
        {error}
      </div>
      <button
        type="button"
        onclick={() => void loadDataFolderState()}
        disabled={busy !== null}
        class={linkButtonClass}
      >
        {#if busy === "load"}
          <LoaderCircle size={13} strokeWidth={2.25} class="shrink-0 animate-spin" />
        {:else}
          <HardDrive size={13} strokeWidth={2.25} class="shrink-0" />
        {/if}
        <span>Reload folder status</span>
      </button>
    </section>
  {/if}
</div>
