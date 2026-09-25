import { untrack } from "svelte";
import { notesHydratedItemsByOutline, type NotesBlockOutlineItem } from "$lib/notes/block-outline";
import type { NotesBlockTreeItem } from "$lib/notes/types";
import {
  notesScrollAnchor,
  notesScrollOffsetForAnchor,
  notesVisibleRange,
  notesRetainedItemHeight,
} from "$lib/notes/visible-range";

export interface NotesBlockVirtualizerOptions {
  readScrollViewport: () => HTMLDivElement | null;
  readListElement: () => HTMLDivElement | null;
  readOutlines: () => readonly NotesBlockOutlineItem[];
  readItems: () => readonly NotesBlockTreeItem[];
  readPinnedBlockIds: () => readonly string[];
  readSelectionBlockIds?: () => readonly string[];
  readFocusRequest: () => { blockId: string | null; requestId: number };
  hydrateBlockRange: (blockIds: readonly string[]) => Promise<void>;
}

/** Calculate the estimated top offset only when a focused block is not rendered. */
export function notesFocusedBlockEstimatedOffset(
  rangeItems: readonly { id: string; estimatedHeight: number }[],
  measuredHeights: ReadonlyMap<string, number>,
  blockId: string,
  targetRendered: boolean,
): number | null {
  if (targetRendered) return null;
  const index = rangeItems.findIndex((item) => item.id === blockId);
  if (index < 0) return null;
  return rangeItems
    .slice(0, index)
    .reduce((total, item) => total + (measuredHeights.get(item.id) ?? item.estimatedHeight), 0);
}

/** Own Notes outline virtualization, hydration, and estimated focus scrolling. */
export function createNotesBlockVirtualizer(options: NotesBlockVirtualizerOptions) {
  let viewportStart = $state(0);
  let viewportHeight = $state(0);
  let measuredBlockHeights = $state(new Map<string, number>());
  let handledFocusRequestId = 0;
  const rangeItems = $derived(options.readOutlines().map((item) => ({
    id: item.outline.id,
    estimatedHeight: item.outline.retained_height,
  })));
  const viewportRange = $derived(notesVisibleRange(rangeItems, measuredBlockHeights, {
    viewportStart,
    viewportEnd: viewportStart + viewportHeight,
    overscanPx: 480,
    minimumVirtualizedCount: 120,
  }));
  const visibleRange = $derived.by(() => {
    const selected = new Set(options.readSelectionBlockIds?.() ?? []);
    const indices = rangeItems.flatMap((item, index) => selected.has(item.id) ? [index] : []);
    if (!indices.length) return viewportRange;
    const start = Math.min(viewportRange.start, indices[0]);
    const end = Math.max(viewportRange.end, indices[indices.length - 1] + 1);
    const height = (from: number, to: number) => rangeItems.slice(from, to)
      .reduce((total, item) => total + notesRetainedItemHeight(item, measuredBlockHeights), 0);
    return { ...viewportRange, start, end, topHeight: height(0, start), bottomHeight: height(end, rangeItems.length) };
  });
  const visibleOutlines = $derived(options.readOutlines().slice(visibleRange.start, visibleRange.end));
  const hydratedItemsById = $derived(notesHydratedItemsByOutline(options.readOutlines(), options.readItems()));

  function updateViewportRange(): void {
    const scrollViewport = options.readScrollViewport();
    const listElement = options.readListElement();
    if (!scrollViewport || !listElement) return;
    const viewportRect = scrollViewport.getBoundingClientRect();
    const listRect = listElement.getBoundingClientRect();
    const listStart = scrollViewport.scrollTop + listRect.top - viewportRect.top;
    viewportStart = Math.max(0, scrollViewport.scrollTop - listStart);
    viewportHeight = scrollViewport.clientHeight;
  }

  $effect(() => {
    const viewport = options.readScrollViewport();
    if (!viewport) return;
    const observer = new ResizeObserver(updateViewportRange);
    observer.observe(viewport);
    viewport.addEventListener("scroll", updateViewportRange, { passive: true });
    updateViewportRange();
    return () => {
      observer.disconnect();
      viewport.removeEventListener("scroll", updateViewportRange);
    };
  });

  $effect(() => {
    const retainedIds = visibleOutlines.map((item) => item.outline.id);
    retainedIds.push(...options.readPinnedBlockIds());
    untrack(() => { void options.hydrateBlockRange(retainedIds); });
  });

  $effect(() => {
    const { blockId, requestId } = options.readFocusRequest();
    const scrollViewport = options.readScrollViewport();
    if (!blockId || requestId === handledFocusRequestId || !scrollViewport) return;
    const renderedTarget = Array.from(
      options.readListElement()?.querySelectorAll<HTMLElement>("[data-notes-virtual-block]") ?? [],
    ).some((element) => element.dataset.notesVirtualBlock === blockId);
    const targetOffset = notesFocusedBlockEstimatedOffset(
      rangeItems,
      measuredBlockHeights,
      blockId,
      renderedTarget,
    );
    if (targetOffset === null) {
      if (renderedTarget) handledFocusRequestId = requestId;
      return;
    }
    handledFocusRequestId = requestId;
    scrollViewport.scrollTop += targetOffset - viewportStart;
    updateViewportRange();
  });

  function measureBlock(
    node: HTMLElement,
    blockId: string,
  ): { update: (nextId: string) => void; destroy: () => void } {
    let currentId = blockId;
    const observer = new ResizeObserver(([entry]) => {
      const nextHeight = entry?.borderBoxSize?.[0]?.blockSize ?? entry?.contentRect.height;
      if (!nextHeight || Math.abs((measuredBlockHeights.get(currentId) ?? 0) - nextHeight) < 0.5) return;
      const anchor = notesScrollAnchor(rangeItems, measuredBlockHeights, viewportStart);
      const next = new Map(measuredBlockHeights);
      next.set(currentId, nextHeight);
      measuredBlockHeights = next;
      const corrected = notesScrollOffsetForAnchor(rangeItems, next, anchor);
      const scrollViewport = options.readScrollViewport();
      if (corrected !== null && scrollViewport && Math.abs(corrected - viewportStart) >= 0.5) {
        scrollViewport.scrollTop += corrected - viewportStart;
      }
    });
    observer.observe(node);
    return {
      update(nextId) {
        currentId = nextId;
      },
      destroy() {
        observer.disconnect();
      },
    };
  }

  return {
    get visibleRange() {
      return visibleRange;
    },
    get visibleOutlines() {
      return visibleOutlines;
    },
    get hydratedItemsById() {
      return hydratedItemsById;
    },
    measureBlock,
  };
}
