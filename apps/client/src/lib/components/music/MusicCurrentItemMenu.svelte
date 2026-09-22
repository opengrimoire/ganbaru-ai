<script lang="ts">
  import { onMount } from "svelte";
  import Check from "@lucide/svelte/icons/check";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import ListTodo from "@lucide/svelte/icons/list-todo";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import MusicPlaylistIcon from "./builder/MusicPlaylistIcon.svelte";
  import {
    bulkEditMusicMemberships,
    getMusicMembershipMatrix,
    getMusicPlaylistSummaries,
  } from "$lib/api/music-library";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { notifyMusicLibraryChanged } from "$lib/music/music-library-events";
  import type { MusicPlaylistSummary } from "$lib/music/library-contracts";
  import { sortReviewPlaylists } from "$lib/music/music-review";
  import { systemMusicPlaylistName } from "$lib/music/music-system-playlists";
  import { getMusicPlayer } from "$lib/stores/music-player.svelte";

  let { onOpenBuilder, active = true }: {
    onOpenBuilder: (itemId: string | null) => void;
    active?: boolean;
  } = $props();

  const { t } = getLocalization();
  const player = getMusicPlayer();
  const playlistPageSize = 500;
  let root = $state<HTMLElement | null>(null);
  let trigger = $state<HTMLButtonElement | null>(null);
  let open = $state(false);
  let loading = $state(false);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let playlists = $state<MusicPlaylistSummary[]>([]);
  let savedIds = $state<Set<string>>(new Set());
  let draftIds = $state<Set<string>>(new Set());
  let generation = 0;

  const queueIndex = $derived(player.currentQueueIndex);
  const itemId = $derived(queueIndex >= 0 ? player.activeQueueItemIds[queueIndex] ?? null : null);
  const available = $derived(Boolean(player.currentSource && itemId));
  const sortedPlaylists = $derived(sortReviewPlaylists(playlists, ""));
  const changed = $derived(savedIds.size !== draftIds.size || [...savedIds].some((id) => !draftIds.has(id)));

  $effect(() => {
    itemId;
    close();
  });

  $effect(() => {
    if (!active) close();
  });

  onMount(() => {
    const pointer = (event: PointerEvent) => {
      if (active && open && event.target instanceof Node && root && !root.contains(event.target)) close();
    };
    const key = (event: KeyboardEvent) => {
      if (!active || !open || event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close();
      trigger?.focus();
    };
    window.addEventListener("pointerdown", pointer);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", pointer);
      window.removeEventListener("keydown", key, true);
    };
  });

  function close(): void {
    generation += 1;
    open = false;
  }

  async function loadPlaylists(targetItemId: string): Promise<void> {
    const request = ++generation;
    loading = true;
    error = null;
    playlists = [];
    try {
      const now = Date.now();
      const summaries: MusicPlaylistSummary[] = [];
      const matrix = await getMusicMembershipMatrix([targetItemId]);
      for (let offset = 0; ; offset += playlistPageSize) {
        const page = await getMusicPlaylistSummaries(now, offset, playlistPageSize);
        summaries.push(...page);
        if (page.length < playlistPageSize) break;
      }
      if (!open || request !== generation || itemId !== targetItemId) return;
      playlists = summaries;
      savedIds = new Set(matrix.map((entry) => entry.playlistId));
      draftIds = new Set(savedIds);
    } catch (cause) {
      if (open && request === generation && itemId === targetItemId) error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (request === generation) loading = false;
    }
  }

  function activate(): void {
    if (!available || !itemId) {
      onOpenBuilder(null);
      return;
    }
    if (open) {
      close();
      return;
    }
    open = true;
    void loadPlaylists(itemId);
  }

  function togglePlaylist(playlistId: string): void {
    if (loading || saving) return;
    const next = new Set(draftIds);
    if (next.has(playlistId)) next.delete(playlistId);
    else next.add(playlistId);
    draftIds = next;
  }

  async function save(): Promise<void> {
    const targetItemId = itemId;
    if (!targetItemId || !changed || loading || saving) return;
    const addPlaylistIds = [...draftIds].filter((id) => !savedIds.has(id));
    const removePlaylistIds = [...savedIds].filter((id) => !draftIds.has(id));
    const request = generation;
    saving = true;
    error = null;
    try {
      await bulkEditMusicMemberships({
        actionId: crypto.randomUUID(),
        itemIds: [targetItemId],
        addPlaylistIds,
        removePlaylistIds,
        weightPlaylistIds: [],
        weight: null,
        updatedAt: Date.now(),
      });
      notifyMusicLibraryChanged();
      if (open && request === generation && itemId === targetItemId) {
        savedIds = new Set(draftIds);
        close();
        trigger?.focus();
      }
    } catch (cause) {
      if (open && request === generation && itemId === targetItemId) error = cause instanceof Error ? cause.message : String(cause);
      else console.error("Could not save playlists for the previous track", cause);
    } finally {
      saving = false;
    }
  }

  function openBuilder(): void {
    const targetItemId = itemId;
    close();
    onOpenBuilder(targetItemId);
  }
</script>

<div bind:this={root} class="relative">
  <button bind:this={trigger} type="button" onclick={activate} class="inline-flex h-9 w-9 items-center justify-center rounded-md bg-secondary text-secondary-foreground transition-colors hover:bg-accent" aria-label={available ? t("music.itemMenu.actions") : t("music.playlistBuilder")} aria-expanded={open} aria-haspopup={available ? "dialog" : undefined}><ListTodo size={15} /></button>
  {#if open}
    <div role="dialog" aria-label={t("music.itemMenu.actions")} class="absolute bottom-[calc(100%+0.45rem)] right-0 z-40 flex max-h-[calc(100vh-1rem)] w-[min(19rem,calc(100vw-1rem))] flex-col rounded-xl border border-border/75 bg-popover p-3 text-popover-foreground shadow-md">
      <h2 class="px-1 text-xs font-semibold">{t("music.launcher.playlists")}</h2>
      {#if error}<p class="mt-2 px-1 text-xs text-destructive" role="alert">{error}</p>{/if}
      <div class="mt-2 h-56 min-h-0 shrink overflow-y-auto" data-music-scrollable="true">
        {#if loading}
          <div class="flex h-full items-center justify-center" aria-label={t("music.itemMenu.loading")}><LoaderCircle class="animate-spin motion-reduce:animate-none" size={17} strokeWidth={2.6} /></div>
        {:else if error && playlists.length === 0}
          <button type="button" onclick={() => { if (itemId) void loadPlaylists(itemId); }} class="mx-1 my-4 rounded-md px-2 py-1 text-xs font-medium text-foreground hover:bg-accent/60">{t("common.retry")}</button>
        {:else if playlists.length === 0}
          <p class="px-1 py-5 text-xs text-muted-foreground">{t("music.itemMenu.noPlaylists")}</p>
        {:else}
          <div class="space-y-0.5">
            {#each sortedPlaylists as playlist (playlist.id)}
              {@const selected = draftIds.has(playlist.id)}
              <button type="button" onclick={() => togglePlaylist(playlist.id)} disabled={saving} aria-pressed={selected} aria-label={selected ? t("music.builder.removeFromPlaylist", playlist.name) : t("music.builder.addToPlaylist", playlist.name)} class="flex min-h-9 w-full items-center gap-2 rounded-lg px-1.5 text-left text-xs transition-colors hover:bg-accent/60 disabled:cursor-wait aria-pressed:bg-primary/10">
                <span class="grid h-6 w-6 shrink-0 place-items-center"><MusicPlaylistIcon icon={playlist.icon} size={15} /></span>
                <span class="min-w-0 flex-1 truncate">{systemMusicPlaylistName(playlist.id, playlist.name, t)}</span>
                <span class={selected ? "grid h-4 w-4 shrink-0 place-items-center rounded border border-primary bg-primary text-primary-foreground" : "grid h-4 w-4 shrink-0 place-items-center rounded border border-border"}>{#if selected}<Check size={11} strokeWidth={2.5} />{/if}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
      <div class="mt-3 flex items-center justify-between gap-2">
        <button type="button" onclick={openBuilder} class="inline-flex h-8 items-center gap-0.5 rounded-md px-1.5 text-xs font-medium text-muted-foreground hover:bg-accent/60 hover:text-foreground">{t("music.itemMenu.openInBuilder")}<ChevronRight size={13} /></button>
        <button type="button" onclick={() => { void save(); }} disabled={!changed || loading || saving} class="inline-flex h-8 min-w-16 items-center justify-center rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:bg-secondary disabled:text-muted-foreground">{#if saving}<LoaderCircle class="animate-spin motion-reduce:animate-none" size={14} strokeWidth={2.5} />{:else}{t("common.save")}{/if}</button>
      </div>
    </div>
  {/if}
</div>
