<script lang="ts">
  import { getCalendarZoom } from "$lib/stores/calendarZoom.svelte";

  let {
    scrollContainer,
    stickyTop = 0,
  }: {
    scrollContainer: HTMLElement | undefined;
    stickyTop?: number;
  } = $props();

  const calZoom = getCalendarZoom();

  let trackEl: HTMLDivElement | undefined = $state();
  let thumbTop = $state(0);
  let thumbHeight = $state(0);
  let dragging = $state(false);
  let hovering = $state(false);
  let dragStartY = 0;
  let dragStartScrollTop = 0;

  function updateThumb() {
    // Freeze the scrollbar during zoom animations to avoid forced reflows
    // that cause visual flashes. The scrollbar updates on the next
    // scroll or resize event after the zoom animation completes.
    if (calZoom.isAnimating) return;
    if (!scrollContainer || !trackEl) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
    if (scrollHeight <= clientHeight) {
      thumbHeight = 0;
      return;
    }
    const trackH = trackEl.clientHeight;
    const ratio = clientHeight / scrollHeight;
    thumbHeight = Math.max(ratio * trackH, 24);
    const scrollRange = scrollHeight - clientHeight;
    thumbTop = scrollRange > 0
      ? (scrollTop / scrollRange) * (trackH - thumbHeight)
      : 0;
  }

  $effect(() => {
    const el = scrollContainer;
    if (!el) return;
    updateThumb();
    el.addEventListener("scroll", updateThumb, { passive: true });
    el.addEventListener("zoomcommit", updateThumb);
    const observer = new ResizeObserver(updateThumb);
    observer.observe(el);
    const content = el.firstElementChild;
    if (content) observer.observe(content as Element);
    return () => {
      el.removeEventListener("scroll", updateThumb);
      el.removeEventListener("zoomcommit", updateThumb);
      observer.disconnect();
    };
  });

  function handleTrackPointerDown(e: PointerEvent) {
    if (!scrollContainer || !trackEl) return;
    e.preventDefault();
    const rect = trackEl.getBoundingClientRect();
    const clickY = e.clientY - rect.top;
    const onThumb = clickY >= thumbTop && clickY <= thumbTop + thumbHeight;

    if (!onThumb) {
      const trackH = trackEl.clientHeight;
      const scrollRange = scrollContainer.scrollHeight - scrollContainer.clientHeight;
      const targetRatio = (clickY - thumbHeight / 2) / (trackH - thumbHeight);
      scrollContainer.scrollTop = Math.max(0, Math.min(scrollRange, targetRatio * scrollRange));
    }

    dragging = true;
    dragStartY = e.clientY;
    dragStartScrollTop = scrollContainer.scrollTop;
    trackEl.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: PointerEvent) {
    if (!dragging || !scrollContainer || !trackEl) return;
    const deltaY = e.clientY - dragStartY;
    const trackH = trackEl.clientHeight;
    const scrollRange = scrollContainer.scrollHeight - scrollContainer.clientHeight;
    const thumbRange = trackH - thumbHeight;
    if (thumbRange <= 0) return;
    scrollContainer.scrollTop = dragStartScrollTop + (deltaY / thumbRange) * scrollRange;
  }

  function handlePointerUp() {
    dragging = false;
  }
</script>

<!-- Absolute overlay: positioned outside scroll container so it never scrolls -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={trackEl}
  class="pointer-events-auto absolute right-0 z-[100]"
  style="top: {stickyTop}px; bottom: 0; width: 8px;"
  onpointerdown={handleTrackPointerDown}
  onpointermove={handlePointerMove}
  onpointerup={handlePointerUp}
  onpointerenter={() => (hovering = true)}
  onpointerleave={() => { if (!dragging) hovering = false; }}
>
  {#if thumbHeight > 0}
    <div
      class="absolute left-0.5 right-0.5 rounded-full transition-opacity duration-150"
      style="
        top: {thumbTop}px;
        height: {thumbHeight}px;
        background-color: var(--muted);
      "
    ></div>
  {/if}
</div>
