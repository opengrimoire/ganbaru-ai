<script lang="ts">
  import Check from "@lucide/svelte/icons/check";
  import type { CollectionIcon } from "./property-icons";

  /** One action row in a collection column or property menu, shared so Notes and Projects menus look and behave alike. */
  let { icon: Icon, label, checked, disabled = false, onclick }: {
    /** Leading icon; choice lists inside submenus may omit it. */
    icon?: CollectionIcon;
    label: string;
    /** Shows a check and exposes the pressed state for toggles and current choices. */
    checked?: boolean;
    disabled?: boolean;
    onclick: () => void;
  } = $props();
</script>

<button type="button" class="flex min-h-8 w-full min-w-0 items-center gap-2 rounded-sm px-2 text-left hover:bg-accent disabled:cursor-not-allowed disabled:text-muted-foreground/60 disabled:hover:bg-transparent"
  aria-pressed={checked} {disabled} {onclick}>
  {#if Icon}<Icon class="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />{/if}
  <span class="min-w-0 flex-1 truncate">{label}</span>
  {#if checked}<Check class="size-3.5 shrink-0" aria-hidden="true" />{/if}
</button>
