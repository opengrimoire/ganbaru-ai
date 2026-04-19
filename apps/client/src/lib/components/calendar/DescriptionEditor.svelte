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
  let descClosing = $state(false);
  let editorEl: HTMLDivElement | undefined = $state();
  let descAreaEl: HTMLDivElement | undefined = $state();

  function openDescEditor() {
    if (readOnly) return;
    descOpen = true;
    requestAnimationFrame(() => {
      if (editorEl) {
        editorEl.innerHTML = description;
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
    if (!descOpen || descClosing) return;
    descClosing = true;
    descOpen = false;
    // Keep element in DOM during toolbar slide-out, then release
    setTimeout(() => { descClosing = false; }, 250);
  }

  function handleEditorInput() {
    if (editorEl) {
      onchange(editorEl.innerHTML);
    }
  }

  function execFormat(command: string, value?: string) {
    document.execCommand(command, false, value);
    editorEl?.focus();
    handleEditorInput();
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
    linkUrl = selectedText.startsWith("http") ? selectedText : "https://";
    linkPopoverOpen = true;
    requestAnimationFrame(() => {
      linkInputEl?.focus();
      linkInputEl?.select();
    });
  }

  function handleEditorPaste(e: ClipboardEvent) {
    const text = e.clipboardData?.getData("text/plain") ?? "";
    if (!text.startsWith("http")) return; // let normal paste happen
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return; // no selection, normal paste
    e.preventDefault();
    document.execCommand("createLink", false, text);
    handleEditorInput();
  }

  function applyLink() {
    if (!linkUrl || linkUrl === "https://") { linkPopoverOpen = false; return; }
    if (savedSelection) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(savedSelection);
    }
    document.execCommand("createLink", false, linkUrl);
    editorEl?.focus();
    handleEditorInput();
    linkPopoverOpen = false;
    savedSelection = null;
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
    if (!description) return "";
    const tmp = document.createElement("div");
    tmp.innerHTML = description;
    return tmp.textContent?.trim() ?? "";
  });

  // Sync description HTML into the persistent editor element when not actively editing
  $effect(() => {
    if (!descOpen && !descClosing && editorEl) {
      editorEl.innerHTML = description;
    }
  });

  // Sync editor content when it first appears (e.g. editing existing event with description)
  $effect(() => {
    if (descOpen && editorEl && editorEl.innerHTML !== description) {
      editorEl.innerHTML = description;
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
        <div class="fixed inset-0 z-[60]" onclick={() => { linkPopoverOpen = false; }}></div>
        <div class="fixed z-[61] flex items-center gap-1.5 rounded-lg bg-popover p-2 shadow-lg ring-1 ring-border/60"
          use:positionLinkPopover>
          <input bind:this={linkInputEl}
            type="text" bind:value={linkUrl} placeholder="https://..."
            onkeydown={(e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); applyLink(); } if (e.key === "Escape") { linkPopoverOpen = false; } }}
            class="w-40 rounded bg-black/5 dark:bg-black/15 px-2 py-1 text-[11px] text-event-panel-input-text outline-none placeholder:text-muted-foreground"
          />
          <button onclick={applyLink}
            class="rounded bg-black/5 dark:bg-black/15 px-2 py-1 text-[11px] text-foreground transition-colors hover:bg-black/10 dark:hover:bg-black/25">
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
    class="flex items-center gap-2.5 leading-none {!descOpen && !descClosing && !readOnly ? 'cursor-text' : ''}"
    onclick={() => { if (!descOpen && !descClosing) openDescEditor(); }}
  >
    <AlignLeft size={13} class="shrink-0 text-foreground" />
    <div class="min-w-0 flex-1">
      {#if descOpen || descClosing || descPreview}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          bind:this={editorEl}
          contenteditable={descOpen && !descClosing && !readOnly}
          class="desc-editor desc-content max-h-[80px] overflow-y-auto text-[11px] leading-[15px] text-foreground outline-none"
          class:desc-editing={descOpen && !descClosing}
          oninput={handleEditorInput}
          onpaste={handleEditorPaste}
          onkeydown={(e) => { if (descOpen) e.stopPropagation(); }}
        ></div>
      {:else}
        <span class="text-[11px] text-muted-foreground/40">Add description</span>
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
    background-color: var(--cal-description-editor-bg);
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
