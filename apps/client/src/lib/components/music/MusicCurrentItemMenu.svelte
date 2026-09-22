<script lang="ts">
  import { onMount } from "svelte";
  import Check from "@lucide/svelte/icons/check";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import FolderSearch from "@lucide/svelte/icons/folder-search";
  import ListPlus from "@lucide/svelte/icons/list-plus";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import MoreHorizontal from "@lucide/svelte/icons/ellipsis";
  import {
    bulkEditMusicMemberships,
    getMusicMembershipMatrix,
    getMusicPlaylistSummaries,
  } from "$lib/api/music-library";
  import { revealLocalFile } from "$lib/api/music";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { notifyMusicLibraryChanged } from "$lib/music/music-library-events";
  import type { MusicPlaylistSummary } from "$lib/music/library-contracts";
  import { systemMusicPlaylistName } from "$lib/music/music-system-playlists";
  import { getMusicPlayer } from "$lib/stores/music-player.svelte";

  let {
    onOpenItem,
    onOpenPlaylists,
    active = true,
  }: {
    onOpenItem: (itemId: string) => void;
    onOpenPlaylists: () => void;
    active?: boolean;
  } = $props();
  const { t } = getLocalization();
  const player = getMusicPlayer();
  let root = $state<HTMLElement | null>(null);
  let trigger = $state<HTMLButtonElement | null>(null);
  let open = $state(false);
  let addOpen = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let playlists = $state<MusicPlaylistSummary[]>([]);
  let membershipPlaylistIds = $state<Set<string>>(new Set());

  const queueIndex = $derived(player.currentQueueIndex);
  const itemId = $derived(queueIndex >= 0 ? player.activeQueueItemIds[queueIndex] ?? null : null);
  const source = $derived(player.currentSource);
  const available = $derived(Boolean(source));

  $effect(() => {
    itemId;
    open = false;
    addOpen = false;
    error = null;
  });

  $effect(() => {
    if (!active) close();
  });

  onMount(() => {
    const pointer = (event: PointerEvent) => {
      if (active && open && event.target instanceof Node && root && !root.contains(event.target)) close();
    };
    const key = (event: KeyboardEvent) => {
      if (active && open && event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        trigger?.focus();
      }
    };
    window.addEventListener("pointerdown", pointer);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", pointer);
      window.removeEventListener("keydown", key, true);
    };
  });

  async function toggle(): Promise<void> {
    open = !open;
    if (!open || !itemId) return;
    busy = true;
    error = null;
    try {
      const [summaries, matrix] = await Promise.all([
        getMusicPlaylistSummaries(Date.now(), 0, 500),
        getMusicMembershipMatrix([itemId]),
      ]);
      playlists = summaries;
      membershipPlaylistIds = new Set(matrix.map((entry) => entry.playlistId));
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      busy = false;
    }
  }

  function activate(): void {
    if (!available) {
      onOpenPlaylists();
      return;
    }
    void toggle();
  }

  function close(): void {
    open = false;
    addOpen = false;
  }

  async function addToPlaylist(playlistId: string): Promise<void> {
    if (!itemId || membershipPlaylistIds.has(playlistId)) return;
    await run(async () => {
      await bulkEditMusicMemberships({
        actionId: crypto.randomUUID(),
        itemIds: [itemId],
        addPlaylistIds: [playlistId],
        removePlaylistIds: [],
        weightPlaylistIds: [],
        weight: null,
        updatedAt: Date.now(),
      });
      membershipPlaylistIds = new Set([...membershipPlaylistIds, playlistId]);
      notifyMusicLibraryChanged();
    });
  }

  async function showLocation(): Promise<void> {
    if (source?.kind !== "local-file") return;
    await run(() => revealLocalFile(source.path));
  }

  function openItem(): void {
    if (!itemId) return;
    close();
    onOpenItem(itemId);
  }

  async function run(action: () => Promise<void>): Promise<void> {
    if (busy) return;
    busy = true;
    error = null;
    try {
      await action();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      busy = false;
    }
  }
</script>

<div bind:this={root} class="relative">
  <button bind:this={trigger} type="button" onclick={activate} class="inline-flex h-9 w-9 items-center justify-center rounded-md bg-secondary text-secondary-foreground transition-colors hover:bg-accent" aria-label={available ? t("music.itemMenu.actions") : t("music.launcher.playlists")} aria-expanded={open} aria-haspopup={available ? "menu" : undefined}><MoreHorizontal size={15} /></button>
  {#if open}
    <div role="menu" aria-label={t("music.itemMenu.actions")} class="absolute bottom-[calc(100%+0.45rem)] right-0 z-40 max-h-[calc(100vh-1rem)] w-[min(20rem,calc(100vw-1rem))] overflow-y-auto rounded-xl border border-border/80 bg-popover p-1.5 text-popover-foreground shadow-md">
      {#if busy && playlists.length === 0}<div class="flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground"><LoaderCircle class="animate-spin motion-reduce:animate-none" size={14} />{t("music.itemMenu.loading")}</div>{/if}
      {#if error}<p class="m-1 rounded-md bg-destructive/10 px-2.5 py-2 text-[0.68rem] text-destructive" role="alert">{error}</p>{/if}
      {#if itemId}
        <button type="button" role="menuitem" onclick={() => addOpen = !addOpen} aria-expanded={addOpen} class="menu-action"><ListPlus size={14} />{t("music.itemMenu.addToPlaylist")}</button>
        {#if addOpen}
          <div class="mx-1 mb-1 max-h-40 overflow-y-auto rounded-lg bg-secondary/55 p-1">
            {#if playlists.length === 0}<p class="px-2 py-2 text-[0.68rem] text-muted-foreground">{t("music.itemMenu.noPlaylists")}</p>{/if}
            {#each playlists as playlist (playlist.id)}<button type="button" onclick={() => { void addToPlaylist(playlist.id); }} disabled={membershipPlaylistIds.has(playlist.id) || busy} class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[0.68rem] hover:bg-accent disabled:opacity-60"><span class="min-w-0 flex-1 truncate">{systemMusicPlaylistName(playlist.id, playlist.name, t)}</span>{#if membershipPlaylistIds.has(playlist.id)}<Check size={12} />{/if}</button>{/each}
          </div>
        {/if}
        <button type="button" role="menuitem" onclick={openItem} class="menu-action"><ExternalLink size={14} />{t("music.itemMenu.openInBuilder")}</button>
      {/if}
      {#if source?.kind === "local-file"}<button type="button" role="menuitem" onclick={() => { void showLocation(); }} class="menu-action"><FolderSearch size={14} />{t("music.itemMenu.showLocation")}</button>{/if}
    </div>
  {/if}
</div>

<style>
  .menu-action { display: flex; min-height: 2.25rem; width: 100%; align-items: center; gap: 0.6rem; border-radius: 0.45rem; padding-inline: 0.65rem; text-align: left; font-size: calc(0.72rem * var(--type-scale)); font-weight: 500; }
  .menu-action:hover { background: var(--accent); color: var(--accent-foreground); }
</style>
