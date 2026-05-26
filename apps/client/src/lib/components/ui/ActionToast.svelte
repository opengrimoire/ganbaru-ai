<script lang="ts">
  import X from "@lucide/svelte/icons/x";

  let {
    message,
    actionLabel,
    dismissLabel = "Dismiss notification",
    onAction,
    onDismiss,
  }: {
    message: string;
    actionLabel?: string;
    dismissLabel?: string;
    onAction?: () => void | Promise<void>;
    onDismiss: () => void;
  } = $props();
</script>

<div
  role="status"
  aria-live="polite"
  class="fixed bottom-4 left-1/2 z-70 flex w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 items-center gap-3 rounded-md border border-border bg-popover px-3 py-2 text-[0.866667rem] text-popover-foreground shadow-lg"
>
  <span class="min-w-0 flex-1 truncate">{message}</span>
  {#if actionLabel && onAction}
    <button
      type="button"
      class="rounded-sm px-2 py-1 text-[0.8rem] font-medium text-popover-foreground underline decoration-popover-foreground/40 underline-offset-2 transition-colors hover:bg-accent hover:text-accent-foreground hover:no-underline focus:outline-none focus:ring-1 focus:ring-ring"
      onclick={() => {
        void onAction();
      }}
    >
      {actionLabel}
    </button>
  {/if}
  <button
    type="button"
    class="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
    onclick={onDismiss}
  >
    <span class="sr-only">{dismissLabel}</span>
    <X size={14} strokeWidth={2} aria-hidden="true" />
  </button>
</div>
