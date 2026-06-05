<script lang="ts">
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import FolderInput from "@lucide/svelte/icons/folder-input";
  import Folder from "@lucide/svelte/icons/folder";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import Minus from "@lucide/svelte/icons/minus";
  import Square from "@lucide/svelte/icons/square";
  import X from "@lucide/svelte/icons/x";
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import WindowResizeHandles from "$lib/components/WindowResizeHandles.svelte";
  import { isCloseWindowShortcut } from "$lib/components/titlebar-shortcuts";
  import {
    formatDataFolderError,
    getDefaultDataFolderLocation,
    importDataFolder,
    pickDataFolderLocation,
    useDefaultDataFolder,
    type DataFolderDefaultLocation,
    type DataFolderInfo,
  } from "$lib/vault/state";

  let {
    initialError = null,
    onReady,
  }: {
    initialError?: string | null;
    onReady: (info: DataFolderInfo) => void;
  } = $props();

  const appWindow = getCurrentWindow();
  const fallbackDefaultPath = import.meta.env.DEV
    ? "Documents/Ganbaru AI Dev"
    : "Documents/Ganbaru AI";
  let defaultLocation = $state<DataFolderDefaultLocation | null>(null);
  let busy = $state<"default" | "change" | "import" | null>(null);
  let error = $state<string | null>(null);
  let isMaximized = $state(true);

  onMount(() => {
    let cleanupResize: (() => void) | undefined;
    function handleGlobalShortcut(event: KeyboardEvent): void {
      if (!isCloseWindowShortcut(event)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      requestQuit();
    }

    error = initialError ? formatDataFolderError(initialError, "startup") : null;
    void loadDefaultLocation();
    void appWindow.isMaximized().then((value) => {
      isMaximized = value;
    });
    void appWindow.onResized(() => {
      void appWindow.isMaximized().then((value) => {
        isMaximized = value;
      });
    }).then((unlisten) => {
      cleanupResize = unlisten;
    });
    window.addEventListener("keydown", handleGlobalShortcut, { capture: true });

    return () => {
      cleanupResize?.();
      window.removeEventListener("keydown", handleGlobalShortcut, { capture: true });
    };
  });

  function requestQuit(): void {
    void invoke("force_quit");
  }

  async function loadDefaultLocation(): Promise<void> {
    try {
      defaultLocation = await getDefaultDataFolderLocation();
    } catch (err) {
      error = formatDataFolderError(err);
    }
  }

  async function chooseDataFolder(mode: "default" | "change" | "import"): Promise<void> {
    if (busy) return;
    busy = mode;
    error = null;
    try {
      const info =
        mode === "default"
          ? await useDefaultDataFolder()
          : mode === "change"
            ? await pickDataFolderLocation()
            : await importDataFolder();
      if (info) onReady(info);
    } catch (err) {
      error = formatDataFolderError(err, mode);
    } finally {
      busy = null;
    }
  }
</script>

<main
  class="setup-shell app-shell relative h-screen w-screen overflow-hidden bg-background text-foreground"
  class:app-rounded={!isMaximized}
>
  <div class="flex h-full min-h-0 flex-col">
    <header
      data-tauri-drag-region
      class="flex h-(--titlebar-h) shrink-0 items-center justify-end bg-background text-foreground"
    >
      <div data-tauri-drag-region class="min-w-0 flex-1 self-stretch"></div>
      <div class="flex h-full">
        <button
          type="button"
          aria-label="Minimize"
          onclick={() => void appWindow.minimize()}
          class="flex h-full w-10 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Minus size={14} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          aria-label={isMaximized ? "Restore" : "Maximize"}
          onclick={() => void appWindow.toggleMaximize()}
          class="flex h-full w-10 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Square size={12} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          aria-label="Close"
          onclick={requestQuit}
          class="flex h-full w-10 items-center justify-center text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground"
        >
          <X size={15} strokeWidth={2} />
        </button>
      </div>
    </header>

    <div class="min-h-0 flex-1 bg-background">
      <section class="h-full overflow-y-auto px-4 min-[560px]:px-8 min-[760px]:px-10">
        <div class="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center gap-7 py-5 min-[760px]:py-8">
          <div class="space-y-2">
            <h1 class="max-w-xl text-2xl font-semibold leading-tight text-foreground min-[560px]:text-3xl">
              Choose where to store your data
            </h1>
            <p class="text-sm leading-6 text-muted-foreground">
              If you are coming from a previous installation, import your existing Ganbaru AI folder.
              {#if defaultLocation?.developmentBuild}
                <br />
                <strong class="font-semibold text-warning">
                  Development build: use the default {defaultLocation.folderName} folder, or choose a copy of your production folder. Do not point dev at your real production data.
                </strong>
              {/if}
            </p>
          </div>

          <div class="grid gap-5">
            <div class="grid gap-2 border-y border-border py-4 min-[560px]:grid-cols-[auto_1fr] min-[560px]:items-start">
              <div class="flex items-center gap-2 text-sm font-medium text-foreground">
                <Folder size={16} strokeWidth={1.8} class="text-muted-foreground" />
                Default location
              </div>
              <p class="break-all text-sm leading-5 text-muted-foreground min-[560px]:text-right">
                {defaultLocation?.path ?? fallbackDefaultPath}
              </p>
            </div>

            <div class="grid gap-2">
              <button
                type="button"
                onclick={() => void chooseDataFolder("default")}
                disabled={busy !== null}
                class="flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {#if busy === "default"}
                  <LoaderCircle size={16} strokeWidth={2} class="animate-spin" />
                {:else}
                  <Folder size={16} strokeWidth={1.8} />
                {/if}
                <span>Use the default folder</span>
              </button>

              <div class="grid gap-2 min-[560px]:grid-cols-2">
                <button
                  type="button"
                  onclick={() => void chooseDataFolder("change")}
                  disabled={busy !== null}
                  class="flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {#if busy === "change"}
                    <LoaderCircle size={16} strokeWidth={2} class="animate-spin" />
                  {:else}
                    <FolderOpen size={16} strokeWidth={1.8} />
                  {/if}
                  <span>Change folder</span>
                </button>

                <button
                  type="button"
                  onclick={() => void chooseDataFolder("import")}
                  disabled={busy !== null}
                  class="flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {#if busy === "import"}
                    <LoaderCircle size={16} strokeWidth={2} class="animate-spin" />
                  {:else}
                    <FolderInput size={16} strokeWidth={1.8} />
                  {/if}
                  <span>Import folder</span>
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
          </div>
        </div>
      </section>
    </div>
  </div>

  <WindowResizeHandles disabled={isMaximized} />
</main>

<style>
  .app-rounded {
    border-radius: var(--content-radius);
  }
</style>
