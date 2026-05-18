<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { getMusicPlayer } from "$lib/stores/music-player.svelte";

  const player = getMusicPlayer();

  let hostElement = $state<HTMLDivElement | null>(null);
  let youtubeFrame = $state<HTMLIFrameElement | null>(null);
  let localMediaElement = $state<HTMLMediaElement | null>(null);
  let surfaceRect = $state<DOMRect | null>(null);
  let surfaceFullscreen = $state(false);
  let surfaceClickTimeoutId: number | null = null;

  const hasVisualSurface = $derived(Boolean(
    player.surfaceElement
      && player.currentSource
      && (player.isYouTubeActive || (player.currentSource.kind === "local-file" && player.localHasVideo)),
  ));
  const hostStyle = $derived(surfaceFullscreen && hasVisualSurface
    ? "left: 0; top: 0; width: 100vw; height: 100vh; background-color: var(--cal-bg);"
    : surfaceRect && hasVisualSurface
      ? `left: ${surfaceRect.left}px; top: ${surfaceRect.top}px; width: ${surfaceRect.width}px; height: ${surfaceRect.height}px; background-color: var(--cal-bg);`
      : "left: -10000px; top: -10000px; width: 1px; height: 1px; background-color: var(--cal-bg);");

  onMount(() => {
    player.init();
  });

  onDestroy(() => {
    clearSurfaceClickTimeout();
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

  function handleWindowKeydown(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key.toLowerCase() !== "f") return;
    if (!hasVisualSurface || isEditableTarget(event.target)) return;
    event.preventDefault();
    void toggleSurfaceFullscreen();
  }

  function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
  }

  async function toggleSurfaceFullscreen(): Promise<void> {
    if (!hostElement || !hasVisualSurface || typeof document === "undefined" || !document.fullscreenEnabled) return;
    try {
      if (document.fullscreenElement === hostElement) {
        await document.exitFullscreen();
      } else {
        await hostElement.requestFullscreen({ navigationUI: "hide" });
      }
    } catch (error) {
      console.warn("Unable to toggle music fullscreen.", error);
    }
  }

  $effect(() => {
    const element = player.surfaceElement;
    if (!element) {
      surfaceRect = null;
      return;
    }

    const updateRect = () => {
      const rectElement = surfaceFullscreen && hostElement ? hostElement : element;
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
      surfaceFullscreen = Boolean(hostElement && document.fullscreenElement === hostElement);
    };
    updateFullscreenState();
    document.addEventListener("fullscreenchange", updateFullscreenState);
    return () => {
      document.removeEventListener("fullscreenchange", updateFullscreenState);
    };
  });

  $effect(() => {
    if (!surfaceFullscreen || hasVisualSurface || typeof document === "undefined") return;
    if (hostElement && document.fullscreenElement === hostElement) {
      void document.exitFullscreen();
    }
  });
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<div
  bind:this={hostElement}
  class="pointer-events-none fixed z-20 overflow-hidden"
  style={hostStyle}
  aria-hidden={!hasVisualSurface}
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
    <button
      type="button"
      tabindex="-1"
      class="pointer-events-auto absolute inset-0 z-10 cursor-default border-0 bg-transparent p-0 text-transparent outline-none focus:outline-none"
      aria-label={player.isPlaying ? "Pause" : "Play"}
      onpointerdown={handleSurfacePointerDown}
      onclick={handleSurfaceClick}
      ondblclick={handleSurfaceDoubleClick}
      onwheel={(event) => player.handleVolumeWheel(event)}
    ></button>
  {/if}
</div>
