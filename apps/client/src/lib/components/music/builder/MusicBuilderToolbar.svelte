<script lang="ts">
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import PanelLeft from "@lucide/svelte/icons/panel-left";
  import type { Snippet } from "svelte";
  import { getLocalization } from "$lib/i18n/translator.svelte";

  let {
    status,
    showPanelButton = false,
    compactPlayerLabel = false,
    locked = false,
    onOpenPanel = () => undefined,
    onOpenPlayer,
    actions,
  }: {
    status: string;
    showPanelButton?: boolean;
    compactPlayerLabel?: boolean;
    locked?: boolean;
    onOpenPanel?: () => void;
    onOpenPlayer: () => void;
    actions?: Snippet;
  } = $props();
  const { t } = getLocalization();
</script>

<div class="flex h-12 shrink-0 items-center justify-between gap-3 px-3">
  <div class:builder-controls-locked={locked} class="flex min-w-0 shrink-0 items-center gap-1.5" inert={locked} aria-disabled={locked}>
    {#if showPanelButton}<button type="button" onclick={onOpenPanel} class="grid h-8 w-8 place-items-center rounded-lg text-foreground hover:bg-secondary" aria-label={t("music.builder.openContextPanel")} title={t("music.builder.openContextPanel")}><PanelLeft size={14} /></button>{/if}
    <button type="button" onclick={onOpenPlayer} class="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-secondary px-2.5 text-[0.7rem]" aria-label={t("music.backToPlayer")} data-music-focus-key="builder:back-to-player"><ChevronLeft size={14} />{compactPlayerLabel ? t("music.returnToPlayerShort") : t("music.backToPlayer")}</button>
  </div>
  <p class="min-w-0 flex-1 truncate text-center text-[0.68rem] font-medium text-muted-foreground" role="status">{status}</p>
  <div class="flex min-w-0 shrink-0 items-center justify-end gap-1.5">{@render actions?.()}</div>
</div>

<style>
  .builder-controls-locked { cursor: not-allowed; opacity: 0.38; }
  .builder-controls-locked :global(*) { cursor: not-allowed !important; }
</style>
