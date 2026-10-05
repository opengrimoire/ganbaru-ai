<script lang="ts">
  import {
    beginLazyComponentLoad,
    rejectLazyComponentLoad,
    resolveLazyComponentLoad,
    type LazyComponentLoadState,
  } from "$lib/lazy-component-loader";
  import type { NotesSlashCommand } from "$lib/notes/editor/slash-commands";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import {
    loadNotesTextControl,
    retryNotesTextControl,
    type LoadedNotesTextControl,
  } from "$lib/components/notes/editor-component-registry";

  let {
    onSelect,
  }: {
    onSelect: (command: NotesSlashCommand) => void;
  } = $props();
  const { t } = getLocalization();

  let loadState = $state<LazyComponentLoadState<"slash-menu", LoadedNotesTextControl> | null>(null);

  function request(retry = false): void {
    if (!retry && loadState) return;
    const loadingState = beginLazyComponentLoad(loadState, "slash-menu");
    loadState = loadingState;
    const result = retry
      ? retryNotesTextControl("slash-menu")
      : loadNotesTextControl("slash-menu");
    void result.then((component) => {
      if (!loadState) return;
      loadState = resolveLazyComponentLoad(
        loadState,
        "slash-menu",
        loadingState.requestId,
        component,
      );
    }).catch((error: unknown) => {
      if (!loadState) return;
      loadState = rejectLazyComponentLoad(
        loadState,
        "slash-menu",
        loadingState.requestId,
        error,
      );
      console.error("load Notes slash menu failed", error);
    });
  }

  $effect(() => {
    request();
  });
</script>

{#if loadState?.status === "ready" && loadState.component.kind === "slash-menu"}
  {@const NotesSlashMenu = loadState.component.component}
  <NotesSlashMenu canSetColor={false} {onSelect} />
{:else if loadState?.status === "failed"}
  <button class="min-h-8 rounded-md border border-border px-2 text-[0.8rem] hover:bg-accent" type="button" onclick={() => request(true)}>{t("common.retry")}</button>
{:else}
  <div class="min-h-8" aria-busy="true"></div>
{/if}
