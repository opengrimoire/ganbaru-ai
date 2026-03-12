<script lang="ts">
  import type { CalendarEvent } from "./types";

  let {
    event,
    onClose,
    onDelete,
  }: {
    event: CalendarEvent;
    onClose: () => void;
    onDelete: (id: string) => void;
  } = $props();

  const startTime = $derived(event.start.split(" ")[1] ?? "");
  const endTime = $derived(event.end.split(" ")[1] ?? "");
  const datePart = $derived(event.start.split(" ")[0] ?? "");
</script>

<div
  class="absolute bottom-4 right-4 z-40 w-64 rounded-lg border border-border bg-card p-4 shadow-lg"
>
  <div class="mb-1 flex items-start justify-between gap-2">
    <span class="text-sm font-medium text-foreground">{event.title}</span>
    <button
      onclick={onClose}
      class="mt-0.5 text-xs text-muted-foreground hover:text-foreground"
    >
      ✕
    </button>
  </div>
  <p class="text-xs text-muted-foreground">
    {datePart}
  </p>
  <p class="text-xs text-muted-foreground">
    {startTime} - {endTime}
  </p>
  <button
    onclick={() => onDelete(event.id)}
    class="mt-3 w-full rounded bg-destructive px-2 py-1.5 text-xs text-white hover:opacity-90"
  >
    Delete
  </button>
</div>
