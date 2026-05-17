<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { getMusicPlayer } from "$lib/stores/music-player.svelte";

  const player = getMusicPlayer();

  let youtubeFrame = $state<HTMLIFrameElement | null>(null);
  let localMediaElement = $state<HTMLMediaElement | null>(null);
  let surfaceRect = $state<DOMRect | null>(null);

  const hasVisualSurface = $derived(Boolean(
    player.surfaceElement
      && player.currentSource
      && (player.isYouTubeActive || (player.currentSource.kind === "local-file" && player.localHasVideo)),
  ));
  const hostStyle = $derived(surfaceRect && hasVisualSurface
    ? `left: ${surfaceRect.left}px; top: ${surfaceRect.top}px; width: ${surfaceRect.width}px; height: ${surfaceRect.height}px;`
    : "left: -10000px; top: -10000px; width: 1px; height: 1px;");

  onMount(() => {
    player.init();
  });

  onDestroy(() => {
    player.destroy();
  });

  $effect(() => {
    player.registerYouTubeFrame(youtubeFrame);
  });

  $effect(() => {
    player.registerLocalMedia(localMediaElement);
  });

  function handleSurfacePointerDown(event: PointerEvent): void {
    event.preventDefault();
  }

  function handleSurfacePointerUp(event: PointerEvent): void {
    event.preventDefault();
    if (event.button !== 0) return;
    void player.togglePlay();
  }

  $effect(() => {
    const element = player.surfaceElement;
    if (!element) {
      surfaceRect = null;
      return;
    }

    const updateRect = () => {
      surfaceRect = element.getBoundingClientRect();
    };
    updateRect();

    const observer = new ResizeObserver(updateRect);
    observer.observe(element);
    window.addEventListener("resize", updateRect);
    window.addEventListener("scroll", updateRect, true);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", updateRect, true);
    };
  });
</script>

<div
  class="pointer-events-none fixed z-20 overflow-hidden bg-black"
  style={hostStyle}
  aria-hidden={!hasVisualSurface}
>
  {#if player.currentSource && player.isYouTubeActive}
    <iframe
      bind:this={youtubeFrame}
      class="pointer-events-none h-full w-full"
      src={player.youtubeHostUrl ?? "about:blank"}
      title={player.loadedTitle}
      allow="autoplay; encrypted-media"
      referrerpolicy="strict-origin-when-cross-origin"
    ></iframe>
  {:else if player.currentSource?.kind === "local-file"}
    {#if player.localMediaSrc && player.localHasVideo}
      <video
        bind:this={localMediaElement}
        class="pointer-events-none h-full w-full bg-black object-contain"
        src={player.localMediaSrc}
        crossorigin="anonymous"
        playsinline
        onloadedmetadata={(event) => player.handleLocalLoadedMetadata(event)}
        ontimeupdate={(event) => player.handleLocalTimeUpdate(event)}
        onplay={(event) => player.handleLocalPlay(event)}
        onpause={(event) => player.handleLocalPause(event)}
        onended={(event) => { void player.handleLocalEnded(event); }}
        onerror={(event) => player.handleLocalError(event)}
      >
        <track kind="captions" />
      </video>
    {/if}
  {/if}
  {#if hasVisualSurface}
    <button
      type="button"
      tabindex="-1"
      class="pointer-events-auto absolute inset-0 z-10 cursor-pointer border-0 bg-transparent p-0 text-transparent outline-none focus:outline-none"
      aria-label={player.isPlaying ? "Pause" : "Play"}
      onpointerdown={handleSurfacePointerDown}
      onpointerup={handleSurfacePointerUp}
    ></button>
  {/if}
</div>
