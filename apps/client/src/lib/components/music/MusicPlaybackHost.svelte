<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { getMusicPlayer } from "$lib/stores/music-player.svelte";

  const player = getMusicPlayer();

  let hostElement = $state<HTMLDivElement | null>(null);
  let youtubeFrame = $state<HTMLIFrameElement | null>(null);
  let localMediaElement = $state<HTMLMediaElement | null>(null);
  let surfaceRect = $state<DOMRect | null>(null);
  let surfaceFullscreen = $state(false);
  let volumeFeedbackVisible = $state(false);
  let surfaceClickTimeoutId: number | null = null;
  let volumeFeedbackTimeoutId: number | null = null;
  let lastVolumeFeedbackId = 0;

  const mediaSurfaceFullscreenEvent = "ganbaruai-music-media-surface-fullscreen";
  const hasVisualSurface = $derived(Boolean(
    player.surfaceElement
      && player.currentSource
      && (player.isYouTubeActive || (player.currentSource.kind === "local-file" && player.localHasVideo)),
  ));
  const hasFullscreenSurface = $derived(Boolean(player.surfaceElement && player.currentSource));
  const hostIsFullscreen = $derived(Boolean(
    surfaceFullscreen
      && hostElement
      && typeof document !== "undefined"
      && document.fullscreenElement === hostElement,
  ));
  const hostStyle = $derived(hostIsFullscreen && hasVisualSurface
    ? "left: 0; top: 0; width: 100vw; height: 100vh; background-color: #000;"
    : surfaceRect && hasVisualSurface
      ? `left: ${surfaceRect.left}px; top: ${surfaceRect.top}px; width: ${surfaceRect.width}px; height: ${surfaceRect.height}px; background-color: var(--cal-bg);`
      : "left: -10000px; top: -10000px; width: 1px; height: 1px; background-color: var(--cal-bg);");

  onMount(() => {
    player.init();
  });

  onDestroy(() => {
    clearSurfaceClickTimeout();
    clearVolumeFeedbackTimeout();
    player.destroy();
  });

  $effect(() => {
    player.registerYouTubeFrame(youtubeFrame);
  });

  $effect(() => {
    player.registerLocalMedia(localMediaElement);
  });

  $effect(() => {
    player.syncNativeLocalSurface(surfaceRect);
  });

  function handleSurfacePointerDown(event: PointerEvent): void {
    event.preventDefault();
  }

  function handleSurfaceClick(event: MouseEvent): void {
    event.preventDefault();
    if (event.button !== 0) return;
    if (event.detail > 1) return;
    clearSurfaceClickTimeout();
    surfaceClickTimeoutId = window.setTimeout(() => {
      surfaceClickTimeoutId = null;
      void player.togglePlay();
    }, 250);
  }

  function handleSurfaceDoubleClick(event: MouseEvent): void {
    event.preventDefault();
    if (event.button !== 0) return;
    clearSurfaceClickTimeout();
    void toggleSurfaceFullscreen();
  }

  function clearSurfaceClickTimeout(): void {
    if (surfaceClickTimeoutId === null) return;
    window.clearTimeout(surfaceClickTimeoutId);
    surfaceClickTimeoutId = null;
  }

  function clearVolumeFeedbackTimeout(): void {
    if (volumeFeedbackTimeoutId === null) return;
    window.clearTimeout(volumeFeedbackTimeoutId);
    volumeFeedbackTimeoutId = null;
  }

  function showVolumeFeedback(): void {
    clearVolumeFeedbackTimeout();
    volumeFeedbackVisible = true;
    volumeFeedbackTimeoutId = window.setTimeout(() => {
      volumeFeedbackVisible = false;
      volumeFeedbackTimeoutId = null;
    }, 900);
  }

  function handleWindowKeydown(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key.toLowerCase() !== "f") return;
    if (!hasFullscreenSurface || isEditableTarget(event.target)) return;
    event.preventDefault();
    void toggleSurfaceFullscreen();
  }

  function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
  }

  function handleFullscreenSurfaceKeydown(event: KeyboardEvent): void {
    if (!surfaceFullscreen || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.code === "Space" || event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      void player.togglePlay();
      return;
    }
    if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      event.stopPropagation();
      void toggleSurfaceFullscreen();
    }
  }

  async function toggleSurfaceFullscreen(): Promise<void> {
    if (typeof document === "undefined" || !document.fullscreenEnabled) return;
    const target = fullscreenTargetElement();
    if (!target) return;
    try {
      if (surfaceFullscreen) {
        await document.exitFullscreen();
      } else {
        await target.requestFullscreen({ navigationUI: "hide" });
        target.focus({ preventScroll: true });
      }
    } catch (error) {
      console.warn("Unable to toggle music fullscreen.", error);
    }
  }

  function fullscreenTargetElement(): HTMLElement | null {
    if (!hasFullscreenSurface) return null;
    if (hasVisualSurface && hostElement) return hostElement;
    return player.surfaceElement;
  }

  $effect(() => {
    const element = player.surfaceElement;
    if (!element) {
      surfaceRect = null;
      return;
    }

    const updateRect = () => {
      const rectElement = hostIsFullscreen && hostElement ? hostElement : element;
      surfaceRect = rectElement.getBoundingClientRect();
    };
    updateRect();

    const observer = new ResizeObserver(updateRect);
    observer.observe(element);
    if (hostElement) {
      observer.observe(hostElement);
    }
    window.addEventListener("resize", updateRect);
    window.addEventListener("scroll", updateRect, true);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", updateRect, true);
    };
  });

  $effect(() => {
    if (typeof document === "undefined") return;
    const updateFullscreenState = () => {
      surfaceFullscreen = Boolean(
        document.fullscreenElement
          && (document.fullscreenElement === hostElement || document.fullscreenElement === player.surfaceElement),
      );
      if (surfaceFullscreen && document.fullscreenElement instanceof HTMLElement) {
        document.fullscreenElement.focus({ preventScroll: true });
      }
    };
    updateFullscreenState();
    document.addEventListener("fullscreenchange", updateFullscreenState);
    return () => {
      document.removeEventListener("fullscreenchange", updateFullscreenState);
    };
  });

  $effect(() => {
    if (!surfaceFullscreen || hasFullscreenSurface || typeof document === "undefined") return;
    if (document.fullscreenElement === hostElement || document.fullscreenElement === player.surfaceElement) {
      void document.exitFullscreen();
    }
  });

  $effect(() => {
    if (typeof window === "undefined") return;
    const handleMediaSurfaceFullscreenRequest = () => {
      void toggleSurfaceFullscreen();
    };
    window.addEventListener(mediaSurfaceFullscreenEvent, handleMediaSurfaceFullscreenRequest);
    return () => {
      window.removeEventListener(mediaSurfaceFullscreenEvent, handleMediaSurfaceFullscreenRequest);
    };
  });

  $effect(() => {
    const feedbackId = player.volumeFeedbackId;
    if (feedbackId === lastVolumeFeedbackId) return;
    lastVolumeFeedbackId = feedbackId;
    if (!hostIsFullscreen) return;
    showVolumeFeedback();
  });
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<div
  bind:this={hostElement}
  class="music-playback-host pointer-events-none fixed z-20 overflow-hidden"
  style={hostStyle}
  tabindex="-1"
  aria-hidden={!hasVisualSurface}
  onkeydown={handleFullscreenSurfaceKeydown}
>
  {#if player.currentSource && player.isYouTubeActive}
    {#key player.youtubeHostUrl}
      <iframe
        bind:this={youtubeFrame}
        class="pointer-events-none h-full w-full"
        src={player.youtubeHostUrl ?? "about:blank"}
        title={player.loadedTitle}
        allow="autoplay; encrypted-media"
        referrerpolicy="strict-origin-when-cross-origin"
      ></iframe>
    {/key}
  {:else if player.currentSource?.kind === "local-file"}
    {#if player.localMediaSrc && player.localHasVideo && !player.localNativeVideo}
      {#key player.localMediaSrc}
        <video
          bind:this={localMediaElement}
          class="pointer-events-none h-full w-full object-contain transition-opacity duration-75"
          style="background-color: var(--cal-bg);"
          class:opacity-0={!player.localVideoReady}
          class:opacity-100={player.localVideoReady}
          src={player.localMediaSrc}
          crossorigin="anonymous"
          playsinline
          onloadedmetadata={(event) => player.handleLocalLoadedMetadata(event)}
          onloadeddata={(event) => player.handleLocalLoadedData(event)}
          ontimeupdate={(event) => player.handleLocalTimeUpdate(event)}
          onplay={(event) => player.handleLocalPlay(event)}
          onpause={(event) => player.handleLocalPause(event)}
          onended={(event) => { void player.handleLocalEnded(event); }}
          onerror={(event) => player.handleLocalError(event)}
        >
          <track kind="captions" />
        </video>
      {/key}
    {/if}
  {/if}
  {#if hasVisualSurface}
    {#if hostIsFullscreen && volumeFeedbackVisible}
      <div class="music-volume-feedback pointer-events-none absolute bottom-4 right-4 z-20 select-none text-[13px] font-medium text-white">
        {player.volumeFeedbackLabel}
      </div>
    {/if}
    <button
      type="button"
      tabindex="-1"
      class="pointer-events-auto absolute inset-0 z-10 cursor-default border-0 bg-transparent p-0 text-transparent outline-none focus:outline-none"
      aria-label={player.isPlaying ? "Pause" : "Play"}
      onpointerdown={handleSurfacePointerDown}
      onclick={handleSurfaceClick}
      ondblclick={handleSurfaceDoubleClick}
      onkeydown={handleFullscreenSurfaceKeydown}
      onwheel={(event) => player.handleVolumeWheel(event)}
    ></button>
  {/if}
</div>

<style>
  :global(.music-media-surface:fullscreen) {
    width: 100vw;
    height: 100vh;
    background-color: #000 !important;
  }

  :global(.music-media-surface:fullscreen > div),
  :global(.music-playback-host:fullscreen),
  :global(.music-playback-host:fullscreen video) {
    background-color: #000 !important;
  }

  :global(.music-volume-feedback) {
    text-shadow:
      0 0 1px #000,
      0 1px 2px rgb(0 0 0 / 0.95),
      1px 0 2px rgb(0 0 0 / 0.95),
      0 -1px 2px rgb(0 0 0 / 0.95),
      -1px 0 2px rgb(0 0 0 / 0.95);
  }

  :global(.music-playback-host:fullscreen *),
  :global(.music-media-surface:fullscreen),
  :global(.music-media-surface:fullscreen *) {
    cursor: none;
  }
</style>
