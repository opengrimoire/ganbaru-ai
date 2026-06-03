<script lang="ts">
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
</script>

<div class="flex flex-col gap-6">
  <div
    class="flex min-h-9 items-center gap-2.5 rounded-md border border-border bg-background/60 px-3 py-1.5 text-muted-foreground dark:bg-transparent"
    aria-live="polite"
  >
    <span class="flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden="true">
      <CircleAlert size={14} strokeWidth={2.25} />
    </span>
    <div class="min-w-0 truncate text-[0.866667rem] font-medium">
      Mobile app blocking is still in progress
    </div>
  </div>
</div>
