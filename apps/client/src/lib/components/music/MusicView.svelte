<script lang="ts">
  import { onDestroy } from "svelte";
  import AlertCircle from "@lucide/svelte/icons/alert-circle";
  import Check from "@lucide/svelte/icons/check";
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import Gauge from "@lucide/svelte/icons/gauge";
  import LinkIcon from "@lucide/svelte/icons/link";
  import ListMusic from "@lucide/svelte/icons/list-music";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import Pause from "@lucide/svelte/icons/pause";
  import Play from "@lucide/svelte/icons/play";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import Shuffle from "@lucide/svelte/icons/shuffle";
  import SkipBack from "@lucide/svelte/icons/skip-back";
  import SkipForward from "@lucide/svelte/icons/skip-forward";
  import CalendarScrollbar from "$lib/components/calendar/CalendarScrollbar.svelte";
  import { SPEED_PRESETS, clampRate, formatPlaybackTime, isSpeedPreset } from "$lib/music/playback";
  import { getMusicPlayer } from "$lib/stores/music-player.svelte";
  import { cn } from "$lib/utils";

  const player = getMusicPlayer();

  let mediaSurface = $state<HTMLElement | null>(null);
  let playlistScrollContainer = $state<HTMLElement | undefined>();
  let speedMenuRoot = $state<HTMLElement | null>(null);
  let speedMenuOpen = $state(false);
  let customSpeedOpen = $state(false);
  let customRateDraft = $state("1");
  let playlistVisible = $state(false);
  let mediaSurfaceFullscreen = $state(false);
  let volumeFeedbackVisible = $state(false);
  let mediaSurfaceClickTimeoutId: number | null = null;
  let volumeFeedbackTimeoutId: number | null = null;
  let lastVolumeFeedbackId = 0;

  const mediaSurfaceFullscreenEvent = "ganbaruai-music-media-surface-fullscreen";
  const volumeMax = $derived(player.volumeMax);
  const activeSpeedIsPreset = $derived(isSpeedPreset(player.snapshot.rate));
  const topBarMediaTitleMaxLength = 42;
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

  function handleKeydown(event: KeyboardEvent): void {
    if (event.altKey || event.metaKey) return;
    if (isEditableTarget(event.target)) return;
    if (event.ctrlKey) {
      if (event.key.toLowerCase() === "l") {
        event.preventDefault();
        playlistVisible = !playlistVisible;
      }
      return;
    }
    if (event.code === "Space") {
      event.preventDefault();
      void player.togglePlay();
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
      void player.adjustVolume(0.05);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      void player.adjustVolume(-0.05);
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

  function handleMediaSurfaceKeydown(event: KeyboardEvent): void {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    void player.togglePlay();
  }
</script>

<svelte:window onkeydown={handleKeydown} onpointerdown={handleWindowPointerDown} />

<section class="flex h-full min-h-0 flex-col text-foreground" style="background-color: var(--cal-bg);" onwheel={(event) => player.handleVolumeWheel(event)}>
  <div class="flex h-(--cal-header-row-h) shrink-0 items-center gap-3 px-3">
    <div
      class="hidden min-w-0 flex-1 overflow-hidden whitespace-nowrap text-[12px] font-medium text-foreground min-[720px]:block"
      title={player.currentSource ? player.loadedTitle : undefined}
    >
      {#if topBarMediaTitle}
        <span>{topBarMediaTitle}</span>
      {/if}
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
          class="min-w-0 flex-1 bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground"
          placeholder="Add a local file path or YouTube link"
          autocomplete="off"
          spellcheck="false"
        />
      </div>
      {#if player.parseError || player.playerError}
        <div class="hidden min-w-0 max-w-56 items-center gap-1.5 text-[11px] text-destructive min-[680px]:flex">
          <AlertCircle class="shrink-0" size={musicIconSize} strokeWidth={musicIconStrokeWidth} />
          <span class="truncate">{player.parseError ?? player.playerError}</span>
        </div>
      {/if}
      <div class="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onclick={() => { void player.loadFolder(); }}
          disabled={player.sourceActionBusy}
          class="inline-flex h-7 items-center justify-center gap-1.5 rounded-md border border-border bg-secondary px-2.5 text-[12px] font-medium text-secondary-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
        >
          <FolderOpen size={musicIconSize} strokeWidth={musicIconStrokeWidth} />
          <span class="hidden min-[420px]:inline">Folder</span>
        </button>
        <button
          type="submit"
          disabled={player.sourceActionBusy}
          class="inline-flex h-7 items-center justify-center gap-1.5 rounded-md bg-primary px-2.5 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
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
          title="Reset"
          aria-label="Reset"
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
        onclick={handleMediaSurfaceClick}
        ondblclick={handleMediaSurfaceDoubleClick}
        onkeydown={handleMediaSurfaceKeydown}
        onwheel={(event) => player.handleVolumeWheel(event)}
      >
        {#if mediaSurfaceFullscreen && volumeFeedbackVisible}
          <div class="pointer-events-none absolute bottom-4 right-4 z-20 select-none text-[13px] font-medium text-white drop-shadow">
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
                onerror={() => player.handleArtworkError()}
              />
            {/if}
            {#if player.snapshot.error}
              <div class="flex max-w-[80%] flex-col items-center gap-2 text-center text-[12px]">
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
            <div class="flex items-center gap-2 text-[12px] font-medium text-muted-foreground">
              <ListMusic size={musicIconSize} strokeWidth={musicIconStrokeWidth} />
              Playlist
            </div>
            {#if player.queue.length > 0}
              <div class="text-[11px] text-muted-foreground">{player.queue.length} tracks</div>
            {/if}
          </div>

          {#if player.folderScanTruncated}
            <div class="mx-4 mt-3 rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-[11px] text-warning">
              Showing the first 5000 media files.
            </div>
          {/if}

          <div class="relative min-h-0 flex-1">
            <div
              bind:this={playlistScrollContainer}
              class="hide-scrollbar h-full min-h-0 overflow-y-auto overflow-x-hidden p-3"
              data-music-scrollable="true"
            >
              {#if player.queue.length === 0}
                <div class="p-3 text-[12px] text-muted-foreground">
                  Add a source or pick a folder to start a playlist.
                </div>
              {:else}
                <div class="flex flex-col">
                  {#each player.queue as item, index}
                    <button
                      type="button"
                      onclick={() => { void player.playQueueItem(index); }}
                      class={cn(
                        "flex w-full min-w-0 items-center px-2 py-2 text-left text-[12px] first:rounded-t-md last:rounded-b-md",
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
      class={cn("px-4 py-2 max-[520px]:px-3", playlistVisible && "col-span-2 max-[860px]:col-span-1")}
      style="background-color: var(--cal-bg);"
    >
      {#key player.currentSource?.identity ?? "empty"}
        <div class="flex items-center gap-2 text-[11px] tabular-nums text-muted-foreground">
          <span class="w-12 shrink-0 text-left">{formatPlaybackTime(player.snapshot.positionMs)}</span>
          <input
            type="range"
            min="0"
            max={player.progressMax}
            value={player.progressValue}
            disabled={!player.currentSource}
            class="h-2 min-w-0 flex-1 accent-primary disabled:opacity-50"
            aria-label="Seek"
            oninput={(event) => { void player.seekToMs(Number(event.currentTarget.value)); }}
          />
          <span class="w-12 shrink-0 text-right">{formatPlaybackTime(player.snapshot.durationMs)}</span>
        </div>
      {/key}

      <div class="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <button
            type="button"
            onclick={() => { void player.playPreviousTrack(); }}
            disabled={!player.canPlayPreviousTrack}
            class="inline-flex h-9 w-9 items-center justify-center rounded-md bg-secondary text-secondary-foreground transition-colors disabled:pointer-events-none disabled:opacity-50"
            title="Last played track (Shift+Left)"
            aria-label="Last played track"
          >
            <SkipBack size={musicIconSize} strokeWidth={musicIconStrokeWidth} />
          </button>
          <button
            type="button"
            onclick={() => { void player.togglePlay(); }}
            disabled={!player.currentSource}
            class="inline-flex h-9 w-9 items-center justify-center rounded-md bg-secondary text-secondary-foreground transition-colors disabled:pointer-events-none disabled:opacity-50"
            title={player.isPlaying ? "Pause (Space)" : "Play (Space)"}
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
            title="Next track (Shift+Right)"
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
            title={player.shuffleEnabled ? "Shuffle on (S)" : "Shuffle off (S)"}
            aria-label={player.shuffleEnabled ? "Shuffle on" : "Shuffle off"}
            aria-pressed={player.shuffleEnabled}
          >
            <Shuffle size={musicIconSize} strokeWidth={musicIconStrokeWidth} />
          </button>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <div
            class="flex items-center gap-2 text-[12px] text-muted-foreground"
            data-music-volume-control="true"
            onwheel={(event) => player.handleVolumeWheel(event)}
          >
            <input
              type="range"
              min="0"
              max={volumeMax}
              step="0.01"
              value={player.volumeControlValue}
              class={cn("block w-28", player.volumeBoosted ? "accent-warning" : "accent-primary")}
              aria-label="Volume"
              oninput={(event) => { void player.setVolume(Number(event.currentTarget.value)); }}
            />
            <button
              type="button"
              onclick={() => { void player.toggleMute(); }}
              class={cn(
                "inline-flex h-8 min-w-10 items-center justify-end tabular-nums",
                player.muted && "line-through opacity-60",
                player.volumeBoosted && !player.muted && "text-warning",
              )}
              title={player.muted ? "Unmute" : "Mute"}
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
              title={`Playback speed (${player.speedLabel}) (+/-)`}
              aria-label="Playback speed"
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
                      class="flex h-8 w-full items-center justify-between rounded-sm px-2 text-left text-[12px] hover:bg-accent hover:text-accent-foreground"
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
                    class="flex h-8 w-full items-center justify-between rounded-sm px-2 text-left text-[12px] hover:bg-accent hover:text-accent-foreground"
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
                      class="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-[12px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
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
            onclick={() => { playlistVisible = !playlistVisible; }}
            class="inline-flex h-9 w-9 items-center justify-center rounded-md bg-secondary text-secondary-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            title={playlistVisible ? "Hide playlist (Ctrl+L)" : "Show playlist (Ctrl+L)"}
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
