<script lang="ts">
  import { onMount } from "svelte";

  let {
    message,
    confirmLabel = "Yes (Enter)",
    cancelLabel = "No (Esc)",
    danger = true,
    onConfirm,
    onCancel,
  }: {
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
  } = $props();

  let backdropEl: HTMLDivElement | undefined = $state();
  let dialogEl: HTMLDivElement | undefined = $state();

  onMount(() => {
    backdropEl?.animate(
      [{ opacity: 0 }, { opacity: 1 }],
      { duration: 180, easing: "ease-out" },
    );
    dialogEl?.animate(
      [
        { transform: "scale(0.95)", opacity: 0 },
        { transform: "scale(1)", opacity: 1 },
      ],
      { duration: 180, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
    );

    function handleKeydown(e: KeyboardEvent) {
      if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); onConfirm(); }
      else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        (document.activeElement as HTMLElement)?.blur();
        onCancel();
      }
    }
    window.addEventListener("keydown", handleKeydown, true);
    return () => window.removeEventListener("keydown", handleKeydown, true);
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 z-[60] flex items-center justify-center"
  onclick={onCancel}
>
  <div bind:this={backdropEl} class="absolute inset-0 bg-black/20"></div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    bind:this={dialogEl}
    class="relative z-10 rounded-md border border-border bg-card px-8 py-5 shadow-xl"
    onclick={(e) => e.stopPropagation()}
  >
    <p class="mb-4 text-[15px] text-foreground">{message}</p>
    <div class="flex items-center justify-end gap-2">
      <button
        onclick={onCancel}
        class="rounded px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:bg-accent"
      >
        {cancelLabel}
      </button>
      <button
        onclick={onConfirm}
        class="rounded px-3 py-1.5 text-[13px] font-medium text-white transition-colors {danger ? 'bg-red-800/80 hover:bg-red-700/80' : 'bg-primary hover:bg-primary/90'}"
      >
        {confirmLabel}
      </button>
    </div>
  </div>
</div>
