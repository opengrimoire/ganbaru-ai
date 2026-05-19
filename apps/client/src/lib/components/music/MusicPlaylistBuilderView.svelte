<script lang="ts">
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";

  let { onBack }: { onBack: () => void } = $props();

  const musicIconSize = 14;
  const musicIconStrokeWidth = 1.5;
</script>

<section
  class="flex h-full min-h-0 flex-col text-foreground"
  style="background-color: var(--cal-bg);"
>
  <header class="flex h-(--cal-header-row-h) shrink-0 items-center gap-2 px-2">
    <button
      type="button"
      onclick={onBack}
      class="inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md border border-border bg-secondary px-2.5 text-[0.8rem] font-medium text-secondary-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      aria-label="Back to music player"
    >
      <ArrowLeft size={musicIconSize} strokeWidth={musicIconStrokeWidth} />
      <span>Media player</span>
    </button>
  </header>

  <div class="min-h-0 flex-1"></div>
</section>
