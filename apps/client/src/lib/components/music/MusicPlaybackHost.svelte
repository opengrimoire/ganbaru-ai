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
      class="pointer-events-auto h-full w-full"
      src={player.youtubeHostUrl ?? "about:blank"}
      title={player.loadedTitle}
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      referrerpolicy="strict-origin-when-cross-origin"
      allowfullscreen
    ></iframe>
  {:else if player.currentSource?.kind === "local-file"}
    {#if player.localMediaSrc && player.localHasVideo}
      <video
        bind:this={localMediaElement}
        class="h-full w-full bg-black object-contain"
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
    {:else if player.localMediaSrc}
      <audio
        bind:this={localMediaElement}
        src={player.localMediaSrc}
        crossorigin="anonymous"
        onloadedmetadata={(event) => player.handleLocalLoadedMetadata(event)}
        ontimeupdate={(event) => player.handleLocalTimeUpdate(event)}
        onplay={(event) => player.handleLocalPlay(event)}
        onpause={(event) => player.handleLocalPause(event)}
        onended={(event) => { void player.handleLocalEnded(event); }}
        onerror={(event) => player.handleLocalError(event)}
      ></audio>
    {/if}
  {/if}
</div>
