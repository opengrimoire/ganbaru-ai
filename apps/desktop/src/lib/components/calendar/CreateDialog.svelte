<script lang="ts">
  let {
    startTime,
    endTime,
    onConfirm,
    onCancel,
  }: {
    startTime: string;
    endTime: string;
    onConfirm: (title: string, start: string, end: string) => void;
    onCancel: () => void;
  } = $props();

  let title = $state("Focus session");
  let inputEl: HTMLInputElement | undefined = $state();

  $effect(() => {
    // Auto-focus the title input when dialog opens
    inputEl?.select();
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      onConfirm(title, startTime, endTime);
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  }

  const displayStart = $derived(startTime.split(" ")[1] ?? startTime);
  const displayEnd = $derived(endTime.split(" ")[1] ?? endTime);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="absolute inset-0 z-50 flex items-center justify-center bg-black/50"
  role="dialog"
  aria-modal="true"
  onkeydown={handleKeydown}
>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="absolute inset-0" onclick={onCancel}></div>

  <div class="relative z-10 w-80 rounded-lg border border-border bg-card p-4 shadow-xl">
    <p class="mb-3 text-sm font-semibold text-foreground">New session block</p>
    <p class="mb-3 text-xs text-muted-foreground">
      {displayStart} - {displayEnd}
    </p>
    <input
      bind:this={inputEl}
      type="text"
      bind:value={title}
      placeholder="Session title..."
      class="w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
      onkeydown={handleKeydown}
    />
    <div class="mt-3 flex justify-end gap-2">
      <button
        class="rounded px-3 py-1 text-xs text-muted-foreground hover:bg-accent"
        onclick={onCancel}
      >
        Cancel
      </button>
      <button
        class="rounded bg-primary px-3 py-1 text-xs text-primary-foreground hover:opacity-80"
        onclick={() => onConfirm(title, startTime, endTime)}
      >
        Create
      </button>
    </div>
  </div>
</div>
