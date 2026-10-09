<script lang="ts">
  import { onMount, tick } from "svelte";
  import type { QuickNote, QuickNotesCollection, QuickNoteTag } from "$lib/quick-notes/types";
  import {
    quickNoteMasonryInsertion,
    quickNoteMasonryLayout,
    quickNoteMobileMasonryMaxColumns,
    moveQuickNoteId,
    type MasonryPosition,
  } from "$lib/quick-notes/masonry";
  import type { Theme } from "$lib/themes";
  import QuickNoteCard from "./QuickNoteCard.svelte";

  let {
    notes,
    collection,
    animateLayout = false,
    reorderable = false,
    theme,
    tags,
    onOpen,
    onPin,
    onColor,
    onTag,
    onArchive,
    onUnarchive,
    onTrash,
    onRestore,
    onDelete,
    onReorder,
    mobileLayout = false,
  }: {
    notes: readonly QuickNote[];
    collection: QuickNotesCollection;
    animateLayout?: boolean;
    reorderable?: boolean;
    theme: Theme;
    tags: readonly QuickNoteTag[];
    onOpen: (note: QuickNote) => void;
    onPin: (note: QuickNote, pinned: boolean) => void;
    onColor: (note: QuickNote, color: QuickNote["color"]) => void;
    onTag: (note: QuickNote, tagId: string | null) => void;
    onArchive: (note: QuickNote) => void;
    onUnarchive: (note: QuickNote) => void;
    onTrash: (note: QuickNote) => void;
    onRestore: (note: QuickNote) => void;
    onDelete: (note: QuickNote) => void;
    onReorder: (orderedIds: readonly string[], movedId: string, position: number) => void;
    mobileLayout?: boolean;
  } = $props();

  interface PendingPointer {
    pointerId: number;
    pointerType: string;
    noteId: string;
    node: HTMLDivElement;
    startX: number;
    startY: number;
    grabX: number;
    grabY: number;
    width: number;
    height: number;
  }

  interface ActiveDrag extends PendingPointer {
    clientX: number;
    clientY: number;
    originalIndex: number;
  }

  interface DropSettle {
    noteId: string;
    left: number;
    top: number;
    width: number;
    height: number;
  }

  let container = $state<HTMLDivElement | null>(null);
  let width = $state(0);
  let visualOrder = $state<string[]>([]);
  let positions = $state<Record<string, MasonryPosition>>({});
  let layoutHeight = $state(0);
  let drag = $state<ActiveDrag | null>(null);
  let settling = $state<DropSettle | null>(null);
  let handoffId = $state<string | null>(null);
  let suppressClickFor = $state<string | null>(null);
  let pendingPointer: PendingPointer | null = null;
  let dragFrame: number | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let handoffFrame: number | null = null;
  let previousCursor = "";
  const heights = new Map<string, number>();
  const observers = new Map<string, ResizeObserver>();
  const orderedNotes = $derived(visualOrder
    .map((id) => notes.find((note) => note.id === id))
    .filter((note): note is QuickNote => note !== undefined));

  function maximumColumns(availableWidth: number): number {
    return mobileLayout
      ? quickNoteMobileMasonryMaxColumns(availableWidth)
      : Number.POSITIVE_INFINITY;
  }

  function applyLayout(): void {
    const availableWidth = width || container?.clientWidth || 210;
    const layout = quickNoteMasonryLayout(
      availableWidth,
      orderedNotes.map((note) => heights.get(note.id) ?? 120),
      undefined,
      undefined,
      maximumColumns(availableWidth),
    );
    positions = Object.fromEntries(orderedNotes.map((note, index) => [note.id, layout.positions[index]]));
    layoutHeight = layout.height;
  }

  function measure(node: HTMLElement, noteId: string): { update: (id: string) => void; destroy: () => void } {
    let id = noteId;
    const observer = new ResizeObserver(() => {
      heights.set(id, node.getBoundingClientRect().height);
      applyLayout();
    });
    observer.observe(node);
    observers.set(id, observer);
    heights.set(id, node.getBoundingClientRect().height);
    applyLayout();
    return {
      update(nextId: string) {
        observers.delete(id);
        heights.delete(id);
        id = nextId;
        observers.set(id, observer);
        heights.set(id, node.getBoundingClientRect().height);
        applyLayout();
      },
      destroy() {
        observer.disconnect();
        observers.delete(id);
        heights.delete(id);
      },
    };
  }

  function pointerCanStart(event: PointerEvent): boolean {
    if (!reorderable || event.button !== 0 || !event.isPrimary) return false;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[data-quick-note-no-drag]") !== null) return false;
    return event.pointerType !== "touch" || target?.closest("[data-quick-note-drag-handle]") !== null;
  }

  function startPointer(event: PointerEvent, noteId: string, node: HTMLDivElement): void {
    if (!pointerCanStart(event)) return;
    completeDropSettle();
    const rect = node.getBoundingClientRect();
    pendingPointer = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      noteId,
      node,
      startX: event.clientX,
      startY: event.clientY,
      grabX: event.clientX - rect.left,
      grabY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    };
  }

  /**
   * Captures the pointer only once a drag starts: a captured pointer sends the click that follows
   * to the card wrapper instead of the card's open button.
   */
  function activateDrag(event: PointerEvent, pending: PendingPointer): void {
    pending.node.setPointerCapture(event.pointerId);
    previousCursor = document.documentElement.style.cursor;
    document.documentElement.style.cursor = "grabbing";
    document.documentElement.dataset.quickNoteDragging = "true";
    suppressClickFor = pending.noteId;
    drag = {
      ...pending,
      clientX: event.clientX,
      clientY: event.clientY,
      originalIndex: visualOrder.indexOf(pending.noteId),
    };
    scheduleDragFrame();
  }

  function movePointer(event: PointerEvent): void {
    const pending = pendingPointer;
    if (!pending || pending.pointerId !== event.pointerId) return;
    if (!drag) {
      // An uncaptured press can be released outside the card, where its pointerup never arrives.
      if ((event.buttons & 1) === 0) {
        pendingPointer = null;
        return;
      }
      const threshold = pending.pointerType === "touch" ? 3 : 5;
      if (Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY) < threshold) return;
      activateDrag(event, pending);
    } else {
      drag = { ...drag, clientX: event.clientX, clientY: event.clientY };
    }
    event.preventDefault();
    scheduleDragFrame();
  }

  function scrollVelocity(clientY: number): number {
    const scroller = container?.closest<HTMLElement>("[data-quick-notes-scroll]");
    if (!scroller) return 0;
    const rect = scroller.getBoundingClientRect();
    const edge = Math.min(72, rect.height * 0.22);
    if (clientY < rect.top + edge) return -16 * (1 - Math.max(0, clientY - rect.top) / edge);
    if (clientY > rect.bottom - edge) return 16 * (1 - Math.max(0, rect.bottom - clientY) / edge);
    return 0;
  }

  function updateDragOrder(): void {
    if (!drag || !container) return;
    const draggedIndex = visualOrder.indexOf(drag.noteId);
    if (draggedIndex < 0) return;
    const rect = container.getBoundingClientRect();
    const cardHeights = visualOrder.map((id) => heights.get(id) ?? (id === drag?.noteId ? drag.height : 120));
    const targetLeft = drag.clientX - drag.grabX - rect.left;
    const targetTop = drag.clientY - drag.grabY - rect.top;
    const insertion = quickNoteMasonryInsertion(
      width || container.clientWidth || 210,
      cardHeights,
      draggedIndex,
      targetLeft,
      targetTop,
      draggedIndex,
      maximumColumns(width || container.clientWidth || 210),
    );
    const currentPosition = quickNoteMasonryLayout(
      width || container.clientWidth || 210,
      cardHeights,
      undefined,
      undefined,
      maximumColumns(width || container.clientWidth || 210),
    ).positions[draggedIndex];
    const currentDistance = currentPosition
      ? (currentPosition.left - targetLeft) ** 2 + (currentPosition.top - targetTop) ** 2
      : Number.POSITIVE_INFINITY;
    if (insertion.index !== draggedIndex && insertion.distanceSquared + 144 < currentDistance) {
      visualOrder = moveQuickNoteId(
        visualOrder,
        drag.noteId,
        insertion.index > draggedIndex ? 1 : -1,
      );
      if (Math.abs(insertion.index - draggedIndex) > 1) {
        const next = [...visualOrder];
        const current = next.indexOf(drag.noteId);
        next.splice(current, 1);
        next.splice(insertion.index, 0, drag.noteId);
        visualOrder = next;
      }
      applyLayout();
    }
  }

  function runDragFrame(): void {
    dragFrame = null;
    if (!drag) return;
    const scroller = container?.closest<HTMLElement>("[data-quick-notes-scroll]");
    const velocity = scrollVelocity(drag.clientY);
    if (scroller && velocity !== 0) scroller.scrollTop += velocity;
    updateDragOrder();
    if (velocity !== 0) scheduleDragFrame();
  }

  function scheduleDragFrame(): void {
    if (dragFrame === null) dragFrame = requestAnimationFrame(runDragFrame);
  }

  function restoreDocumentDragState(): void {
    document.documentElement.style.cursor = previousCursor;
    delete document.documentElement.dataset.quickNoteDragging;
  }

  function finishPointer(event: PointerEvent, cancelled: boolean): void {
    const pending = pendingPointer;
    if (!pending || pending.pointerId !== event.pointerId) return;
    if (drag) drag = { ...drag, clientX: event.clientX, clientY: event.clientY };
    updateDragOrder();
    const active = drag;
    pendingPointer = null;
    if (pending.node.hasPointerCapture(event.pointerId)) pending.node.releasePointerCapture(event.pointerId);
    if (!active) return;
    event.preventDefault();
    if (dragFrame !== null) cancelAnimationFrame(dragFrame);
    dragFrame = null;
    restoreDocumentDragState();
    if (cancelled) {
      drag = null;
      visualOrder = notes.map((note) => note.id);
      applyLayout();
      suppressLayoutTransition(active.noteId);
    } else {
      const position = visualOrder.indexOf(active.noteId);
      if (position !== active.originalIndex) onReorder(visualOrder, active.noteId, position);
      void settleDrop(active);
    }
    setTimeout(() => { if (suppressClickFor === active.noteId) suppressClickFor = null; }, 0);
  }

  async function settleDrop(active: ActiveDrag): Promise<void> {
    const position = positions[active.noteId];
    const rect = container?.getBoundingClientRect();
    if (!position || !rect) {
      drag = null;
      suppressLayoutTransition(active.noteId);
      return;
    }
    settling = {
      noteId: active.noteId,
      left: active.clientX - active.grabX,
      top: active.clientY - active.grabY,
      width: active.width,
      height: active.height,
    };
    drag = null;
    await tick();
    if (settling?.noteId !== active.noteId) return;
    active.node.getBoundingClientRect();
    settling = {
      ...settling,
      left: rect.left + position.left,
      top: rect.top + position.top,
      width: position.width,
    };
    if (settleTimer) clearTimeout(settleTimer);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    settleTimer = setTimeout(completeDropSettle, reducedMotion ? 0 : 180);
  }

  function suppressLayoutTransition(noteId: string): void {
    handoffId = noteId;
    if (handoffFrame !== null) cancelAnimationFrame(handoffFrame);
    handoffFrame = requestAnimationFrame(() => {
      handoffFrame = null;
      if (handoffId === noteId) handoffId = null;
    });
  }

  function completeDropSettle(): void {
    const noteId = settling?.noteId;
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = null;
    settling = null;
    if (noteId) suppressLayoutTransition(noteId);
  }

  function cancelDragFromKeyboard(event: KeyboardEvent): void {
    if (event.key !== "Escape" || !drag || !pendingPointer) return;
    event.preventDefault();
    event.stopPropagation();
    const active = drag;
    const pending = pendingPointer;
    pendingPointer = null;
    if (pending.node.hasPointerCapture(pending.pointerId)) pending.node.releasePointerCapture(pending.pointerId);
    if (dragFrame !== null) cancelAnimationFrame(dragFrame);
    dragFrame = null;
    restoreDocumentDragState();
    drag = null;
    visualOrder = notes.map((note) => note.id);
    applyLayout();
    suppressLayoutTransition(active.noteId);
    setTimeout(() => { if (suppressClickFor === active.noteId) suppressClickFor = null; }, 0);
  }

  function suppressDraggedClick(event: MouseEvent, noteId: string): void {
    if (suppressClickFor !== noteId) return;
    event.preventDefault();
    event.stopPropagation();
    suppressClickFor = null;
  }

  function keyboardMove(noteId: string, direction: -1 | 1): void {
    const next = moveQuickNoteId(visualOrder, noteId, direction);
    if (next.every((id, index) => id === visualOrder[index])) return;
    visualOrder = next;
    applyLayout();
    onReorder(visualOrder, noteId, visualOrder.indexOf(noteId));
  }

  function wrapperStyle(noteId: string, position: MasonryPosition | undefined): string {
    if (drag?.noteId === noteId) {
      return `position: fixed; left: ${drag.clientX - drag.grabX}px; top: ${drag.clientY - drag.grabY}px; width: ${drag.width}px; height: ${drag.height}px; transform: none; z-index: 70;`;
    }
    if (settling?.noteId === noteId) {
      return `position: fixed; left: ${settling.left}px; top: ${settling.top}px; width: ${settling.width}px; height: ${settling.height}px; transform: none; z-index: 70;`;
    }
    return position
      ? `width: ${position.width}px; transform: translate(${position.left}px, ${position.top}px);`
      : "width: 210px;";
  }

  onMount(() => {
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      width = entry?.contentRect.width ?? container?.clientWidth ?? 0;
      applyLayout();
    });
    observer.observe(container);
    window.addEventListener("keydown", cancelDragFromKeyboard, true);
    width = container.clientWidth;
    applyLayout();
    return () => {
      observer.disconnect();
      window.removeEventListener("keydown", cancelDragFromKeyboard, true);
      for (const cardObserver of observers.values()) cardObserver.disconnect();
      if (dragFrame !== null) cancelAnimationFrame(dragFrame);
      if (settleTimer) clearTimeout(settleTimer);
      if (handoffFrame !== null) cancelAnimationFrame(handoffFrame);
      if (drag) {
        restoreDocumentDragState();
      }
    };
  });

  $effect.pre(() => {
    const sourceOrder = notes.map((note) => note.id);
    if (!drag && sourceOrder.join("|") !== visualOrder.join("|")) visualOrder = sourceOrder;
  });

  $effect(() => {
    void orderedNotes.map((note) => note.id).join("|");
    applyLayout();
  });
</script>

<div bind:this={container} class="relative w-full" style="height: {layoutHeight}px;" role="list">
  {#each orderedNotes as note (note.id)}
    {@const position = positions[note.id]}
    <div
      use:measure={note.id}
      class={`absolute left-0 top-0 will-change-transform ${drag?.noteId === note.id ? "cursor-grabbing opacity-95 shadow-2xl" : settling?.noteId === note.id ? "quick-note-drop-settling opacity-95 shadow-2xl" : reorderable ? "cursor-grab" : ""} ${(animateLayout || drag) && drag?.noteId !== note.id && settling?.noteId !== note.id && handoffId !== note.id ? "motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out" : ""}`}
      style={wrapperStyle(note.id, position)}
      role="listitem"
      onpointerdown={(event) => startPointer(event, note.id, event.currentTarget)}
      onpointermove={movePointer}
      onpointerup={(event) => finishPointer(event, false)}
      onpointercancel={(event) => finishPointer(event, true)}
      onclickcapture={(event) => suppressDraggedClick(event, note.id)}
    >
      <QuickNoteCard
        {note}
        {collection}
        {reorderable}
        {theme}
        {tags}
        {mobileLayout}
        onOpen={() => onOpen(note)}
        onMove={(direction) => keyboardMove(note.id, direction)}
        onPin={(pinned) => onPin(note, pinned)}
        onColor={(color) => onColor(note, color)}
        onTag={(tagId) => onTag(note, tagId)}
        onArchive={() => onArchive(note)}
        onUnarchive={() => onUnarchive(note)}
        onTrash={() => onTrash(note)}
        onRestore={() => onRestore(note)}
        onDelete={() => onDelete(note)}
      />
    </div>
  {/each}
</div>

<style>
  .quick-note-drop-settling {
    transition-property: left, top, width;
    transition-duration: 160ms;
    transition-timing-function: cubic-bezier(0.2, 0, 0, 1);
  }

  @media (prefers-reduced-motion: reduce) {
    .quick-note-drop-settling {
      transition-duration: 0ms;
    }
  }
</style>
