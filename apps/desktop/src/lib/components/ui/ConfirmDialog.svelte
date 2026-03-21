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

  onMount(() => {
    function handleKeydown(e: KeyboardEvent) {
      if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); onConfirm(); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCancel(); }
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
  <div class="absolute inset-0 bg-black/40"></div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="relative z-10 rounded-lg border border-border bg-card px-6 py-4 shadow-xl"
    onclick={(e) => e.stopPropagation()}
  >
    <p class="mb-4 text-sm text-foreground">{message}</p>
    <div class="flex items-center justify-end gap-2">
      <button
        onclick={onCancel}
        class="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        {cancelLabel}
      </button>
      <button
        onclick={onConfirm}
        class="rounded-md px-3 py-1.5 text-xs font-medium text-white transition-colors {danger ? 'bg-red-800/80 hover:bg-red-700/80' : 'bg-primary hover:bg-primary/90'}"
      >
        {confirmLabel}
      </button>
    </div>
  </div>
</div>
