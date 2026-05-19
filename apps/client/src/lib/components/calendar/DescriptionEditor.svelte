<script lang="ts">
  import { slide } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import Bold from "@lucide/svelte/icons/bold";
  import Italic from "@lucide/svelte/icons/italic";
  import Underline from "@lucide/svelte/icons/underline";
  import ListOrdered from "@lucide/svelte/icons/list-ordered";
  import List from "@lucide/svelte/icons/list";
  import Link from "@lucide/svelte/icons/link";
  import RemoveFormatting from "@lucide/svelte/icons/remove-formatting";
  import Check from "@lucide/svelte/icons/check";
  import AlignLeft from "@lucide/svelte/icons/align-left";
  import {
    calendarDescriptionPreviewText,
    isSafeCalendarDescriptionUrl,
    sanitizeCalendarDescriptionHtml,
  } from "$lib/calendar/description-sanitizer";

  let {
    description,
    readOnly = false,
    onchange,
  }: {
    description: string;
    readOnly?: boolean;
    onchange: (html: string) => void;
  } = $props();

  let descOpen = $state(false);
  let editorEl: HTMLDivElement | undefined = $state();
  let descAreaEl: HTMLDivElement | undefined = $state();
  const sanitizedDescription = $derived(sanitizeCalendarDescriptionHtml(description));

  function openDescEditor() {
    if (readOnly) return;
    descOpen = true;
    requestAnimationFrame(() => {
      if (editorEl) {
        editorEl.innerHTML = sanitizedDescription;
        editorEl.focus();
        const sel = window.getSelection();
        if (sel) {
          sel.selectAllChildren(editorEl);
          sel.collapseToEnd();
        }
      }
    });
  }

  function closeDescEditor() {
    if (!descOpen) return;
    sanitizeEditorDom();
    descOpen = false;
  }

  function handleEditorInput() {
    sanitizeEditorDom();
  }

  function sanitizeEditorDom() {
    if (!editorEl) return;
    const safeHtml = sanitizeCalendarDescriptionHtml(editorEl.innerHTML);
    if (safeHtml !== editorEl.innerHTML) {
      editorEl.innerHTML = safeHtml;
    }
    onchange(safeHtml);
  }

  function execFormat(command: string, value?: string) {
    document.execCommand(command, false, value);
    editorEl?.focus();
    handleEditorInput();
  }

  function plainTextToHtml(value: string): string {
    const wrapper = document.createElement("div");
    const lines = value.replaceAll("\r\n", "\n").split("\n");
    for (const [index, line] of lines.entries()) {
      if (index > 0) wrapper.append(document.createElement("br"));
      wrapper.append(document.createTextNode(line));
    }
    return wrapper.innerHTML;
  }

  let linkPopoverOpen = $state(false);
  let linkUrl = $state("https://");
  let linkBtnEl: HTMLButtonElement | undefined = $state();
  let linkInputEl: HTMLInputElement | undefined = $state();
  let savedSelection: Range | null = null;

  function openLinkPopover() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      savedSelection = sel.getRangeAt(0).cloneRange();
    }
    const selectedText = sel?.toString() ?? "";
    linkUrl = isSafeCalendarDescriptionUrl(selectedText) ? selectedText : "https://";
    linkPopoverOpen = true;
    requestAnimationFrame(() => {
      linkInputEl?.focus();
      linkInputEl?.select();
    });
  }

  function handleEditorPaste(e: ClipboardEvent) {
    const text = e.clipboardData?.getData("text/plain") ?? "";
    const sel = window.getSelection();
    const shouldLinkSelection = isSafeCalendarDescriptionUrl(text)
      && sel
      && !sel.isCollapsed
      && sel.rangeCount > 0;
    e.preventDefault();
    if (shouldLinkSelection) {
      document.execCommand("createLink", false, text);
      sanitizeEditorDom();
      return;
    }
    const html = e.clipboardData?.getData("text/html") ?? "";
    const safeHtml = sanitizeCalendarDescriptionHtml(html || plainTextToHtml(text));
    document.execCommand("insertHTML", false, safeHtml);
    sanitizeEditorDom();
  }

  function handleEditorDrop(e: DragEvent) {
    e.preventDefault();
    const text = e.dataTransfer?.getData("text/plain") ?? "";
    if (text) {
      document.execCommand("insertText", false, text);
    }
    sanitizeEditorDom();
  }

  function applyLink() {
    if (!linkUrl || linkUrl === "https://") { linkPopoverOpen = false; return; }
    if (!isSafeCalendarDescriptionUrl(linkUrl)) {
      linkPopoverOpen = false;
      savedSelection = null;
      return;
    }
    if (savedSelection) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(savedSelection);
    }
    document.execCommand("createLink", false, linkUrl);
    editorEl?.focus();
    sanitizeEditorDom();
    linkPopoverOpen = false;
    savedSelection = null;
  }

  function handleDescriptionRowClick(event: MouseEvent) {
    const target = event.target instanceof Element
      ? event.target.closest("a")
      : null;
    if (target) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!descOpen) openDescEditor();
  }

  function positionLinkPopover(node: HTMLElement) {
    if (!linkBtnEl) return { destroy() {} };
    const r = linkBtnEl.getBoundingClientRect();
    const pw = node.offsetWidth || 220;
    let left = r.left + r.width / 2 - pw / 2;
    left = Math.max(8, Math.min(window.innerWidth - pw - 8, left));
    node.style.left = `${left}px`;
    node.style.top = `${r.bottom + 4}px`;
    return { destroy() {} };
  }

  const descPreview = $derived.by(() => {
    if (!sanitizedDescription) return "";
    return calendarDescriptionPreviewText(sanitizedDescription);
  });

  // Sync editor content when it first appears (e.g. editing existing event with description)
  $effect(() => {
    if (descOpen && editorEl && editorEl.innerHTML !== sanitizedDescription) {
      editorEl.innerHTML = sanitizedDescription;
    }
  });

  // Close on click outside (capture phase to work with stopPropagation on panel root)
  $effect(() => {
    if (!descOpen) return;
    function handleCapture(e: MouseEvent) {
      if (descAreaEl && !descAreaEl.contains(e.target as Node)) {
        closeDescEditor();
      }
    }
    document.addEventListener("click", handleCapture, true);
    return () => document.removeEventListener("click", handleCapture, true);
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div bind:this={descAreaEl}>
  {#if descOpen}
    <div transition:slide={{ duration: 250, easing: cubicOut }} class="flex items-center gap-0.5 py-1" style="padding-left: 23px;">
      {#each [
        { icon: Bold, cmd: "bold", title: "Bold" },
        { icon: Italic, cmd: "italic", title: "Italic" },
        { icon: Underline, cmd: "underline", title: "Underline" },
      ] as btn}
        {@const Icon = btn.icon}
        <button
          onmousedown={(e) => e.preventDefault()}
          onclick={() => execFormat(btn.cmd)}
          class="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-black/5 dark:hover:bg-black/15 hover:text-foreground"
          title={btn.title}
        ><Icon size={13} /></button>
      {/each}
      <div class="mx-0.5 h-3.5 w-px bg-border/60"></div>
      {#each [
        { icon: ListOrdered, cmd: "insertOrderedList", title: "Numbered list" },
        { icon: List, cmd: "insertUnorderedList", title: "Bulleted list" },
      ] as btn}
        {@const Icon = btn.icon}
        <button
          onmousedown={(e) => e.preventDefault()}
          onclick={() => execFormat(btn.cmd)}
          class="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-black/5 dark:hover:bg-black/15 hover:text-foreground"
          title={btn.title}
        ><Icon size={13} /></button>
      {/each}
      <div class="mx-0.5 h-3.5 w-px bg-border/60"></div>
      <button bind:this={linkBtnEl}
        onmousedown={(e) => e.preventDefault()}
        onclick={openLinkPopover}
        class="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-black/5 dark:hover:bg-black/15 hover:text-foreground"
        title="Insert link"
      ><Link size={13} /></button>
      {#if linkPopoverOpen}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="fixed inset-0 z-60" onclick={() => { linkPopoverOpen = false; }}></div>
        <div class="fixed z-61 flex items-center gap-1.5 rounded-lg bg-popover p-2 shadow-lg ring-1 ring-border/60"
          use:positionLinkPopover>
          <input bind:this={linkInputEl}
            type="text" bind:value={linkUrl} placeholder="https://..."
            onkeydown={(e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); applyLink(); } if (e.key === "Escape") { linkPopoverOpen = false; } }}
            class="w-40 rounded bg-black/5 dark:bg-black/15 px-2 py-1 text-[0.733333rem] text-event-panel-input-text outline-none placeholder:text-muted-foreground"
          />
          <button onclick={applyLink}
            class="rounded bg-black/5 dark:bg-black/15 px-2 py-1 text-[0.733333rem] text-foreground transition-colors hover:bg-black/10 dark:hover:bg-black/25">
            Apply
          </button>
        </div>
      {/if}
      <button
        onmousedown={(e) => e.preventDefault()}
        onclick={() => execFormat("removeFormat")}
        class="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-black/5 dark:hover:bg-black/15 hover:text-foreground"
        title="Remove formatting"
      ><RemoveFormatting size={13} /></button>
      <button
        onmousedown={(e) => e.preventDefault()}
        onclick={closeDescEditor}
        class="ml-auto flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-black/5 dark:hover:bg-black/15 hover:text-foreground"
        title="Done"
      ><Check size={13} /></button>
    </div>
  {/if}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="flex items-center gap-2.5 leading-none {!descOpen && !readOnly ? 'cursor-text' : ''}"
    onclick={handleDescriptionRowClick}
  >
    <AlignLeft size={13} class="shrink-0 text-foreground" />
    <div class="min-w-0 flex-1">
      {#if descOpen}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          bind:this={editorEl}
          contenteditable={!readOnly}
          class="desc-editor desc-content max-h-20 overflow-y-auto text-[0.733333rem] leading-3.75 text-foreground outline-none"
          class:desc-editing={!readOnly}
          oninput={handleEditorInput}
          onpaste={handleEditorPaste}
          ondrop={handleEditorDrop}
          onblur={sanitizeEditorDom}
          onkeydown={(e) => { if (descOpen) e.stopPropagation(); }}
        ></div>
      {:else if descPreview}
        <div
          class="desc-preview max-h-11.25 overflow-hidden text-[0.733333rem] leading-3.75 text-foreground"
          title={descPreview}
        >{descPreview}</div>
      {:else}
        <span class="text-[0.733333rem] text-muted-foreground/40">Add description</span>
      {/if}
    </div>
  </div>
</div>

<style>
  .desc-content {
    transition: background-color 250ms ease-out, padding 250ms ease-out, border-radius 250ms ease-out;
    padding: 0;
    background-color: transparent;
    border-radius: 0;
  }

  .desc-editing {
    background-color: color-mix(
      in oklab,
      var(--event-panel-bg) 45%,
      var(--event-panel-contrast)
    );
    padding: 6px 8px;
    border-radius: 4px;
  }

  .desc-editor:empty::before {
    content: "Type something...";
    color: var(--muted-foreground);
    opacity: 0.5;
    pointer-events: none;
  }

  .desc-editor :global(ul),
  .desc-editor :global(ol) {
    padding-left: 1.25em;
    margin: 2px 0;
  }
  .desc-editor :global(ul) {
    list-style: disc;
  }
  .desc-editor :global(ol) {
    list-style: decimal;
  }
  .desc-editor :global(a) {
    color: var(--primary);
    cursor: pointer;
    text-decoration: underline;
  }
  .desc-editor :global(b),
  .desc-editor :global(strong) {
    font-weight: 600;
  }
  .desc-editor :global(i),
  .desc-editor :global(em) {
    font-style: italic;
  }
  .desc-editor :global(u) {
    text-decoration: underline;
  }
</style>
