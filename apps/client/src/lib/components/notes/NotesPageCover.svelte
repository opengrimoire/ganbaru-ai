<script lang="ts">
  import { notesPageCoverAssetUrl } from "$lib/api/notes-page-covers";
  import NotesCoverDesign from "./NotesCoverDesign.svelte";
  import {
    isNotesPageCoverAssetPath,
    notesPageCoverAssetPath,
    notesPageCoverUrl,
    notesCoverObjectPosition,
    notesCoverFocalPointFromPointer,
    NOTES_COVER_DEFAULT_FOCAL_POINT,
  } from "$lib/notes/page-cover";
  import type { NotesCoverFocalPoint } from "$lib/notes/contracts/assets";
  import type { NotesPageCover } from "$lib/notes/types";
  import { BUILD_PLATFORM_PROFILE, platformHasCapability } from "$lib/platform";
  import ImageIcon from "@lucide/svelte/icons/image";

  let {
    cover,
    unavailableLabel,
    objectFit = "cover",
    previewUrl = null,
    focalLabel = "",
    focalPoint,
    onFocalPoint,
    onStatus,
  }: {
    cover: NotesPageCover | null;
    unavailableLabel: string;
    objectFit?: "cover" | "contain";
    previewUrl?: string | null;
    focalLabel?: string;
    focalPoint?: NotesCoverFocalPoint;
    onFocalPoint?: (point: NotesCoverFocalPoint) => void;
    onStatus?: (status: "loading" | "ready" | "error") => void;
  } = $props();

  let assetUrl = $state<string | null>(null);
  let assetFailed = $state(false);
  let failedUrl = $state<string | null>(null);
  let loadedUrl = $state<string | null>(null);
  let width = $state(0);
  let height = $state(0);
  let imageSize = $state({ width: 0, height: 0 });
  const assetPath = $derived(notesPageCoverAssetPath(cover));
  const remoteImageUrlsAvailable = platformHasCapability(BUILD_PLATFORM_PROFILE, "notes.external-image-references");
  const url = $derived(previewUrl ?? assetUrl ?? (remoteImageUrlsAvailable ? notesPageCoverUrl(cover) : null));
  const focal = $derived(focalPoint ?? (cover && cover.type !== "design" ? cover.focal_point ?? NOTES_COVER_DEFAULT_FOCAL_POINT : NOTES_COVER_DEFAULT_FOCAL_POINT));
  const objectPosition = $derived(objectFit === "contain" ? "50% 50%" : notesCoverObjectPosition(focal, imageSize, { width, height }));
  const marker = $derived.by(() => {
    if (!imageSize.width || !imageSize.height) return { x: width / 2, y: height / 2 };
    const scale = Math.min(width / imageSize.width, height / imageSize.height);
    return {
      x: (width - imageSize.width * scale) / 2 + focal.x * imageSize.width * scale,
      y: (height - imageSize.height * scale) / 2 + focal.y * imageSize.height * scale,
    };
  });

  $effect(() => {
    const path = assetPath;
    let active = true;
    assetUrl = null;
    assetFailed = false;
    if (path && isNotesPageCoverAssetPath(path)) {
      void notesPageCoverAssetUrl(path).then((value) => {
        if (active) assetUrl = value;
      }).catch(() => {
        if (active) assetFailed = true;
      });
    }
    return () => { active = false; };
  });

  $effect(() => {
    if (cover?.type === "design") onStatus?.("ready");
    else if (assetFailed || (!url && cover && !assetPath)) onStatus?.("error");
    else if (url && failedUrl === url) onStatus?.("error");
    else if (url && loadedUrl === url) onStatus?.("ready");
    else onStatus?.("loading");
  });

  /** Select a subject in the complete, fitted source image. */
  function chooseFocalPoint(event: MouseEvent): void {
    if (event.detail === 0) return;
    const rect = event.currentTarget instanceof HTMLElement ? event.currentTarget.getBoundingClientRect() : null;
    if (!rect || !url || failedUrl === url) return;
    onFocalPoint?.(notesCoverFocalPointFromPointer(
      { x: event.clientX - rect.left, y: event.clientY - rect.top }, imageSize, { width, height },
    ));
  }

  /** Offer the same two-axis positioning through keyboard arrows. */
  function moveFocalPoint(event: KeyboardEvent): void {
    const step = event.shiftKey ? 0.1 : 0.02;
    const offsets: Partial<Record<string, readonly [number, number]>> = {
      ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
    };
    const delta = offsets[event.key];
    if (!delta && event.key !== "Home") return;
    event.preventDefault();
    onFocalPoint?.(delta ? {
      x: Math.max(0, Math.min(1, focal.x + delta[0])),
      y: Math.max(0, Math.min(1, focal.y + delta[1])),
    } : { ...NOTES_COVER_DEFAULT_FOCAL_POINT });
  }
</script>

{#snippet surface()}
  {#if url && failedUrl !== url}
    {#key url}
      <img
        class={`size-full ${objectFit === "contain" ? "object-contain" : "object-cover"}`}
        style:object-position={objectPosition}
        src={url}
        alt=""
        draggable="false"
        onload={(event) => {
          if (!(event.currentTarget instanceof HTMLImageElement)) return;
          imageSize = { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight };
          loadedUrl = event.currentTarget.getAttribute("src");
        }}
        onerror={(event) => { failedUrl = event.currentTarget.getAttribute("src"); }}
      />
    {/key}
    {#if onFocalPoint && loadedUrl === url}
      <span class="pointer-events-none absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-black/40 ring-2 ring-black/60" style:left={`${marker.x}px`} style:top={`${marker.y}px`}></span>
    {/if}
  {:else}
    <div class="flex size-full items-center justify-center gap-2 bg-muted text-[0.8rem] text-muted-foreground">
      <ImageIcon class="size-4" />
      <span class="max-w-full truncate px-2">{unavailableLabel}</span>
    </div>
  {/if}
{/snippet}

{#if cover?.type === "design"}
  <NotesCoverDesign pattern={cover.design.pattern} color={cover.design.color} />
{:else if onFocalPoint}
  <button type="button" class="relative block size-full cursor-crosshair overflow-hidden rounded-md focus-visible:ring-2 focus-visible:ring-ring" bind:clientWidth={width} bind:clientHeight={height} aria-label={focalLabel} onclick={chooseFocalPoint} onkeydown={moveFocalPoint}>
    {@render surface()}
  </button>
{:else if objectFit === "contain"}
  <div class="size-full overflow-hidden">{@render surface()}</div>
{:else}
  <div class="size-full overflow-hidden" bind:clientWidth={width} bind:clientHeight={height}>
    {@render surface()}
  </div>
{/if}
