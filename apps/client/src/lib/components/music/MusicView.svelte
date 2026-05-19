<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import AlertCircle from "@lucide/svelte/icons/alert-circle";
  import Check from "@lucide/svelte/icons/check";
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import Gauge from "@lucide/svelte/icons/gauge";
  import LinkIcon from "@lucide/svelte/icons/link";
  import ListMusic from "@lucide/svelte/icons/list-music";
  import ListPlus from "@lucide/svelte/icons/list-plus";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import Pause from "@lucide/svelte/icons/pause";
  import Play from "@lucide/svelte/icons/play";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import Shuffle from "@lucide/svelte/icons/shuffle";
  import SkipBack from "@lucide/svelte/icons/skip-back";
  import SkipForward from "@lucide/svelte/icons/skip-forward";
  import CalendarScrollbar from "$lib/components/calendar/CalendarScrollbar.svelte";
  import MusicPlaylistBuilderView from "$lib/components/music/MusicPlaylistBuilderView.svelte";
  import { SPEED_PRESETS, clampRate, formatPlaybackTime, isSpeedPreset } from "$lib/music/playback";
  import { getMusicPlayer } from "$lib/stores/music-player.svelte";
  import { cn } from "$lib/utils";

  const player = getMusicPlayer();

  type MusicPage = "player" | "playlist-builder";

  let mediaSurface = $state<HTMLElement | null>(null);
  let playlistScrollContainer = $state<HTMLElement | undefined>();
  let speedMenuRoot = $state<HTMLElement | null>(null);
  let speedMenuOpen = $state(false);
  let customSpeedOpen = $state(false);
  let customRateDraft = $state("1");
  let playlistVisible = $state(false);
  let musicPage = $state<MusicPage>("player");
  let mediaSurfaceFullscreen = $state(false);
  let volumeFeedbackVisible = $state(false);
  let mediaSurfaceClickTimeoutId: number | null = null;
  let volumeFeedbackTimeoutId: number | null = null;
  let lastVolumeFeedbackId = 0;
  let playlistAutoScrollActive = false;
  let lastPlaylistAutoScrollIndex = -1;
  let lastPlaylistAutoScrollIdentity: string | null = null;
  let playlistScrollRequestId = 0;

  const mediaSurfaceFullscreenEvent = "ganbaruai-music-media-surface-fullscreen";
  const volumeMax = $derived(player.volumeMax);
  const volumeSliderProgress = $derived(volumeMax > 0
    ? `${Math.min(100, Math.max(0, (player.volumeControlValue / volumeMax) * 100))}%`
    : "0%");
  const activeSpeedIsPreset = $derived(isSpeedPreset(player.snapshot.rate));
  const topBarMediaTitleMaxLength = 42;
  const volumeShortcutStep = 0.05;
  const topBarMediaTitle = $derived(
    player.currentSource
      ? truncateTopBarMediaTitle(
        mediaTitleWithoutExtension(player.loadedTitle, player.currentSource.kind === "local-file"),
      )
      : "",
  );
  const speedShortcutStep = 0.25;
  const musicIconSize = 14;
  const musicIconStrokeWidth = 1.5;

  $effect(() => {
    player.setSurfaceElement(mediaSurface);
    return () => {
      player.setSurfaceElement(null);
    };
  });

  onDestroy(() => {
    clearMediaSurfaceClickTimeout();
    clearVolumeFeedbackTimeout();
  });

  $effect(() => {
    if (typeof document === "undefined") return;
    const updateFullscreenState = () => {
      mediaSurfaceFullscreen = Boolean(mediaSurface && document.fullscreenElement === mediaSurface);
    };
    updateFullscreenState();
    document.addEventListener("fullscreenchange", updateFullscreenState);
    return () => {
      document.removeEventListener("fullscreenchange", updateFullscreenState);
    };
  });

  $effect(() => {
    const feedbackId = player.volumeFeedbackId;
    if (feedbackId === lastVolumeFeedbackId) return;
    lastVolumeFeedbackId = feedbackId;
    if (!mediaSurfaceFullscreen) return;
    showVolumeFeedback();
  });

  $effect(() => {
    const visible = playlistVisible;
    const container = playlistScrollContainer;
    const index = player.highlightedQueueIndex;
    const identity = index >= 0 ? player.queue[index]?.identity ?? null : null;

    if (!visible) {
      playlistAutoScrollActive = false;
      lastPlaylistAutoScrollIndex = index;
      lastPlaylistAutoScrollIdentity = identity;
      return;
    }

    if (!container) return;

    const opened = !playlistAutoScrollActive;
    playlistAutoScrollActive = true;

    if (index < 0 || identity === null) {
      lastPlaylistAutoScrollIndex = index;
      lastPlaylistAutoScrollIdentity = identity;
      return;
    }

    if (opened || index !== lastPlaylistAutoScrollIndex || identity !== lastPlaylistAutoScrollIdentity) {
      scrollPlaylistItemIntoView(index, opened ? "center" : "nearest");
    }

    lastPlaylistAutoScrollIndex = index;
    lastPlaylistAutoScrollIdentity = identity;
  });

  function togglePlaylist(): void {
    playlistVisible = !playlistVisible;
  }

  function openPlaylistBuilder(): void {
    closeSpeedMenu();
    musicPage = "playlist-builder";
  }

  function closePlaylistBuilder(): void {
    musicPage = "player";
  }

  function digitSeekShortcut(event: KeyboardEvent): number | null {
    if (event.shiftKey) return null;
    if (/^[0-9]$/.test(event.key)) return Number(event.key);
    if (/^Numpad[0-9]$/.test(event.code)) return Number(event.code.slice("Numpad".length));
    return null;
  }

  function seekToDigitPosition(digit: number): void {
    const durationMs = player.snapshot.durationMs;
    if (!player.currentSource || durationMs === null || durationMs <= 0) return;
    void player.seekToMs(Math.round((durationMs * digit) / 10));
  }

  function snappedVolume(value: number): number {
    if (!Number.isFinite(value)) return player.volumeControlValue;
    return Number((Math.round(value / volumeShortcutStep) * volumeShortcutStep).toFixed(2));
  }

  function setVolumeFromControl(value: number): void {
    void player.setVolume(snappedVolume(value));
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (musicPage !== "player") return;
    if (event.altKey || event.metaKey) return;
    if (isEditableTarget(event.target)) return;
    if (event.ctrlKey) {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        void player.playPreviousTrack();
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        void player.playNextTrack();
        return;
      }
      if (!event.shiftKey && (event.key.toLowerCase() === "l" || event.key.toLowerCase() === "p")) {
        event.preventDefault();
        togglePlaylist();
      }
      return;
    }
    if (event.code === "Space") {
      event.preventDefault();
      void player.togglePlay();
      return;
    }
    const seekDigit = digitSeekShortcut(event);
    if (seekDigit !== null) {
      event.preventDefault();
      seekToDigitPosition(seekDigit);
      return;
    }
    if (event.key.toLowerCase() === "p" || event.key.toLowerCase() === "l") {
      event.preventDefault();
      togglePlaylist();
      return;
    }
    if (event.key.toLowerCase() === "m") {
      event.preventDefault();
      void player.toggleMute();
      return;
    }
    if (event.shiftKey && event.key === "ArrowLeft") {
      event.preventDefault();
      void player.playPreviousTrack();
      return;
    }
    if (event.shiftKey && event.key === "ArrowRight") {
      event.preventDefault();
      void player.playNextTrack();
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      void player.seekByMs(-10_000);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      void player.seekByMs(10_000);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      void player.adjustVolume(volumeShortcutStep);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      void player.adjustVolume(-volumeShortcutStep);
      return;
    }
    if (event.key === "s" || event.key === "S") {
      event.preventDefault();
      if (player.queue.length >= 2) {
        player.toggleShuffle();
      }
      return;
    }
    if (event.key === "+" || event.key === "=" || event.code === "NumpadAdd") {
      event.preventDefault();
      void player.setRate(clampRate(player.snapshot.rate + speedShortcutStep));
      return;
    }
    if (event.key === "-" || event.code === "NumpadSubtract") {
      event.preventDefault();
      void player.setRate(clampRate(player.snapshot.rate - speedShortcutStep));
    }
  }

  function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
  }

  function handleWindowPointerDown(event: PointerEvent): void {
    if (!speedMenuOpen || !speedMenuRoot || !(event.target instanceof Node)) return;
    if (!speedMenuRoot.contains(event.target)) {
      closeSpeedMenu();
    }
  }

  function openSpeedMenu(): void {
    customSpeedOpen = false;
    speedMenuOpen = !speedMenuOpen;
  }

  function openCustomSpeed(): void {
    customRateDraft = String(player.snapshot.rate);
    customSpeedOpen = true;
  }

  function closeSpeedMenu(): void {
    speedMenuOpen = false;
    customSpeedOpen = false;
  }

  async function applySpeed(rate: number): Promise<void> {
    await player.setRate(rate);
    closeSpeedMenu();
  }

  async function applyCustomSpeed(): Promise<void> {
    await player.setRate(clampRate(Number(customRateDraft)));
    closeSpeedMenu();
  }

  function handleMediaSurfaceClick(event: MouseEvent): void {
    event.preventDefault();
    if (event.button !== 0) return;
    if (event.detail > 1) return;
    clearMediaSurfaceClickTimeout();
    mediaSurfaceClickTimeoutId = window.setTimeout(() => {
      mediaSurfaceClickTimeoutId = null;
      void player.togglePlay();
    }, 250);
  }

  function handleMediaSurfaceDoubleClick(event: MouseEvent): void {
    event.preventDefault();
    if (event.button !== 0) return;
    clearMediaSurfaceClickTimeout();
    window.dispatchEvent(new CustomEvent(mediaSurfaceFullscreenEvent));
  }

  function clearMediaSurfaceClickTimeout(): void {
    if (mediaSurfaceClickTimeoutId === null) return;
    window.clearTimeout(mediaSurfaceClickTimeoutId);
    mediaSurfaceClickTimeoutId = null;
  }

  function clearVolumeFeedbackTimeout(): void {
    if (volumeFeedbackTimeoutId === null) return;
    window.clearTimeout(volumeFeedbackTimeoutId);
    volumeFeedbackTimeoutId = null;
  }

  function releaseRangeFocus(event: Event): void {
    if (event.currentTarget instanceof HTMLElement) {
      event.currentTarget.blur();
    }
  }

  function releaseClickedButtonFocus(event: PointerEvent): void {
    if (!(event.target instanceof HTMLElement)) return;
    const button = event.target.closest("button");
    if (!button) return;
    window.setTimeout(() => button.blur(), 0);
  }

  function releaseClickedButtonFocusAction(node: HTMLElement): { destroy: () => void } {
    node.addEventListener("pointerup", releaseClickedButtonFocus);
    return {
      destroy: () => node.removeEventListener("pointerup", releaseClickedButtonFocus),
    };
  }

  function mediaTitleWithoutExtension(title: string, localFile: boolean): string {
    const trimmed = title.trim();
    if (!localFile) return trimmed;
    return trimmed.replace(/\.[A-Za-z0-9]{1,8}$/, "");
  }

  function truncateTopBarMediaTitle(title: string): string {
    if (title.length <= topBarMediaTitleMaxLength) return title;
    return `${title.slice(0, topBarMediaTitleMaxLength - 3).trimEnd()}...`;
  }

  function showVolumeFeedback(): void {
    clearVolumeFeedbackTimeout();
    volumeFeedbackVisible = true;
    volumeFeedbackTimeoutId = window.setTimeout(() => {
      volumeFeedbackVisible = false;
      volumeFeedbackTimeoutId = null;
    }, 900);
  }

  function scrollPlaylistItemIntoView(index: number, block: "center" | "nearest"): void {
    const requestId = ++playlistScrollRequestId;
    void tick().then(() => {
      if (requestId !== playlistScrollRequestId) return;
      if (!playlistVisible || !playlistScrollContainer) return;
      const item = playlistScrollContainer.querySelector<HTMLElement>(`[data-playlist-index="${index}"]`);
      if (!item) return;
      if (block === "nearest" && playlistItemFullyVisible(item, playlistScrollContainer)) return;
      item.scrollIntoView({ block, inline: "nearest", behavior: "auto" });
    });
  }

  function playlistItemFullyVisible(item: HTMLElement, container: HTMLElement): boolean {
    const itemRect = item.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    return itemRect.top >= containerRect.top && itemRect.bottom <= containerRect.bottom;
  }

  function handleMediaSurfaceKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter" || event.code === "Space") {
      event.preventDefault();
      event.stopPropagation();
      void player.togglePlay();
      return;
    }
    if (mediaSurfaceFullscreen && event.key.toLowerCase() === "f") {
      event.preventDefault();
      event.stopPropagation();
      window.dispatchEvent(new CustomEvent(mediaSurfaceFullscreenEvent));
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} onpointerdown={handleWindowPointerDown} />

{#if musicPage === "playlist-builder"}
  <MusicPlaylistBuilderView onBack={closePlaylistBuilder} />
{:else}
<section
    class="flex h-full min-h-0 flex-col text-foreground"
    style="background-color: var(--cal-bg);"
    use:releaseClickedButtonFocusAction
    onwheel={(event) => player.handleVolumeWheel(event)}
  >
  <div class="flex h-(--cal-header-row-h) shrink-0 items-center gap-3 px-2">
    <div class="flex min-w-0 flex-1 items-center gap-2">
      <button
        type="button"
        onclick={openPlaylistBuilder}
        class="inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md border border-border bg-secondary px-2.5 text-[0.8rem] font-medium text-secondary-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        aria-label="Playlist builder"
      >
        <ListPlus size={musicIconSize} strokeWidth={musicIconStrokeWidth} />
        <span>Playlist builder</span>
      </button>
      <div class="hidden min-w-0 overflow-hidden whitespace-nowrap text-[0.8rem] font-medium text-foreground min-[720px]:block">
        {#if topBarMediaTitle}
          <span title={player.currentSource ? player.loadedTitle : undefined}>{topBarMediaTitle}</span>
        {/if}
      </div>
    </div>
    <form
      class="ml-auto flex min-w-0 flex-[0_1_36rem] items-center justify-end gap-2 max-[720px]:flex-1"
      onsubmit={(event) => { event.preventDefault(); void player.loadFromInput(); }}
    >
      <label class="sr-only" for="music-source">Music source</label>
      <div class="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-card px-2.5">
        <LinkIcon class="shrink-0 text-muted-foreground" size={musicIconSize} strokeWidth={musicIconStrokeWidth} />
        <input
          id="music-source"
          bind:value={player.sourceInput}
          class="min-w-0 flex-1 bg-transparent text-[0.8rem] text-foreground outline-none placeholder:text-muted-foreground"
          placeholder="Add a local file path or YouTube link"
          autocomplete="off"
          spellcheck="false"
        />
      </div>
      {#if player.parseError || player.playerError}
        <div class="hidden min-w-0 max-w-56 items-center gap-1.5 text-[0.733333rem] text-destructive min-[680px]:flex">
          <AlertCircle class="shrink-0" size={musicIconSize} strokeWidth={musicIconStrokeWidth} />
          <span class="truncate">{player.parseError ?? player.playerError}</span>
        </div>
      {/if}
      <div class="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onclick={() => { void player.loadFolder(); }}
          disabled={player.sourceActionBusy}
          class="inline-flex h-7 items-center justify-center gap-1.5 rounded-md border border-border bg-secondary px-2.5 text-[0.8rem] font-medium text-secondary-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
        >
          <FolderOpen size={musicIconSize} strokeWidth={musicIconStrokeWidth} />
          <span class="hidden min-[420px]:inline">Folder</span>
        </button>
        <button
          type="submit"
          disabled={player.sourceActionBusy}
          class="inline-flex h-7 items-center justify-center gap-1.5 rounded-md bg-primary px-2.5 text-[0.8rem] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
        >
          {#if player.sourceActionBusy}
            <LoaderCircle class="animate-spin" size={musicIconSize} strokeWidth={musicIconStrokeWidth} />
          {:else}
            <Play size={musicIconSize} strokeWidth={musicIconStrokeWidth} />
          {/if}
          <span class="hidden min-[420px]:inline">Load</span>
        </button>
        <button
          type="button"
          onclick={() => { void player.resetPlayer(); }}
          class="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-secondary text-secondary-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          aria-label="Reset"
          data-app-tooltip-disabled="true"
        >
          <RotateCcw size={musicIconSize} strokeWidth={musicIconStrokeWidth} />
        </button>
      </div>
    </form>
  </div>

  <div
    class={cn(
      "grid min-h-0 flex-1",
      playlistVisible
        ? "grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)] grid-rows-[minmax(0,1fr)_auto] max-[860px]:grid-cols-1 max-[860px]:grid-rows-[minmax(0,1fr)_minmax(7rem,35%)_auto]"
        : "grid-cols-1 grid-rows-[minmax(0,1fr)_auto]",
    )}
  >
    <div class="min-h-0">
      <div
        bind:this={mediaSurface}
        class="music-media-surface relative h-full min-h-48 cursor-default overflow-hidden max-[520px]:min-h-36"
        style="background-color: var(--cal-bg);"
        role="button"
        tabindex="-1"
        aria-label={player.isPlaying ? "Pause" : "Play"}
        data-app-tooltip-disabled="true"
        onclick={handleMediaSurfaceClick}
        ondblclick={handleMediaSurfaceDoubleClick}
        onkeydown={handleMediaSurfaceKeydown}
        onwheel={(event) => player.handleVolumeWheel(event)}
      >
        {#if mediaSurfaceFullscreen && volumeFeedbackVisible}
          <div class="music-volume-feedback pointer-events-none absolute bottom-4 right-4 z-20 select-none text-[0.866667rem] font-medium text-white">
            {player.volumeFeedbackLabel}
          </div>
        {/if}
        {#if player.currentSource?.kind === "local-file" && (!player.localHasVideo || player.snapshot.error)}
          <div class="absolute inset-0 flex items-center justify-center text-muted-foreground" style="background-color: var(--cal-bg);">
            {#if player.currentArtworkUrl && !player.snapshot.error}
              <img
                src={player.currentArtworkUrl}
                alt=""
                class="absolute inset-0 h-full w-full object-contain"
                draggable="false"
                onload={() => player.handleArtworkLoaded()}
                onerror={() => player.handleArtworkError()}
              />
            {/if}
            {#if player.snapshot.error}
              <div class="flex max-w-[80%] flex-col items-center gap-2 text-center text-[0.8rem]">
                <AlertCircle size={musicIconSize} strokeWidth={musicIconStrokeWidth} />
                <span class="max-w-full truncate">{player.snapshot.error ?? player.loadedTitle}</span>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </div>

    {#if playlistVisible}
      <aside id="music-playlist" class="min-h-0" style="background-color: var(--cal-bg);">
        <div class="flex h-full min-h-0 flex-col">
          <div class="flex items-center justify-between gap-2 px-4 py-3">
            <div class="flex items-center gap-2 text-[0.8rem] font-medium text-muted-foreground">
              <ListMusic size={musicIconSize} strokeWidth={musicIconStrokeWidth} />
              Playlist
            </div>
            {#if player.queue.length > 0}
              <div class="text-[0.733333rem] text-muted-foreground">{player.queue.length} tracks</div>
            {/if}
          </div>

          {#if player.folderScanTruncated}
            <div class="mx-4 mt-3 rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-[0.733333rem] text-warning">
              Showing the first 5000 media files.
            </div>
          {/if}

          <div class="relative min-h-0 flex-1">
            <div
              bind:this={playlistScrollContainer}
              class="hide-scrollbar h-full min-h-0 overflow-y-auto overflow-x-hidden px-3 pb-3 pt-0"
              data-music-scrollable="true"
            >
              {#if player.queue.length === 0}
                <div class="p-3 text-[0.8rem] text-muted-foreground">
                  Add a source or pick a folder to start a playlist.
                </div>
              {:else}
                <div class="flex flex-col">
                  {#each player.queue as item, index}
                    <button
                      type="button"
                      data-playlist-index={index}
                      onclick={() => { void player.playQueueItem(index); }}
                      class={cn(
                        "flex w-full min-w-0 items-center px-2 py-2 text-left text-[0.8rem] first:rounded-t-md last:rounded-b-md",
                        player.highlightedQueueIndex === index && "bg-accent text-accent-foreground",
                      )}
                    >
                      <span class="min-w-0 truncate">{item.title}</span>
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
            <CalendarScrollbar scrollContainer={playlistScrollContainer} wheelPassthrough />
          </div>
        </div>
      </aside>
    {/if}

    <div
      class={cn("px-2 py-2", playlistVisible && "col-span-2 max-[860px]:col-span-1")}
      style="background-color: var(--cal-bg);"
    >
      {#key player.currentSource?.identity ?? "empty"}
        <div class="flex items-center gap-2 text-[0.733333rem] tabular-nums text-muted-foreground">
          <span class="shrink-0 text-left">{formatPlaybackTime(player.snapshot.positionMs)}</span>
          <input
            type="range"
            min="0"
            max={player.progressMax}
            value={player.progressValue}
            disabled={!player.currentSource}
            class="h-2 min-w-0 flex-1 accent-primary disabled:opacity-50"
            aria-label="Seek"
            tabindex="-1"
            oninput={(event) => { void player.seekToMs(Number(event.currentTarget.value)); }}
            onpointerup={releaseRangeFocus}
            onpointercancel={releaseRangeFocus}
          />
          <span class="shrink-0 text-right">{formatPlaybackTime(player.snapshot.durationMs)}</span>
        </div>
      {/key}

      <div class="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <button
            type="button"
            onclick={() => { void player.playPreviousTrack(); }}
            disabled={!player.canPlayPreviousTrack}
            class="inline-flex h-9 w-9 items-center justify-center rounded-md bg-secondary text-secondary-foreground transition-colors disabled:pointer-events-none disabled:opacity-50"
            title="Last track (Ctrl + ←)"
            aria-label="Last track"
          >
            <SkipBack size={musicIconSize} strokeWidth={musicIconStrokeWidth} />
          </button>
          <button
            type="button"
            onclick={() => { void player.togglePlay(); }}
            disabled={!player.currentSource}
            class="inline-flex h-9 w-9 items-center justify-center rounded-md bg-secondary text-secondary-foreground transition-colors disabled:pointer-events-none disabled:opacity-50"
            title={player.isPlaying ? "Pause (Spacebar key)" : "Play (Spacebar key)"}
            aria-label={player.isPlaying ? "Pause" : "Play"}
          >
            {#if player.isPlaying}
              <Pause size={musicIconSize} strokeWidth={musicIconStrokeWidth} />
            {:else}
              <Play size={musicIconSize} strokeWidth={musicIconStrokeWidth} />
            {/if}
          </button>
          <button
            type="button"
            onclick={() => { void player.playNextTrack(); }}
            disabled={!player.canPlayNextTrack}
            class="inline-flex h-9 w-9 items-center justify-center rounded-md bg-secondary text-secondary-foreground transition-colors disabled:pointer-events-none disabled:opacity-50"
            title="Next track (Ctrl + →)"
            aria-label="Next track"
          >
            <SkipForward size={musicIconSize} strokeWidth={musicIconStrokeWidth} />
          </button>
          <button
            type="button"
            onclick={() => player.toggleShuffle()}
            disabled={player.queue.length < 2}
            class={cn(
              "inline-flex h-9 w-9 items-center justify-center rounded-md bg-secondary text-secondary-foreground transition-colors disabled:pointer-events-none disabled:opacity-50",
              !player.shuffleEnabled && "text-muted-foreground opacity-70",
            )}
            title={player.shuffleEnabled ? "Shuffle on (S key)" : "Shuffle off (S key)"}
            aria-label={player.shuffleEnabled ? "Shuffle on" : "Shuffle off"}
            aria-pressed={player.shuffleEnabled}
          >
            <Shuffle size={musicIconSize} strokeWidth={musicIconStrokeWidth} />
          </button>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <div
            class="flex items-center gap-2 text-[0.8rem] text-muted-foreground"
            data-music-volume-control="true"
            onwheel={(event) => player.handleVolumeWheel(event)}
          >
            <input
              type="range"
              min="0"
              max={volumeMax}
              step={volumeShortcutStep}
              value={player.volumeControlValue}
              class="music-volume-slider block w-28"
              style={`--music-volume-progress: ${volumeSliderProgress};`}
              aria-label="Volume"
              data-app-tooltip="Volume (↑ and ↓ keys or scroll wheel)"
              tabindex="-1"
              oninput={(event) => { setVolumeFromControl(Number(event.currentTarget.value)); }}
              onpointerup={releaseRangeFocus}
              onpointercancel={releaseRangeFocus}
            />
            <button
              type="button"
              onclick={() => { void player.toggleMute(); }}
              class={cn(
                "inline-flex h-8 min-w-10 items-center justify-end tabular-nums",
                player.muted && "line-through opacity-60",
              )}
              title={player.muted ? "Unmute (M key)" : "Mute (M key)"}
              aria-label={player.muted ? "Unmute volume" : "Mute volume"}
              aria-pressed={player.muted}
            >
              {player.volumePercentLabel}
            </button>
          </div>

          <div bind:this={speedMenuRoot} class="relative">
            <button
              type="button"
              onclick={openSpeedMenu}
              class="inline-flex h-9 w-9 items-center justify-center rounded-md bg-secondary text-secondary-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              title="Speed (+ and - keys)"
              aria-label="Speed"
              aria-haspopup="menu"
              aria-expanded={speedMenuOpen}
            >
              <Gauge size={musicIconSize} strokeWidth={musicIconStrokeWidth} />
            </button>
            {#if speedMenuOpen}
              <div
                class="absolute bottom-full right-0 z-30 mb-2 w-36 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
                style="max-height: min(14rem, calc(100vh - 2rem));"
              >
                {#if !customSpeedOpen}
                  {#each SPEED_PRESETS as preset}
                    <button
                      type="button"
                      onclick={() => { void applySpeed(preset); }}
                      class="flex h-8 w-full items-center justify-between rounded-sm px-2 text-left text-[0.8rem] hover:bg-accent hover:text-accent-foreground"
                    >
                      <span>{preset}x</span>
                      {#if Math.abs(player.snapshot.rate - preset) < 0.001}
                        <Check size={musicIconSize} strokeWidth={musicIconStrokeWidth} />
                      {/if}
                    </button>
                  {/each}
                  <button
                    type="button"
                    onclick={openCustomSpeed}
                    class="flex h-8 w-full items-center justify-between rounded-sm px-2 text-left text-[0.8rem] hover:bg-accent hover:text-accent-foreground"
                  >
                    <span>Custom</span>
                    {#if !activeSpeedIsPreset}
                      <Check size={musicIconSize} strokeWidth={musicIconStrokeWidth} />
                    {/if}
                  </button>
                {:else}
                  <form class="flex items-center gap-2 p-1" onsubmit={(event) => { event.preventDefault(); void applyCustomSpeed(); }}>
                    <input
                      bind:value={customRateDraft}
                      type="number"
                      min="0.25"
                      max="2"
                      step="0.05"
                      class="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-[0.8rem] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                      aria-label="Custom playback speed"
                    />
                    <button
                      type="submit"
                      class="inline-flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
                      aria-label="Apply custom speed"
                    >
                      <Check size={musicIconSize} strokeWidth={musicIconStrokeWidth} />
                    </button>
                  </form>
                {/if}
              </div>
            {/if}
          </div>
          <button
            type="button"
            onclick={togglePlaylist}
            class="inline-flex h-9 w-9 items-center justify-center rounded-md bg-secondary text-secondary-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            title={playlistVisible ? "Hide playlist (P key)" : "Show playlist (P key)"}
            aria-label={playlistVisible ? "Hide playlist" : "Show playlist"}
            aria-controls="music-playlist"
            aria-expanded={playlistVisible}
          >
            <ListMusic size={musicIconSize} strokeWidth={musicIconStrokeWidth} />
          </button>
        </div>
      </div>
    </div>
  </div>
</section>
{/if}

<style>
  .music-volume-slider {
    --music-volume-thumb-size: 0.875rem;
    --music-volume-track-height: 0.25rem;
    --music-volume-track-color: color-mix(in srgb, var(--foreground) 22%, transparent);
    --music-volume-thumb-border: color-mix(in srgb, var(--foreground) 18%, transparent);

    height: var(--music-volume-thumb-size);
    appearance: none;
    cursor: pointer;
    background:
      linear-gradient(
        to right,
        var(--primary) 0%,
        var(--primary) var(--music-volume-progress),
        var(--music-volume-track-color) var(--music-volume-progress),
        var(--music-volume-track-color) 100%
      )
      center / calc(100% - var(--music-volume-thumb-size)) var(--music-volume-track-height) no-repeat;
  }

  .music-volume-slider::-webkit-slider-runnable-track {
    height: var(--music-volume-track-height);
    border-radius: 999px;
    background: transparent;
  }

  .music-volume-slider::-webkit-slider-thumb {
    width: var(--music-volume-thumb-size);
    height: var(--music-volume-thumb-size);
    margin-top: calc((var(--music-volume-track-height) - var(--music-volume-thumb-size)) / 2);
    appearance: none;
    border: 1px solid var(--music-volume-thumb-border);
    border-radius: 999px;
    background: var(--card);
  }

  .music-volume-slider::-moz-range-track,
  .music-volume-slider::-moz-range-progress {
    height: var(--music-volume-track-height);
    border-radius: 999px;
    background: transparent;
  }

  .music-volume-slider::-moz-range-thumb {
    width: var(--music-volume-thumb-size);
    height: var(--music-volume-thumb-size);
    border: 1px solid var(--music-volume-thumb-border);
    border-radius: 999px;
    background: var(--card);
  }
</style>
