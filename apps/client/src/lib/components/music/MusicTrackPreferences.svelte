<script lang="ts">
  import { onMount, tick } from "svelte";
  import { formatNumber } from "$lib/i18n/formatters";
  import SlidersHorizontal from "@lucide/svelte/icons/sliders-horizontal";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import Dice1 from "@lucide/svelte/icons/dice-1";
  import Dice2 from "@lucide/svelte/icons/dice-2";
  import Dice3 from "@lucide/svelte/icons/dice-3";
  import Dice4 from "@lucide/svelte/icons/dice-4";
  import Dice5 from "@lucide/svelte/icons/dice-5";
  import Shuffle from "@lucide/svelte/icons/shuffle";
  import ListOrdered from "@lucide/svelte/icons/list-ordered";
  import CustomSelect from "$lib/components/settings/CustomSelect.svelte";
  import {
    bulkEditMusicMemberships,
    bulkSnoozeMusicItems,
    getMusicInspectorDetail,
    getMusicMembershipMatrix,
    getMusicPlaylistSummaries,
    removeMusicSnooze,
  } from "$lib/api/music-library";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import type { MusicMembershipMatrixEntry, MusicPlaylistSummary, MusicSnooze, MusicWeight } from "$lib/music/library-contracts";
  import { notifyMusicLibraryChanged } from "$lib/music/music-library-events";
  import { musicSnoozeEndsAt, type MusicSnoozeDuration } from "$lib/music/music-snooze";
  import { MUSIC_WEIGHT_ORDER, musicMembershipsForScope, musicSnoozesForScope, musicWeightForScope } from "$lib/music/music-track-preferences";
  import { MUSIC_MIX_WEIGHT_VALUES } from "$lib/music/music-playlist-playback";
  import { pickMusicFrequencyTooltipPosition, type MusicFrequencyTooltipPosition } from "$lib/music/music-frequency-tooltip-position";
  import { systemMusicPlaylistName } from "$lib/music/music-system-playlists";
  import { getMusicPlayer } from "$lib/stores/music-player.svelte";
  import { portal } from "$lib/utils/portal";

  let { active = true, volumeMenuOpen = false, onOpen }: {
    active?: boolean;
    volumeMenuOpen?: boolean;
    onOpen: () => void;
  } = $props();

  const localization = getLocalization();
  const { t } = localization;
  const player = getMusicPlayer();
  const diceIcons = [Dice1, Dice2, Dice3, Dice4, Dice5] as const;
  let root = $state<HTMLElement | null>(null);
  let trigger = $state<HTMLButtonElement | null>(null);
  let panel = $state<HTMLElement | null>(null);
  let open = $state(false);
  let busy = $state(false);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let memberships = $state<MusicMembershipMatrixEntry[]>([]);
  let playlists = $state<MusicPlaylistSummary[]>([]);
  let snoozes = $state<MusicSnooze[]>([]);
  let scopePlaylistId = $state<string | null>(null);
  let frequencyHeader = $state<HTMLElement | null>(null);
  let frequencyTooltip = $state<HTMLElement | null>(null);
  let activeFrequencyTooltip = $state<"warning" | null>(null);
  let frequencyTooltipPosition = $state<MusicFrequencyTooltipPosition | null>(null);
  let loadGeneration = 0;
  let frequencyTooltipRequest = 0;

  const queueIndex = $derived(player.currentQueueIndex);
  const itemId = $derived(queueIndex >= 0 ? player.activeQueueItemIds[queueIndex] ?? null : null);
  const targetMemberships = $derived(musicMembershipsForScope(memberships, scopePlaylistId));
  const currentWeight = $derived(musicWeightForScope(targetMemberships));
  const scopeSnoozes = $derived(musicSnoozesForScope(snoozes, scopePlaylistId, Date.now()));
  const scopeOptions = $derived([
    { value: "", label: t("music.preferences.everywhere") },
    ...memberships.map((entry) => ({ value: entry.playlistId, label: playlistName(entry.playlistId) })),
  ]);
  const frequencyInactiveText = $derived(t("music.preferences.frequencyInactive", t(`music.playbackMode.${player.playbackMode}`)));

  function weightLabel(weight: MusicWeight): string {
    return `${t(`music.builder.weight.${weight}`)} (${formatNumber(localization.locale, MUSIC_MIX_WEIGHT_VALUES[weight])}x)`;
  }

  $effect(() => {
    itemId;
    player.activePlaylistId;
    close(false);
    error = null;
  });

  $effect(() => {
    if (!active) close(false);
  });

  $effect(() => {
    if (volumeMenuOpen) close(false);
  });

  $effect(() => {
    if (player.playbackMode === "mix" && activeFrequencyTooltip === "warning") hideFrequencyTooltip();
  });

  onMount(() => {
    const pointer = (event: PointerEvent) => {
      if (active && open && event.target instanceof Node && root && !root.contains(event.target)
        && !(event.target instanceof Element && event.target.closest("[data-app-floating-surface]"))) close(false);
    };
    const key = (event: KeyboardEvent) => {
      if (!active || !open || event.key !== "Escape" || document.querySelector("[data-app-floating-surface]")) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    window.addEventListener("pointerdown", pointer);
    window.addEventListener("keydown", key, true);
    window.addEventListener("scroll", hideFrequencyTooltip, true);
    window.addEventListener("resize", hideFrequencyTooltip);
    return () => {
      window.removeEventListener("pointerdown", pointer);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("scroll", hideFrequencyTooltip, true);
      window.removeEventListener("resize", hideFrequencyTooltip);
    };
  });

  async function showFrequencyTooltip(trigger: HTMLButtonElement): Promise<void> {
    if (!open) return;
    const request = ++frequencyTooltipRequest;
    activeFrequencyTooltip = "warning";
    frequencyTooltipPosition = null;
    await tick();
    if (request !== frequencyTooltipRequest || activeFrequencyTooltip !== "warning") return;
    const tooltip = frequencyTooltip;
    if (!tooltip || !trigger.isConnected) return;
    const triggerRect = trigger.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    frequencyTooltipPosition = pickMusicFrequencyTooltipPosition({
      anchorTop: triggerRect.top,
      anchorBottom: triggerRect.bottom,
      anchorLeft: frequencyHeader?.getBoundingClientRect().left ?? triggerRect.left,
      tooltipWidth: tooltipRect.width,
      tooltipHeight: tooltipRect.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });
  }

  function hideFrequencyTooltip(): void {
    frequencyTooltipRequest += 1;
    activeFrequencyTooltip = null;
    frequencyTooltipPosition = null;
  }

  function close(restoreFocus = true): void {
    loadGeneration += 1;
    hideFrequencyTooltip();
    open = false;
    loading = false;
    if (restoreFocus) queueMicrotask(() => trigger?.focus());
  }

  function playlistName(playlistId: string): string {
    const summary = playlists.find((entry) => entry.id === playlistId);
    return summary ? systemMusicPlaylistName(summary.id, summary.name, t) : playlistId;
  }

  async function toggle(): Promise<void> {
    if (open) { close(); return; }
    const targetItemId = itemId;
    if (!targetItemId) return;
    onOpen();
    const generation = ++loadGeneration;
    open = true;
    loading = true;
    error = null;
    await tick();
    panel?.focus();
    try {
      const [nextMemberships, nextPlaylists, detail] = await Promise.all([
        getMusicMembershipMatrix([targetItemId]),
        getMusicPlaylistSummaries(Date.now(), 0, 500),
        getMusicInspectorDetail(targetItemId),
      ]);
      if (!open || itemId !== targetItemId || generation !== loadGeneration) return;
      memberships = nextMemberships;
      playlists = nextPlaylists;
      snoozes = detail.snoozes;
      const activeGlobalSnooze = musicSnoozesForScope(detail.snoozes, null, Date.now())
        .some((entry) => entry.scope === "all-playlists");
      scopePlaylistId = !activeGlobalSnooze && nextMemberships.some((entry) => entry.playlistId === player.activePlaylistId)
        ? player.activePlaylistId : null;
    } catch (cause) {
      if (open && itemId === targetItemId && generation === loadGeneration) error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (generation === loadGeneration) loading = false;
    }
  }

  async function saveWeight(weight: MusicWeight): Promise<void> {
    const targetItemId = itemId;
    const playlistIds = targetMemberships.map((entry) => entry.playlistId);
    if (!targetItemId || playlistIds.length === 0 || busy || currentWeight === weight) return;
    const previousMemberships = memberships;
    const generation = loadGeneration;
    busy = true;
    error = null;
    memberships = memberships.map((entry) => playlistIds.includes(entry.playlistId) ? { ...entry, weight } : entry);
    try {
      await bulkEditMusicMemberships({
        actionId: crypto.randomUUID(),
        itemIds: [targetItemId],
        addPlaylistIds: [],
        removePlaylistIds: [],
        weightPlaylistIds: playlistIds,
        weight,
        updatedAt: Date.now(),
      });
      if (player.activePlaylistId && playlistIds.includes(player.activePlaylistId) && itemId === targetItemId) player.applyCurrentQueueWeight(weight);
      notifyMusicLibraryChanged();
    } catch (cause) {
      if (generation === loadGeneration && itemId === targetItemId) {
        memberships = previousMemberships;
        error = cause instanceof Error ? cause.message : String(cause);
      } else console.error("Could not save Mix frequency for the previous track", cause);
    } finally {
      busy = false;
    }
  }

  async function snooze(duration: MusicSnoozeDuration): Promise<void> {
    const targetItemId = itemId;
    if (!targetItemId || busy) return;
    const now = Date.now();
    const activePlaylistId = player.activePlaylistId;
    const selectedPlaylistId = scopePlaylistId;
    const scope = selectedPlaylistId ? "playlist" : "all-playlists";
    const endsAt = musicSnoozeEndsAt(duration, now, Intl.DateTimeFormat().resolvedOptions().timeZone);
    busy = true;
    error = null;
    try {
      await bulkSnoozeMusicItems({
        actionId: crypto.randomUUID(),
        itemIds: [targetItemId],
        scope,
        playlistId: selectedPlaylistId,
        startsAt: now,
        endsAt,
        reason: "",
        createdAt: now,
      });
      if (itemId === targetItemId && player.activePlaylistId === activePlaylistId
        && (selectedPlaylistId === null || selectedPlaylistId === activePlaylistId)) player.applyCurrentQueueSnooze(endsAt);
      notifyMusicLibraryChanged();
      close(false);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      busy = false;
    }
  }

  async function resume(): Promise<void> {
    if (busy || scopeSnoozes.length === 0) return;
    const targetItemId = itemId;
    const snoozeIds = scopeSnoozes.map((entry) => entry.id);
    busy = true;
    error = null;
    try {
      await Promise.all(snoozeIds.map(removeMusicSnooze));
      snoozes = snoozes.filter((entry) => !snoozeIds.includes(entry.id));
      if (itemId === targetItemId) {
        const remaining = musicSnoozesForScope(snoozes, null, Date.now())
          .filter((entry) => entry.scope === "all-playlists" || entry.playlistId === player.activePlaylistId);
        if (remaining.length === 0) player.clearCurrentQueueSnooze();
        else player.applyCurrentQueueSnooze(remaining.some((entry) => entry.endsAt === null)
          ? null : Math.max(...remaining.map((entry) => entry.endsAt ?? 0)));
      }
      notifyMusicLibraryChanged();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      if (targetItemId) {
        try { snoozes = (await getMusicInspectorDetail(targetItemId)).snoozes; }
        catch (refreshCause) { error += ` ${refreshCause instanceof Error ? refreshCause.message : String(refreshCause)}`; }
      }
    } finally {
      busy = false;
    }
  }
</script>

<div bind:this={root} class="relative">
  <button
    bind:this={trigger}
    type="button"
    onclick={() => { void toggle(); }}
    disabled={!itemId}
    class="inline-flex h-9 w-9 items-center justify-center rounded-md bg-secondary text-secondary-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-45"
    aria-label={t("music.preferences.title")}
    aria-haspopup="dialog"
    aria-expanded={open}
  ><SlidersHorizontal size={14} strokeWidth={1.6} /></button>
  {#if open}
    <div bind:this={panel} role="dialog" tabindex="-1" data-music-track-preferences-open data-app-shortcuts="ignore" aria-label={t("music.preferences.title")} class="absolute bottom-[calc(100%+0.5rem)] right-0 z-40 w-72 max-w-[calc(100vw-1rem)] rounded-xl border border-border/75 bg-popover p-4 text-popover-foreground shadow-md">
      {#if loading}
        <div class="flex h-24 items-center justify-center" aria-label={t("music.itemMenu.loading")}><LoaderCircle size={17} strokeWidth={2.6} class="animate-spin motion-reduce:animate-none" /></div>
      {:else}
        {#if error}<p class="mb-2 text-xs text-destructive" role="alert">{error}</p>{/if}
        <div class="flex items-center justify-between gap-3">
          <span class="shrink-0 text-xs font-medium text-muted-foreground">{t("music.preferences.applyTo")}</span>
          <CustomSelect
            value={scopePlaylistId ?? ""}
            options={scopeOptions}
            onChange={(value) => scopePlaylistId = value || null}
            ariaLabel={t("music.preferences.applyTo")}
            disabled={memberships.length === 0}
            class="w-44"
          />
        </div>
        <div class="mt-5">
          <div class="flex items-center justify-between gap-2">
            <div bind:this={frequencyHeader} class="relative flex min-w-0 items-center gap-1.5">
              <span class="text-xs font-semibold">{t("music.preferences.likelihood")}</span>
              {#if player.playbackMode !== "mix"}
                <button type="button" data-music-frequency-warning-trigger class="group grid h-5 w-5 shrink-0 place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring" aria-label={frequencyInactiveText} onpointerenter={(event) => { void showFrequencyTooltip(event.currentTarget); }} onpointerleave={hideFrequencyTooltip} onfocus={(event) => { void showFrequencyTooltip(event.currentTarget); }} onblur={hideFrequencyTooltip}><span class="grid h-3.5 w-3.5 place-items-center rounded-full border border-muted-foreground/50 text-[0.55rem] leading-none font-bold text-muted-foreground group-hover:bg-secondary group-hover:text-foreground" aria-hidden="true">!</span></button>
              {/if}
            </div>
            {#if targetMemberships.length > 0}<span class="text-[0.7rem] text-muted-foreground">{currentWeight ? t(`music.builder.weight.${currentWeight}`) : t("music.preferences.mixed")}</span>{/if}
          </div>
          <div class="mt-2 flex items-center justify-between gap-1" role="group" aria-label={t("music.preferences.likelihood")}>
            {#each MUSIC_WEIGHT_ORDER as weight, index (weight)}
              {@const Die = diceIcons[index]}
              <button
                type="button"
                data-music-weight={weight}
                onclick={() => { void saveWeight(weight); }}
                disabled={targetMemberships.length === 0}
                aria-disabled={busy || targetMemberships.length === 0}
                aria-label={weightLabel(weight)}
                data-app-tooltip={weightLabel(weight)}
                aria-pressed={currentWeight === weight}
                class={currentWeight === weight ? "die-choice active-die" : "die-choice"}
              ><Die size={22} strokeWidth={1.6} /></button>
            {/each}
          </div>
        </div>

        <div class="mt-4 border-t border-border/60 pt-4">
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs font-semibold">{t("music.preferences.snooze")}</span>
            {#if scopeSnoozes.length > 0}<button type="button" onclick={() => { void resume(); }} aria-disabled={busy} class="text-[0.7rem] font-medium text-primary hover:underline">{t("music.preferences.resume")}</button>{/if}
          </div>
          <div class="mt-2 grid grid-cols-3 gap-1">
            <button type="button" onclick={() => { void snooze("today"); }} aria-disabled={busy} class="snooze-choice">{t("music.preferences.today")}</button>
            <button type="button" onclick={() => { void snooze("week"); }} aria-disabled={busy} class="snooze-choice">{t("music.preferences.week")}</button>
            <button type="button" onclick={() => { void snooze("until-resumed"); }} aria-disabled={busy} class="snooze-choice">{t("music.preferences.untilResumed")}</button>
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>

{#if open && activeFrequencyTooltip}
  <div
    use:portal
    bind:this={frequencyTooltip}
    aria-hidden="true"
    data-music-frequency-tooltip={activeFrequencyTooltip}
    data-placement={frequencyTooltipPosition?.placement}
    class="pointer-events-none fixed z-80 w-64 max-w-[calc(100vw-1rem)] rounded-md border border-border bg-popover p-3 text-left text-xs leading-4 text-popover-foreground shadow-md"
    style={frequencyTooltipPosition ? `top: ${frequencyTooltipPosition.top}px; left: ${frequencyTooltipPosition.left}px;` : "top: -10000px; left: 0; visibility: hidden;"}
  >
    <p>
      {t("music.preferences.frequencyInactiveBeforeMode")}{" "}<span class="whitespace-nowrap">{#if player.playbackMode === "shuffle"}<Shuffle size={12} strokeWidth={1.4} class="inline-block align-[-0.1em]" />{:else}<ListOrdered size={12} strokeWidth={1.4} class="inline-block align-[-0.1em]" />{/if}{" "}{t(`music.playbackMode.${player.playbackMode}`)}.</span>{" "}
      {t("music.preferences.frequencyInactiveBeforeMix")}{" "}<span class="whitespace-nowrap"><Dice5 size={12} strokeWidth={1.4} class="inline-block align-[-0.1em]" />{" "}{t("music.playbackMode.mix")}</span>{" "}{t("music.preferences.frequencyInactiveAfterMix")}
    </p>
  </div>
{/if}

<style>
  .snooze-choice { min-height: 2rem; border-radius: 0.45rem; padding-inline: 0.15rem; font-size: calc(0.7rem * var(--type-scale)); color: var(--muted-foreground); }
  .snooze-choice:hover { background: var(--accent); color: var(--foreground); }
  .die-choice { display: inline-flex; height: 2.5rem; width: 2.5rem; align-items: center; justify-content: center; border-radius: 0.6rem; color: var(--muted-foreground); }
  .die-choice:hover { background: var(--accent); color: var(--foreground); }
  .die-choice.active-die { background: color-mix(in srgb, var(--primary) 12%, transparent); color: var(--primary); }
  .die-choice:disabled { cursor: not-allowed; opacity: 0.35; }
</style>
