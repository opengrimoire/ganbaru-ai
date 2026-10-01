<script lang="ts">
  import type { Snippet } from "svelte";
  import CollectionCell from "./CollectionCell.svelte";

  let { label, resizeLabel, disabled = false, icon, actions, class: className = "", style, onpointerdown, ondblclick, onkeydown }: {
    label: string;
    resizeLabel: string;
    disabled?: boolean;
    icon?: Snippet;
    actions?: Snippet;
    class?: string;
    style?: string;
    onpointerdown: (event: PointerEvent) => void;
    ondblclick?: (event: MouseEvent) => void;
    onkeydown: (event: KeyboardEvent) => void;
  } = $props();
</script>

<CollectionCell role="columnheader" class={`${actions ? "gap-0 px-0" : "gap-1.5"} ${className}`} {style}>
  {#if actions}
    {@render actions()}
  {:else}
    {@render icon?.()}
    <span class="relative z-10 truncate">{label}</span>
  {/if}
  <button type="button" class="collection-resize" aria-label={resizeLabel} data-app-tooltip-disabled="true" {disabled} {onpointerdown} {ondblclick} {onkeydown}></button>
</CollectionCell>

<style>
  .collection-resize {
    position: absolute;
    top: 0.375rem;
    right: -0.375rem;
    bottom: 0.375rem;
    z-index: 20;
    width: 0.75rem;
    border: 0;
    background: transparent;
    cursor: col-resize;
    touch-action: none;
    padding: 0;
  }
  .collection-resize::after {
    position: absolute;
    inset-block: 0;
    left: 50%;
    width: 0.25rem;
    transform: translateX(-50%);
    border-radius: 9999px;
    background: var(--primary);
    content: "";
    opacity: 0;
  }
  .collection-resize:hover::after,
  .collection-resize:focus-visible::after,
  .collection-resize:active::after { opacity: 1; }
</style>
