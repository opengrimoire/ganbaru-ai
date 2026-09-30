<script lang="ts">
  import { tick } from "svelte";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { notesFloatingPanelPlacement, type NotesFloatingPanelRect } from "$lib/notes/floating-panel";
  import { notesLinkTarget } from "$lib/notes/link-navigation";
  import type { NotesPageMentionTarget } from "$lib/notes/rich-text";
  import { dismissOnOutside } from "$lib/utils/dismiss-on-outside";
  import { portal } from "$lib/utils/portal";
  import Copy from "@lucide/svelte/icons/copy";
  import Database from "@lucide/svelte/icons/database";
  import FileText from "@lucide/svelte/icons/file-text";
  import Link from "@lucide/svelte/icons/link";
  import Trash2 from "@lucide/svelte/icons/trash-2";

  const EDITOR_WIDTH = 360;
  const PREVIEW_WIDTH = 320;
  const PAGE_RESULT_LIMIT = 6;
  const PANEL_TEXT_SCALE = 0.8;

  let {
    value, title, mode, destinationTitle, pageTargets, error, busy, canRemove, editor, readAnchor,
    onInput, onTitleInput, onApply, onRemove, onCancel, onOpen, onCopy, onEdit, onPointerEnter, onPointerLeave,
  }: {
    value: string;
    title: string;
    mode: "preview" | "edit";
    destinationTitle: string;
    pageTargets: readonly NotesPageMentionTarget[];
    error: string | null;
    busy: boolean;
    canRemove: boolean;
    editor: HTMLElement | null;
    readAnchor: () => NotesFloatingPanelRect | null;
    onInput: (value: string) => void;
    onTitleInput: (value: string) => void;
    onApply: () => void;
    onRemove: () => void;
    onCancel: (restoreFocus?: boolean) => void;
    onOpen: () => void;
    onCopy: () => void;
    onEdit: () => void;
    onPointerEnter: () => void;
    onPointerLeave: () => void;
  } = $props();

  const { t } = getLocalization();
  let root = $state<HTMLDivElement | null>(null);
  let destinationInput = $state<HTMLInputElement | null>(null);
  let titleInput = $state<HTMLInputElement | null>(null);
  let editingDestination = $state(false);
  let anchor = $state<NotesFloatingPanelRect>({ top: 0, bottom: 0, left: 0, right: 0 });
  let panelHeight = $state(0);
  let panelFontSize = $state<string | undefined>(undefined);
  let viewport = $state({ width: 0, height: 0 });
  const localTarget = $derived(notesLinkTarget(value, typeof window === "undefined" ? undefined : window.location.href));
  const matches = $derived(editingDestination && value.trim() && !localTarget
    ? pageTargets.filter((page) => page.title.toLocaleLowerCase().includes(value.trim().toLocaleLowerCase())).slice(0, PAGE_RESULT_LIMIT) : []);
  const position = $derived(notesFloatingPanelPlacement(anchor, viewport, {
    width: mode === "preview" ? PREVIEW_WIDTH : EDITOR_WIDTH,
    height: panelHeight, align: "start",
  }));

  function reposition(): void {
    const rect = readAnchor();
    if (!rect || !root) return;
    const paragraph = editor?.classList.contains("notes-editor-body-text") ? editor
      : editor?.closest(".notes-block-list")?.querySelector<HTMLElement>("[contenteditable].notes-editor-body-text");
    const paragraphFontSize = paragraph ? Number.parseFloat(window.getComputedStyle(paragraph).fontSize) : Number.NaN;
    panelFontSize = Number.isFinite(paragraphFontSize) ? `${paragraphFontSize * PANEL_TEXT_SCALE}px` : undefined;
    anchor = { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
    const visibleViewport = window.visualViewport;
    viewport = { width: visibleViewport?.width ?? window.innerWidth, height: visibleViewport?.height ?? window.innerHeight };
    const styles = window.getComputedStyle(root);
    const borderHeight = (Number.parseFloat(styles.borderTopWidth) || 0) + (Number.parseFloat(styles.borderBottomWidth) || 0);
    panelHeight = Math.ceil(root.scrollHeight + borderHeight);
  }

  /** Mount the open popover outside the note layout and release its observers on close. */
  function floatingPanel(node: HTMLDivElement) {
    const portaled = portal(node, editor?.closest<HTMLElement>("[data-floating-root]") ?? document.body);
    reposition();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(reposition);
    observer?.observe(node);
    document.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    window.visualViewport?.addEventListener("resize", reposition);
    window.visualViewport?.addEventListener("scroll", reposition);
    return { destroy() {
      observer?.disconnect();
      document.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      window.visualViewport?.removeEventListener("resize", reposition);
      window.visualViewport?.removeEventListener("scroll", reposition);
      portaled.destroy();
    } };
  }

  $effect(() => {
    void mode; void value; void error;
    void tick().then(reposition);
  });

  $effect(() => {
    if (mode !== "edit") return;
    let cancelled = false;
    void tick().then(() => {
      if (cancelled) return;
      const active = document.activeElement;
      if (active && active !== document.body && active !== editor && !root?.contains(active)) {
        onCancel();
        return;
      }
      if (localTarget) titleInput?.focus({ preventScroll: true });
      else { destinationInput?.focus({ preventScroll: true }); destinationInput?.select(); }
    });
    return () => { cancelled = true; };
  });

  function editDestination(): void {
    editingDestination = true;
    void tick().then(() => { destinationInput?.focus({ preventScroll: true }); destinationInput?.select(); });
  }

  function selectPage(page: NotesPageMentionTarget): void {
    onInput(`#notes?page=${encodeURIComponent(page.id)}`);
    editingDestination = false;
    void tick().then(() => titleInput?.focus({ preventScroll: true }));
  }
</script>

<div
  bind:this={root}
  use:floatingPanel
  use:dismissOnOutside={{ onDismiss: (reason, event) => {
    if (reason === "escape") { event.preventDefault(); event.stopPropagation(); }
    onCancel(reason === "escape");
  } }}
  role="dialog"
  aria-label={mode === "preview" ? t("notes.linkPreview") : t("notes.openLinkEditor")}
  tabindex="-1"
  data-notes-link-panel
  class="notes-editor-body-text fixed z-60 overflow-x-hidden overflow-y-auto rounded-xl border border-border bg-popover leading-normal text-popover-foreground shadow-sm"
  style:left={`${position.left}px`}
  style:top={`${position.top}px`}
  style:width={mode === "preview" ? "max-content" : `${position.width}px`}
  style:max-width={`${position.width}px`}
  style:max-height={panelHeight > position.maxHeight ? `${position.maxHeight}px` : undefined}
  style:font-size={panelFontSize ?? `calc(1rem * var(--font-scale) * ${PANEL_TEXT_SCALE})`}
  onpointerenter={onPointerEnter}
  onpointerleave={() => { if (!root?.contains(document.activeElement)) onPointerLeave(); }}
  onfocusin={onPointerEnter}
  onkeydown={(event) => {
    event.stopPropagation();
    if (event.key === "Enter" && !event.isComposing && event.target instanceof HTMLInputElement) {
      event.preventDefault(); onApply();
    }
  }}
  onfocusout={(event) => {
    if (event.relatedTarget instanceof Node && !root?.contains(event.relatedTarget)) onCancel();
  }}
>
  {#if mode === "preview"}
    <div class="flex min-h-11 items-center gap-1 p-1.5">
      <button type="button" disabled={busy} aria-label={t("notes.linkOpen")} class="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onclick={onOpen}>
        {#if localTarget?.blockId}<Database class="size-4 shrink-0 text-muted-foreground" />{:else if localTarget}<FileText class="size-4 shrink-0 text-muted-foreground" />{:else}<Link class="size-4 shrink-0 text-muted-foreground" />{/if}
        <span class="truncate">{destinationTitle || value}</span>
      </button>
      <button type="button" disabled={busy} aria-label={t("notes.linkCopy")} class="flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onclick={onCopy}><Copy class="size-4" /></button>
      {#if canRemove}<button type="button" disabled={busy} class="shrink-0 rounded-md px-2 py-1.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onclick={onEdit}>{t("notes.linkEdit")}</button>{/if}
    </div>
  {:else}
    <div class="space-y-3 p-3">
      <div class="space-y-1.5">
        <label for="notes-link-destination" class="text-[0.875em] text-muted-foreground">{t("notes.linkDestination")}</label>
        {#if localTarget && !editingDestination}
          <button id="notes-link-destination" type="button" disabled={busy} class="flex min-h-9 w-full items-center gap-2 rounded-md border border-input bg-muted/40 px-2.5 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onclick={editDestination}>
            {#if localTarget.blockId}<Database class="size-4 shrink-0 text-muted-foreground" />{:else}<FileText class="size-4 shrink-0 text-muted-foreground" />{/if}
            <span class="truncate">{destinationTitle || value}</span>
          </button>
        {:else}
          <input bind:this={destinationInput} id="notes-link-destination" class="min-h-9 w-full rounded-md border border-input bg-muted/40 px-2.5 outline-none focus:border-ring" {value} disabled={busy} placeholder={t("notes.linkUrlPlaceholder")} onfocus={() => { editingDestination = true; }} oninput={(event) => onInput(event.currentTarget.value)} />
          {#if matches.length}
            <div class="space-y-0.5" aria-label={t("notes.linkDestination")}>
              {#each matches as page (page.id)}<button type="button" class="flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onclick={() => selectPage(page)}><FileText class="size-4 shrink-0 text-muted-foreground" /><span class="truncate">{page.title}</span></button>{/each}
            </div>
          {/if}
        {/if}
      </div>
      <div class="space-y-1.5">
        <label for="notes-link-title" class="text-[0.875em] text-muted-foreground">{t("notes.linkTitle")}</label>
        <input bind:this={titleInput} id="notes-link-title" class="min-h-9 w-full rounded-md border border-input bg-muted/40 px-2.5 outline-none focus:border-ring" value={title} disabled={busy} oninput={(event) => onTitleInput(event.currentTarget.value)} />
      </div>
    </div>
    <div role="separator" class="mx-3 border-t border-border"></div>
    <div class="flex items-center justify-between gap-2 p-1.5">
      <button type="button" disabled={busy} class="min-h-9 rounded-md px-2 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onclick={onApply}>{t("notes.applyLink")}</button>
      {#if canRemove}<button type="button" disabled={busy} class="flex min-h-9 items-center gap-2 rounded-md px-2 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onclick={onRemove}><Trash2 class="size-4" />{t("notes.removeLink")}</button>{/if}
    </div>
  {/if}
  {#if error}<p role="alert" class="px-3 pb-3 text-[0.875em] text-destructive">{error}</p>{/if}
</div>

<style>
  [data-notes-link-panel] button,
  [data-notes-link-panel] input {
    font-size: inherit;
  }

  /* Keep keyboard focus visible through the field border without an extra outer contour. */
  [data-notes-link-panel] input:focus,
  [data-notes-link-panel] input:focus-visible {
    outline: none;
    box-shadow: none;
  }
</style>
