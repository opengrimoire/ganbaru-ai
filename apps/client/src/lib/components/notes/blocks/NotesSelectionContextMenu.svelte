<script lang="ts">
  import { tick } from "svelte";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { dismissOnOutside } from "$lib/utils/dismiss-on-outside";

  let { position, actions, onClose }: {
    position: { x: number; y: number };
    actions: { label: string; disabled?: boolean; run: () => void }[];
    onClose: () => void;
  } = $props();
  const { t } = getLocalization();
  let element: HTMLDivElement;
  let left = $state(0);
  let top = $state(0);
  $effect(() => {
    const point = position;
    void tick().then(() => {
      if (!element) return;
      const rect = element.getBoundingClientRect();
      left = Math.max(0, Math.min(point.x, window.innerWidth - rect.width));
      top = Math.max(0, Math.min(point.y, window.innerHeight - rect.height));
      element.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
    });
  });
  function keydown(event: KeyboardEvent): void {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const buttons = Array.from(element.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
    const index = buttons.findIndex((button) => button === document.activeElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
      : (index + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length;
    buttons[next]?.focus();
  }
</script>

<div bind:this={element} data-notes-selection-menu role="menu" tabindex="-1"
  aria-label={t("notes.selectionActions")} onkeydown={keydown}
  use:dismissOnOutside={{ onDismiss: onClose }}
  style:left={`${left}px`} style:top={`${top}px`}
  class="fixed z-50 flex min-w-40 flex-col rounded-md border border-border bg-popover p-1 text-sm text-popover-foreground shadow-md"
>
  {#each actions as action}
    <button type="button" role="menuitem" disabled={action.disabled}
      class="rounded-sm px-3 py-1.5 text-left hover:bg-accent focus:bg-accent disabled:opacity-50"
      onclick={() => { action.run(); onClose(); }}>{action.label}</button>
  {/each}
</div>
