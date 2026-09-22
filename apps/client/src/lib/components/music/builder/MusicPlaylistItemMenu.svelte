<script lang="ts">
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import Check from "@lucide/svelte/icons/check";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import Clock3 from "@lucide/svelte/icons/clock-3";
  import FolderSearch from "@lucide/svelte/icons/folder-search";
  import Info from "@lucide/svelte/icons/info";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import MoreHorizontal from "@lucide/svelte/icons/ellipsis";
  import SlidersHorizontal from "@lucide/svelte/icons/sliders-horizontal";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import type { Component } from "svelte";
  import { getMusicInspectorDetail } from "$lib/api/music-library";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import type { MusicItemListEntry, MusicSnooze, MusicWeight } from "$lib/music/library-contracts";
  import { formatMusicDuration } from "$lib/music/music-builder-presentation";
  import { projectMusicItemMenuLayout } from "$lib/music/music-item-menu-layout";
  import { musicSnoozePreset, type MusicSnoozePreset } from "$lib/music/music-snooze";
  import { portal } from "$lib/utils/portal";

  type Subpanel = "details" | "snooze" | "weight";

  let {
    item,
    playlistName = "",
    context = "playlist",
    showLocationAction = true,
    onShowLocation,
    onSnooze,
    onWeight,
    onRemove,
  }: {
    item: MusicItemListEntry;
    playlistName?: string;
    context?: "playlist" | "source";
    showLocationAction?: boolean;
    onShowLocation: (item: MusicItemListEntry) => Promise<void>;
    onSnooze: (item: MusicItemListEntry, duration: MusicSnoozePreset, everywhere: boolean) => Promise<void>;
    onWeight?: (item: MusicItemListEntry, weight: MusicWeight) => Promise<void>;
    onRemove?: (item: MusicItemListEntry) => Promise<void>;
  } = $props();

  const { t } = getLocalization();
  const snoozePresets = ["day", "week", "month"] as const;
  let trigger = $state<HTMLButtonElement | null>(null);
  let panel = $state<HTMLElement | null>(null);
  let open = $state(false);
  let subpanel = $state<Subpanel | null>(null);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let snoozes = $state<MusicSnooze[]>([]);
  let snoozePlaylistId = $state<string | null>(null);
  let snoozesLoading = $state(false);
  let panelLeft = $state(0);
  let panelTop = $state(0);
  const duration = $derived(formatMusicDuration(item.durationMs));
  const selectedSnooze = $derived.by(() => {
    const now = Date.now();
    const scoped = snoozes.filter((entry) => entry.startsAt <= now && (entry.endsAt === null || entry.endsAt > now)
      && (context === "source" ? entry.scope === "all-playlists" : entry.scope === "playlist" && entry.playlistId === snoozePlaylistId));
    return scoped.length === 1
      ? musicSnoozePreset(scoped[0].startsAt, scoped[0].endsAt, Intl.DateTimeFormat().resolvedOptions().timeZone)
      : null;
  });

  $effect(() => {
    if (!open) return;
    const closeForLayoutChange = (): void => close(false);
    window.addEventListener("resize", closeForLayoutChange);
    window.addEventListener("scroll", closeForLayoutChange, true);
    return () => {
      window.removeEventListener("resize", closeForLayoutChange);
      window.removeEventListener("scroll", closeForLayoutChange, true);
    };
  });

  function toggle(event: MouseEvent): void {
    event.stopPropagation();
    if (open) { close(); return; }
    if (!trigger) return;
    const layout = projectMusicItemMenuLayout({
      anchor: trigger.getBoundingClientRect(),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      panelWidth: 240,
      panelHeight: 250,
    });
    panelLeft = layout.panelLeft;
    panelTop = layout.panelTop;
    error = null;
    subpanel = null;
    open = true;
    queueMicrotask(() => panel?.focus());
  }

  function close(restoreFocus = true): void {
    open = false;
    subpanel = null;
    error = null;
    if (restoreFocus && trigger?.isConnected) queueMicrotask(() => trigger?.focus());
  }

  function showSubpanel(next: Subpanel): void {
    subpanel = next;
    error = null;
    if (next === "snooze") void loadSnoozes();
    queueMicrotask(() => panel?.focus());
  }

  async function loadSnoozes(): Promise<void> {
    snoozesLoading = true;
    try {
      const detail = await getMusicInspectorDetail(item.id);
      if (open && subpanel === "snooze") {
        snoozes = detail.snoozes;
        snoozePlaylistId = detail.memberships.find((entry) => entry.id === item.membershipId)?.playlistId ?? null;
      }
    } catch (cause) {
      if (open && subpanel === "snooze") error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      snoozesLoading = false;
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || !open) return;
    event.preventDefault();
    event.stopPropagation();
    if (subpanel) { subpanel = null; return; }
    close();
  }

  async function run(action: () => Promise<void>, closeAfter = true): Promise<void> {
    if (busy) return;
    busy = true;
    error = null;
    try {
      await action();
      if (closeAfter) close(false);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      busy = false;
    }
  }

  function weightLabel(weight: MusicWeight | null): string {
    return t(`music.builder.weight.${weight ?? "normal"}`);
  }

  function subpanelTitle(value: Subpanel): string {
    if (value === "details") return t("music.builder.details");
    if (value === "snooze") return t("music.builder.snoozeTrack");
    return t("music.builder.frequency");
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="pointer-events-auto relative z-10">
  <button bind:this={trigger} type="button" class="menu-trigger" aria-label={t("music.builder.trackActions", item.title)} aria-expanded={open} aria-haspopup="dialog" onclick={toggle}><MoreHorizontal size={15} strokeWidth={1.7} /></button>

  {#if open}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div use:portal class="fixed inset-0 z-70" onclick={() => close(false)}></div>
    <div
      bind:this={panel}
      use:portal
      class="menu-panel fixed z-80 w-60 max-w-[calc(100vw-0.75rem)] overflow-y-auto"
      style={`left:${panelLeft}px;top:${panelTop}px;max-height:calc(100vh - ${panelTop + 6}px)`}
      role="dialog"
      tabindex="-1"
      aria-label={subpanel ? subpanelTitle(subpanel) : t("music.builder.trackActions", item.title)}
      data-app-shortcuts="ignore"
    >
      {#if subpanel}
        <div class="flex items-center gap-1.5 border-b border-border/60 p-1.5">
          <button type="button" class="back-button" aria-label={t("music.builder.back")} onclick={() => subpanel = null}><ArrowLeft size={14} /></button>
          <span class="min-w-0">
            <strong class="block text-[0.72rem] font-semibold">{subpanelTitle(subpanel)}</strong>
            <span class="block truncate text-[0.6rem] text-muted-foreground">{item.title}</span>
          </span>
        </div>
      {:else}
        <div class="border-b border-border/60 px-2.5 py-2">
          <strong class="block truncate text-[0.72rem] font-semibold">{item.title}</strong>
          <span class="mt-0.5 block truncate text-[0.62rem] text-muted-foreground">{item.artist || t("music.builder.noArtist")}</span>
        </div>
      {/if}

      <div class="grid p-1">
        {#if subpanel === "details"}
          <dl class="grid gap-0.5">
            {@render metadataRow(item.sourceKind === "local-file" ? t("music.builder.artistOnly") : t("music.builder.artist"), item.artist || t("music.builder.noArtist"))}
            {@render metadataRow(t("music.builder.album"), item.album || t("music.builder.noAlbum"))}
            {#if duration}{@render metadataRow(t("music.builder.duration"), duration)}{/if}
            {@render metadataRow(t("music.builder.sources"), item.sourceKind === "local-file" ? t("music.builder.local") : t("music.builder.youtube"))}
          </dl>
        {:else if subpanel === "snooze"}
          {#each snoozePresets as snoozeDuration (snoozeDuration)}
            <button type="button" class="option-row" disabled={snoozesLoading} aria-pressed={selectedSnooze === snoozeDuration} onclick={() => { void run(() => onSnooze(item, snoozeDuration, context === "source")); }}>{t(`music.preferences.${snoozeDuration}`)}</button>
          {/each}
        {:else if subpanel === "weight"}
          {#each ["rarely", "less-often", "normal", "more-often", "much-more-often"] as weight (weight)}
            {@const typedWeight = weight as MusicWeight}
            <button type="button" class="option-row" onclick={() => { if (onWeight) void run(() => onWeight(item, typedWeight)); }}><span>{weightLabel(typedWeight)}</span>{#if item.membershipWeight === typedWeight}<Check size={12} />{/if}</button>
          {/each}
        {:else}
          {@render panelRow(t("music.builder.details"), item.album || t("music.builder.noAlbum"), Info, "details")}
          {@render panelRow(t("music.builder.snoozeTrack"), item.activeSnoozeCount > 0 ? t("music.builder.snoozed") : "", Clock3, "snooze")}
          {#if context === "playlist"}{@render panelRow(t("music.builder.frequency"), weightLabel(item.membershipWeight), SlidersHorizontal, "weight")}{/if}
          {#if item.sourceKind === "local-file" && showLocationAction}
            <button type="button" class="action-row" disabled={busy} onclick={() => { void run(() => onShowLocation(item)); }}><FolderSearch size={14} />{t("music.itemMenu.showLocation")}</button>
          {/if}
          {#if context === "playlist" && onRemove}
            <div class="my-1 border-t border-border/60"></div>
            <button type="button" class="action-row text-destructive" disabled={busy} onclick={() => { void run(() => onRemove(item)); }}><Trash2 size={14} />{t("music.builder.removeFromPlaylist", playlistName)}</button>
          {/if}
        {/if}
      </div>

      {#if busy}<div class="absolute inset-0 grid place-items-center rounded-lg bg-card/75"><LoaderCircle class="animate-spin motion-reduce:animate-none" size={16} /></div>{/if}
      {#if error}<p class="mx-1 mb-1 rounded-md bg-destructive/10 px-2 py-1.5 text-[0.62rem] text-destructive" role="alert">{error}</p>{/if}
    </div>
  {/if}
</div>

{#snippet panelRow(label: string, value: string, Icon: Component, target: Subpanel)}
  <button type="button" class="panel-row" onclick={() => showSubpanel(target)}>
    <Icon size={14} class="text-muted-foreground" />
    <span class="min-w-0 flex-1 truncate">{label}</span>
    <span class="max-w-20 truncate text-[0.6rem] text-muted-foreground">{value}</span>
    <ChevronRight size={12} class="text-muted-foreground" />
  </button>
{/snippet}

{#snippet metadataRow(label: string, value: string)}
  <div class="grid grid-cols-[4rem_minmax(0,1fr)] gap-2 rounded-md px-2 py-1.5 text-[0.65rem]"><dt class="text-muted-foreground">{label}</dt><dd class="truncate text-right" title={value}>{value}</dd></div>
{/snippet}

<style>
  .menu-trigger { display: grid; height: 1.75rem; width: 1.75rem; place-items: center; border-radius: 0.375rem; color: var(--muted-foreground); opacity: 0.7; }
  .menu-trigger:hover, .menu-trigger:focus-visible, .menu-trigger[aria-expanded="true"] { background: var(--accent); color: var(--accent-foreground); opacity: 1; outline: none; }
  .menu-panel { border: 1px solid var(--border); border-radius: 0.5rem; background: var(--popover); color: var(--popover-foreground); box-shadow: 0 10px 28px color-mix(in srgb, black 18%, transparent); outline: none; }
  .back-button { display: grid; height: 1.75rem; width: 1.75rem; flex: none; place-items: center; border-radius: 0.375rem; color: var(--muted-foreground); }
  .back-button:hover, .back-button:focus-visible { background: var(--accent); color: var(--accent-foreground); outline: none; }
  .panel-row { display: grid; min-height: 2rem; width: 100%; grid-template-columns: 1.25rem minmax(0,1fr) auto 0.9rem; align-items: center; gap: 0.35rem; border-radius: 0.375rem; padding-inline: 0.45rem; text-align: left; font-size: calc(0.68rem * var(--type-scale)); }
  .panel-row:hover, .panel-row:focus-visible { background: var(--accent); outline: none; }
  .action-row { display: flex; min-height: 2rem; width: 100%; align-items: center; gap: 0.6rem; border-radius: 0.375rem; padding-inline: 0.45rem; text-align: left; font-size: calc(0.68rem * var(--type-scale)); }
  .action-row:hover, .action-row:focus-visible { background: var(--accent); outline: none; }
  .action-row:disabled { opacity: 0.5; }
  .option-row { display: flex; min-height: 2rem; width: 100%; align-items: center; justify-content: space-between; gap: 0.5rem; border-radius: 0.375rem; padding-inline: 0.5rem; text-align: left; font-size: calc(0.68rem * var(--type-scale)); }
  .option-row:hover, .option-row:focus-visible { background: var(--accent); outline: none; }
  .option-row[aria-pressed="true"] { background: color-mix(in srgb, var(--primary) 15%, var(--accent)); }
  .option-row:disabled { opacity: 0.5; }
</style>
