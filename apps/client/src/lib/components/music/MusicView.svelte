<script lang="ts">
  import AlertCircle from "@lucide/svelte/icons/alert-circle";
  import Check from "@lucide/svelte/icons/check";
  import FileAudio from "@lucide/svelte/icons/file-audio";
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
  import Volume2 from "@lucide/svelte/icons/volume-2";
  import VolumeX from "@lucide/svelte/icons/volume-x";
  import { SPEED_PRESETS, clampRate, formatPlaybackTime, isSpeedPreset } from "$lib/music/playback";
  import { getMusicPlayer } from "$lib/stores/music-player.svelte";
  import { cn } from "$lib/utils";

  const player = getMusicPlayer();

  let mediaSurface = $state<HTMLElement | null>(null);
  let speedMenuRoot = $state<HTMLElement | null>(null);
  let speedMenuOpen = $state(false);
  let customSpeedOpen = $state(false);
  let customRateDraft = $state("1");

  const volumeMax = $derived(player.isYouTubeActive ? 1 : 1.5);
  const activeSpeedIsPreset = $derived(isSpeedPreset(player.snapshot.rate));

  $effect(() => {
    player.setSurfaceElement(mediaSurface);
    return () => {
      player.setSurfaceElement(null);
    };
  });

  function handleKeydown(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (isEditableTarget(event.target)) return;
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
</script>

<svelte:window onkeydown={handleKeydown} onpointerdown={handleWindowPointerDown} />

<section class="flex h-full min-h-0 flex-col bg-background text-foreground" onwheel={(event) => player.handleVolumeWheel(event)}>
  <div class="border-b border-border px-4 py-3 max-[520px]:px-3 max-[520px]:py-2">
    <form
      class="flex min-w-0 items-center gap-2 max-[560px]:flex-col max-[560px]:items-stretch"
      onsubmit={(event) => { event.preventDefault(); void player.loadFromInput(); }}
    >
      <label class="sr-only" for="music-source">Music source</label>
      <div class="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-card px-3 py-2">
        <LinkIcon class="shrink-0 text-muted-foreground" size={16} strokeWidth={2.25} />
        <input
          id="music-source"
          bind:value={player.sourceInput}
          class="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
          placeholder="Add a local file path or YouTube link"
          autocomplete="off"
          spellcheck="false"
        />
      </div>
      <div class="flex items-center gap-2 max-[560px]:justify-end">
        <button
          type="button"
          onclick={() => { void player.loadFolder(); }}
          disabled={player.isBusy}
          class="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-secondary px-3 text-[13px] font-medium text-secondary-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
        >
          <FolderOpen size={15} strokeWidth={2.25} />
          Folder
        </button>
        <button
          type="submit"
          disabled={player.isBusy}
          class="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
        >
          {#if player.isBusy}
            <LoaderCircle class="animate-spin" size={15} strokeWidth={2.25} />
          {:else}
            <Play size={15} strokeWidth={2.25} />
          {/if}
          Load
        </button>
        <button
          type="button"
          onclick={() => { void player.resetPlayer(); }}
          class="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-secondary text-secondary-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          title="Reset"
          aria-label="Reset"
        >
          <RotateCcw size={15} strokeWidth={2.25} />
        </button>
      </div>
    </form>
    {#if player.parseError || player.playerError}
      <div class="mt-2 flex items-center gap-2 text-[12px] text-destructive">
        <AlertCircle size={14} strokeWidth={2.25} />
        <span>{player.parseError ?? player.playerError}</span>
      </div>
    {/if}
  </div>

  <div class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)] max-[860px]:grid-cols-1">
    <div class="flex min-h-0 flex-col">
      <div
        bind:this={mediaSurface}
        class="relative min-h-48 flex-1 overflow-hidden bg-black max-[520px]:min-h-36"
      >
        {#if player.currentSource?.kind === "local-file"}
          {#if !player.localHasVideo || player.snapshot.status === "loading" || player.snapshot.error}
            <div class="absolute inset-0 flex items-center justify-center bg-black text-white/70">
              {#if player.currentArtworkUrl && !player.snapshot.error}
                <img
                  src={player.currentArtworkUrl}
                  alt=""
                  class="absolute inset-0 h-full w-full object-contain"
                  draggable="false"
                  onerror={() => player.handleArtworkError()}
                />
              {/if}
              <div class="flex max-w-[80%] flex-col items-center gap-2 text-center text-[12px]">
                {#if player.snapshot.status === "loading"}
                  <LoaderCircle class="animate-spin" size={22} strokeWidth={2.25} />
                {:else if player.snapshot.error}
                  <AlertCircle size={22} strokeWidth={2.25} />
                {:else if !player.currentArtworkUrl}
                  <FileAudio size={24} strokeWidth={2.25} />
                {/if}
                {#if player.snapshot.error || !player.currentArtworkUrl}
                  <span class="max-w-full truncate">{player.snapshot.error ?? player.loadedTitle}</span>
                {/if}
              </div>
            </div>
          {/if}
        {:else if !player.currentSource}
          <div class="absolute inset-0 flex items-center justify-center bg-black text-white/60">
            <FileAudio size={28} strokeWidth={2.25} />
          </div>
        {/if}
      </div>

      <div class="border-t border-border bg-card px-4 py-3 max-[520px]:px-3">
        <div class="mb-2 flex min-w-0 items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="truncate text-[15px] font-medium">{player.loadedTitle}</div>
          </div>
          <div class="shrink-0 text-[12px] tabular-nums text-muted-foreground">
            {formatPlaybackTime(player.snapshot.positionMs)} / {formatPlaybackTime(player.snapshot.durationMs)}
          </div>
        </div>

        <input
          type="range"
          min="0"
          max={player.progressMax}
          value={player.progressValue}
          disabled={!player.currentSource}
          class="h-2 w-full accent-primary disabled:opacity-50"
          aria-label="Seek"
          oninput={(event) => { void player.seekToMs(Number(event.currentTarget.value)); }}
        />

        <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-2">
            <button
              type="button"
              onclick={() => { void player.playPreviousTrack(); }}
              disabled={!player.canPlayPreviousTrack}
              class="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-secondary text-secondary-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
              title="Last played track"
              aria-label="Last played track"
            >
              <SkipBack size={15} strokeWidth={2.25} />
            </button>
            <button
              type="button"
              onclick={() => { void player.togglePlay(); }}
              disabled={!player.currentSource || player.isBusy}
              class={cn(
                "inline-flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground transition-colors hover:bg-primary/90",
                (!player.currentSource || player.isBusy) && "pointer-events-none opacity-50",
              )}
              title={player.isPlaying ? "Pause" : "Play"}
              aria-label={player.isPlaying ? "Pause" : "Play"}
            >
              {#if player.isPlaying}
                <Pause size={17} strokeWidth={2.25} />
              {:else}
                <Play size={17} strokeWidth={2.25} />
              {/if}
            </button>
            <button
              type="button"
              onclick={() => { void player.playNextTrack(); }}
              disabled={!player.canPlayNextTrack}
              class="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-secondary text-secondary-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
              title="Next track"
              aria-label="Next track"
            >
              <SkipForward size={15} strokeWidth={2.25} />
            </button>
            <button
              type="button"
              onclick={() => player.toggleShuffle()}
              disabled={player.queue.length < 2}
              class={cn(
                "inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-secondary text-secondary-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50",
                player.shuffleEnabled && "border-primary bg-primary/15 text-primary",
              )}
              title={player.shuffleEnabled ? "Shuffle on" : "Shuffle off"}
              aria-label={player.shuffleEnabled ? "Shuffle on" : "Shuffle off"}
              aria-pressed={player.shuffleEnabled}
            >
              <Shuffle size={15} strokeWidth={2.25} />
            </button>
          </div>

          <div class="flex flex-wrap items-center gap-3">
            <div
              class="flex items-center gap-2 text-[12px] text-muted-foreground"
              data-music-volume-control="true"
              onwheel={(event) => player.handleVolumeWheel(event)}
            >
              <button
                type="button"
                onclick={() => { void player.toggleMute(); }}
                class={cn(
                  "inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-secondary text-secondary-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                  player.muted && "text-muted-foreground opacity-70",
                )}
                title={player.muted ? "Unmute" : "Mute"}
                aria-label={player.muted ? "Unmute" : "Mute"}
                aria-pressed={player.muted}
              >
                {#if player.muted}
                  <VolumeX size={15} strokeWidth={2.25} />
                {:else}
                  <Volume2
                    size={15}
                    strokeWidth={2.25}
                    class={player.volumeBoosted ? "text-warning" : undefined}
                  />
                {/if}
              </button>
              <input
                type="range"
                min="0"
                max={volumeMax}
                step="0.01"
                value={Math.min(player.snapshot.volume, volumeMax)}
                class={cn("block w-28", player.volumeBoosted ? "accent-warning" : "accent-primary")}
                aria-label="Volume"
                oninput={(event) => { void player.setVolume(Number(event.currentTarget.value)); }}
              />
              <span
                class={cn(
                  "min-w-10 text-right tabular-nums",
                  player.muted && "line-through opacity-60",
                  player.volumeBoosted && !player.muted && "text-warning",
                )}
              >
                {player.volumePercentLabel}
              </span>
            </div>

            <div bind:this={speedMenuRoot} class="relative">
              <button
                type="button"
                onclick={openSpeedMenu}
                class="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-secondary px-3 text-[12px] font-medium text-secondary-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                aria-haspopup="menu"
                aria-expanded={speedMenuOpen}
              >
                <Gauge size={15} strokeWidth={2.25} />
                {player.speedLabel}
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
                          <Check size={14} strokeWidth={2.25} />
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
                        <Check size={14} strokeWidth={2.25} />
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
                        <Check size={14} strokeWidth={2.25} />
                      </button>
                    </form>
                  {/if}
                </div>
              {/if}
            </div>
          </div>
        </div>
      </div>
    </div>

    <aside class="min-h-0 border-l border-border bg-sidebar max-[860px]:border-l-0 max-[860px]:border-t">
      <div class="flex h-full min-h-0 flex-col">
        <div class="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div class="flex items-center gap-2 text-[12px] font-medium text-muted-foreground">
            <ListMusic size={15} strokeWidth={2.25} />
            Queue
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

        <div class="music-queue-scroll min-h-0 flex-1 overflow-auto p-3" data-music-scrollable="true">
          {#if player.queue.length === 0}
            <div class="rounded-md border border-dashed border-border p-3 text-[12px] text-muted-foreground">
              Add a source or pick a folder to start a queue.
            </div>
          {:else}
            <div class="space-y-1">
              {#each player.queue as item, index}
                <button
                  type="button"
                  onclick={() => { void player.playQueueItem(index); }}
                  class={cn(
                    "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left text-[12px] transition-colors hover:bg-accent hover:text-accent-foreground",
                    player.currentSource?.identity === item.identity && "bg-accent text-accent-foreground",
                  )}
                >
                  <FileAudio class="shrink-0" size={14} strokeWidth={2.25} />
                  <span class="min-w-0 truncate">{item.title}</span>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      </div>
    </aside>
  </div>
</section>

<style>
  .music-queue-scroll {
    scrollbar-width: thin;
    scrollbar-color: color-mix(in srgb, var(--muted-foreground) 42%, transparent) transparent;
  }

  .music-queue-scroll::-webkit-scrollbar {
    width: 0.5rem;
  }

  .music-queue-scroll::-webkit-scrollbar-track {
    background: transparent;
  }

  .music-queue-scroll::-webkit-scrollbar-thumb {
    border: 0.125rem solid transparent;
    border-radius: 999px;
    background-color: color-mix(in srgb, var(--muted-foreground) 42%, transparent);
    background-clip: content-box;
  }

  .music-queue-scroll::-webkit-scrollbar-thumb:hover {
    background-color: color-mix(in srgb, var(--muted-foreground) 62%, transparent);
  }
</style>
