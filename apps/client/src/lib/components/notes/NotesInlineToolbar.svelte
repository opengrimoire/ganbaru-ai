<script lang="ts">
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import {
    NOTES_BACKGROUND_COLORS,
    NOTES_TEXT_COLORS,
    notesBlockColorSwatchStyle,
  } from "$lib/notes/block-color";
  import { shouldPreventInlineToolbarPointerDefault } from "$lib/notes/inline-toolbar";
  import { dismissOnOutside } from "$lib/utils/dismiss-on-outside";
  import type {
    NotesRichTextAnnotationName,
  } from "$lib/notes/rich-text";
  import type { NotesColor, NotesRichTextAnnotations } from "$lib/notes/types";
  import Bold from "@lucide/svelte/icons/bold";
  import Code from "@lucide/svelte/icons/code";
  import Italic from "@lucide/svelte/icons/italic";
  import LinkIcon from "@lucide/svelte/icons/link";
  import MessageSquare from "@lucide/svelte/icons/message-square";
  import PencilLine from "@lucide/svelte/icons/pencil-line";
  import Sigma from "@lucide/svelte/icons/sigma";
  import { tick } from "svelte";

  let {
    annotations,
    onToggleAnnotation,
    onColorSelect,
    onCreateEquation,
    onCreateComment,
    onCreateSuggestion,
    onOpenLink,
  }: {
    annotations: NotesRichTextAnnotations;
    onToggleAnnotation: (name: NotesRichTextAnnotationName) => void;
    onColorSelect: (color: NotesColor) => void;
    onCreateEquation: () => void;
    onCreateComment: () => void;
    onCreateSuggestion: () => void;
    onOpenLink: () => void;
  } = $props();

  const { t } = getLocalization();
  const toolbarButtonBase =
    "flex size-8 items-center justify-center rounded outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const toolbarIconStrokeWidth = 3;
  const customFormattingIconStrokeWidth = 1.5;
  let toolbarElement: HTMLDivElement;
  let colorTriggerElement: HTMLButtonElement;
  let colorPanelElement = $state<HTMLDivElement | null>(null);
  let colorPanelOpen = $state(false);
  let colorPanelPosition = $state<{ left: number; top: number } | null>(null);

  $effect(() => {
    if (!colorPanelOpen) return;
    void tick().then(positionColorPanel);
    window.addEventListener("resize", positionColorPanel);
    window.addEventListener("scroll", positionColorPanel, true);
    return () => {
      window.removeEventListener("resize", positionColorPanel);
      window.removeEventListener("scroll", positionColorPanel, true);
    };
  });

  function positionColorPanel(): void {
    if (!toolbarElement || !colorPanelElement) return;
    const anchor = toolbarElement.getBoundingClientRect();
    const { offsetWidth: width, offsetHeight: height } = colorPanelElement;
    const margin = 8;
    const gap = 4;
    const roomBelow = window.innerHeight - anchor.bottom - margin;
    const roomAbove = anchor.top - margin;
    const top = roomBelow >= height || roomBelow >= roomAbove
      ? anchor.bottom + gap
      : anchor.top - height - gap;
    colorPanelPosition = {
      left: Math.max(margin, Math.min(anchor.right - width, window.innerWidth - width - margin)),
      top: Math.max(margin, Math.min(top, window.innerHeight - height - margin)),
    };
  }

  function toggleColorPanel(): void {
    colorPanelOpen = !colorPanelOpen;
    colorPanelPosition = null;
  }

  function selectColor(color: NotesColor): void {
    colorPanelOpen = false;
    onColorSelect(color);
  }

  function annotationActive(name: NotesRichTextAnnotationName): boolean {
    switch (name) {
      case "bold":
        return annotations.bold;
      case "italic":
        return annotations.italic;
      case "strikethrough":
        return annotations.strikethrough;
      case "underline":
        return annotations.underline;
      case "code":
        return annotations.code;
    }
  }

  function colorLabel(color: NotesColor): string {
    switch (color) {
      case "default":
        return t("notes.blockColor.default");
      case "gray":
        return t("notes.blockColor.gray");
      case "brown":
        return t("notes.blockColor.brown");
      case "orange":
        return t("notes.blockColor.orange");
      case "yellow":
        return t("notes.blockColor.yellow");
      case "green":
        return t("notes.blockColor.green");
      case "blue":
        return t("notes.blockColor.blue");
      case "purple":
        return t("notes.blockColor.purple");
      case "pink":
        return t("notes.blockColor.pink");
      case "red":
        return t("notes.blockColor.red");
      case "gray_background":
        return t("notes.blockColor.grayBackground");
      case "brown_background":
        return t("notes.blockColor.brownBackground");
      case "orange_background":
        return t("notes.blockColor.orangeBackground");
      case "yellow_background":
        return t("notes.blockColor.yellowBackground");
      case "green_background":
        return t("notes.blockColor.greenBackground");
      case "blue_background":
        return t("notes.blockColor.blueBackground");
      case "purple_background":
        return t("notes.blockColor.purpleBackground");
      case "pink_background":
        return t("notes.blockColor.pinkBackground");
      case "red_background":
        return t("notes.blockColor.redBackground");
    }
  }

  function buttonClass(name: NotesRichTextAnnotationName): string {
    return annotationActive(name)
      ? `${toolbarButtonBase} bg-accent text-foreground`
      : `${toolbarButtonBase} text-foreground hover:bg-accent`;
  }

  function plainButtonClass(): string {
    return `${toolbarButtonBase} text-foreground hover:bg-accent`;
  }

  function preserveMouseSelection(event: MouseEvent): void {
    event.preventDefault();
  }

  function preserveTouchSelection(event: PointerEvent): void {
    if (shouldPreventInlineToolbarPointerDefault(event.pointerType)) event.preventDefault();
  }
</script>

<div
  bind:this={toolbarElement}
  use:dismissOnOutside={{
    enabled: colorPanelOpen,
    onDismiss: (reason) => {
      colorPanelOpen = false;
      if (reason === "escape") colorTriggerElement.focus();
    },
  }}
  class="grid max-w-full grid-cols-5 gap-0.5 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md"
  role="toolbar"
  aria-label={t("notes.inlineToolbar")}
>
  <button
    bind:this={colorTriggerElement}
    type="button"
    class={plainButtonClass()}
    aria-label={t("notes.textColor")}
    title={t("notes.textColor")}
    aria-expanded={colorPanelOpen}
    aria-controls="notes-inline-color-panel"
    onmousedown={preserveMouseSelection}
    onpointerdown={preserveTouchSelection}
    onclick={toggleColorPanel}
  >
    <span class="notes-inline-color-trigger" style={notesBlockColorSwatchStyle(annotations.color)} aria-hidden="true">A</span>
  </button>
  {#if colorPanelOpen}
    <div
      bind:this={colorPanelElement}
      id="notes-inline-color-panel"
      class="fixed z-50 w-56 max-h-[min(19rem,calc(100vh-1rem))] overflow-y-auto rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-lg"
      style:top={`${colorPanelPosition?.top ?? 0}px`}
      style:left={`${colorPanelPosition?.left ?? 0}px`}
      style:visibility={colorPanelPosition ? "visible" : "hidden"}
      role="group"
      aria-label={t("notes.textColor")}
    >
      <div class="px-1 pb-1 text-xs font-medium text-muted-foreground">{t("notes.textColors")}</div>
      <div class="grid grid-cols-5 gap-1" role="group" aria-label={t("notes.textColors")}>
        {#each NOTES_TEXT_COLORS as color}
          <button
            type="button"
            class="flex size-9 items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={colorLabel(color)}
            title={colorLabel(color)}
            aria-pressed={annotations.color === color}
            onmousedown={preserveMouseSelection}
            onpointerdown={preserveTouchSelection}
            onclick={() => selectColor(color)}
          >
            <span class:notes-inline-color-selected={annotations.color === color} class="notes-inline-color-swatch" style={notesBlockColorSwatchStyle(color)} aria-hidden="true">A</span>
          </button>
        {/each}
      </div>
      <div class="mt-2 border-t border-border px-1 pb-1 pt-2 text-xs font-medium text-muted-foreground">{t("notes.backgroundColors")}</div>
      <div class="grid grid-cols-5 gap-1" role="group" aria-label={t("notes.backgroundColors")}>
        {#each NOTES_BACKGROUND_COLORS as color}
          <button
            type="button"
            class="flex size-9 items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={colorLabel(color)}
            title={colorLabel(color)}
            aria-pressed={annotations.color === color}
            onmousedown={preserveMouseSelection}
            onpointerdown={preserveTouchSelection}
            onclick={() => selectColor(color)}
          >
            <span class:notes-inline-color-selected={annotations.color === color} class="notes-inline-color-swatch" style={notesBlockColorSwatchStyle(color)} aria-hidden="true">A</span>
          </button>
        {/each}
      </div>
    </div>
  {/if}
  <button
    type="button"
    class={buttonClass("bold")}
    aria-label={t("notes.bold")}
    title={t("notes.bold")}
    aria-pressed={annotations.bold}
    aria-keyshortcuts="Control+B Meta+B"
    onmousedown={preserveMouseSelection}
    onpointerdown={preserveTouchSelection}
    onclick={() => onToggleAnnotation("bold")}
  >
    <Bold class="size-3.5" strokeWidth={toolbarIconStrokeWidth} aria-hidden="true" />
  </button>
  <button
    type="button"
    class={buttonClass("italic")}
    aria-label={t("notes.italic")}
    title={t("notes.italic")}
    aria-pressed={annotations.italic}
    aria-keyshortcuts="Control+I Meta+I"
    onmousedown={preserveMouseSelection}
    onpointerdown={preserveTouchSelection}
    onclick={() => onToggleAnnotation("italic")}
  >
    <Italic class="size-3.5" strokeWidth={toolbarIconStrokeWidth} aria-hidden="true" />
  </button>
  <button
    type="button"
    class={buttonClass("underline")}
    aria-label={t("notes.underline")}
    title={t("notes.underline")}
    aria-pressed={annotations.underline}
    aria-keyshortcuts="Control+U Meta+U"
    onmousedown={preserveMouseSelection}
    onpointerdown={preserveTouchSelection}
    onclick={() => onToggleAnnotation("underline")}
  >
    <svg
      class="size-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={customFormattingIconStrokeWidth}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5.5 4.5v7.25c0 3.75 2.5 5.75 6.5 5.75s6.5-2 6.5-5.75V4.5" />
      <path d="M4.5 20.5h15" />
    </svg>
  </button>
  <button
    type="button"
    class={buttonClass("strikethrough")}
    aria-label={t("notes.strikethrough")}
    title={t("notes.strikethrough")}
    aria-pressed={annotations.strikethrough}
    aria-keyshortcuts="Control+Shift+S Meta+Shift+S"
    onmousedown={preserveMouseSelection}
    onpointerdown={preserveTouchSelection}
    onclick={() => onToggleAnnotation("strikethrough")}
  >
    <svg
      class="size-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={customFormattingIconStrokeWidth}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M18 5.5c-1.4-1.2-3.4-1.8-6-1.8-4 0-6.5 1.7-6.5 4.4 0 2.2 2.1 3.5 6.5 4.3 4.4.8 6.5 2 6.5 4.2 0 2.8-2.5 4.5-6.5 4.5-2.6 0-4.6-.6-6-1.8" />
      <path d="M4 12h16" />
    </svg>
  </button>
  <button
    type="button"
    class={buttonClass("code")}
    aria-label={t("notes.inlineCode")}
    title={t("notes.inlineCode")}
    aria-pressed={annotations.code}
    aria-keyshortcuts="Control+E Meta+E"
    onmousedown={preserveMouseSelection}
    onpointerdown={preserveTouchSelection}
    onclick={() => onToggleAnnotation("code")}
  >
    <Code class="size-3.5" strokeWidth={toolbarIconStrokeWidth} aria-hidden="true" />
  </button>
  <button
    type="button"
    class={plainButtonClass()}
    aria-label={t("notes.inlineEquation")}
    title={t("notes.inlineEquation")}
    onmousedown={preserveMouseSelection}
    onpointerdown={preserveTouchSelection}
    onclick={onCreateEquation}
  >
    <Sigma class="size-3.5" strokeWidth={toolbarIconStrokeWidth} aria-hidden="true" />
  </button>
  <button
    type="button"
    class={plainButtonClass()}
    aria-label={t("notes.inlineComment")}
    title={t("notes.inlineComment")}
    onmousedown={preserveMouseSelection}
    onpointerdown={preserveTouchSelection}
    onclick={onCreateComment}
  >
    <MessageSquare class="size-3.5" strokeWidth={toolbarIconStrokeWidth} aria-hidden="true" />
  </button>
  <button
    type="button"
    class={plainButtonClass()}
    aria-label={t("notes.inlineSuggestion")}
    title={t("notes.inlineSuggestion")}
    onmousedown={preserveMouseSelection}
    onpointerdown={preserveTouchSelection}
    onclick={onCreateSuggestion}
  >
    <PencilLine class="size-3.5" strokeWidth={toolbarIconStrokeWidth} aria-hidden="true" />
  </button>
  <button
    type="button"
    class={plainButtonClass()}
    aria-label={t("notes.openLinkEditor")}
    title={t("notes.openLinkEditor")}
    onmousedown={preserveMouseSelection}
    onpointerdown={preserveTouchSelection}
    onclick={onOpenLink}
  >
    <LinkIcon class="size-3.5" strokeWidth={toolbarIconStrokeWidth} aria-hidden="true" />
  </button>
</div>

<style>
  .notes-inline-color-trigger,
  .notes-inline-color-swatch {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--notes-color-swatch-border);
    border-radius: 0.25rem;
    background: var(--notes-color-swatch-bg);
    color: var(--notes-color-swatch-fg);
    font-weight: 600;
    line-height: 1;
  }

  .notes-inline-color-trigger {
    width: 1.25rem;
    height: 1.25rem;
    font-size: 0.75rem;
  }

  .notes-inline-color-swatch {
    width: 1.75rem;
    height: 1.75rem;
    font-size: 0.95rem;
  }

  .notes-inline-color-selected {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
</style>
