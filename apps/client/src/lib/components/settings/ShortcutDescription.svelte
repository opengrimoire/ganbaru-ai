<script lang="ts">
  let {
    shortcuts,
  }: {
    shortcuts: readonly string[];
  } = $props();

  function shortcutParts(shortcut: string): string[] {
    return shortcut.split(" + ");
  }
</script>

<div
  class="mt-0.5 flex min-h-4 items-center gap-4 overflow-hidden whitespace-nowrap text-muted-foreground"
>
  <span class="text-[0.666667rem] leading-4">Shortcuts:</span>
  {#each shortcuts as shortcut}
    <span class="inline-flex items-center gap-0.5">
      {#each shortcutParts(shortcut) as part, partIndex}
        {#if partIndex > 0}
          <span class="text-[0.666667rem] leading-4 text-muted-foreground">+</span>
        {/if}
        <kbd
          class="inline-flex h-4 min-w-4 items-center justify-center rounded border border-border bg-background px-1 font-mono text-[0.666667rem] leading-none text-foreground shadow-sm"
        >
          {part}
        </kbd>
      {/each}
    </span>
  {/each}
</div>
