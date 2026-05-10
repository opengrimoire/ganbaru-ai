<script lang="ts">
  import Copy from "@lucide/svelte/icons/copy";
  import Download from "@lucide/svelte/icons/download";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import { cn } from "$lib/utils";

  let {
    isBuiltin,
    jsonDraft,
    jsonDirty,
    jsonErrors,
    jsonNotice,
    onCopy,
    onSave,
    onApply,
    onReset,
    onInput,
  }: {
    isBuiltin: boolean;
    jsonDraft: string;
    jsonDirty: boolean;
    jsonErrors: string[];
    jsonNotice: string | undefined;
    onCopy: () => void;
    onSave: () => void;
    onApply: () => void;
    onReset: () => void;
    onInput: (event: Event) => void;
  } = $props();
</script>

<section class="flex flex-col">
  <header class="px-1 py-2.5">
    <h2 class="text-[13px] font-semibold text-foreground">Schema</h2>
    <div class="text-[11px] text-muted-foreground">
      {isBuiltin
        ? "Read-only representation of the theme"
        : "Edit directly, apply to commit changes"}
    </div>
  </header>
  <div class="flex flex-col gap-2">
    <textarea
      value={jsonDraft}
      oninput={isBuiltin ? undefined : onInput}
      readonly={isBuiltin}
      spellcheck={false}
      rows={12}
      class="w-full resize-y rounded-md border border-border bg-background p-2 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
    ></textarea>
    {#if jsonErrors.length > 0}
      <ul
        class="flex flex-col gap-0.5 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive"
      >
        {#each jsonErrors as err}
          <li>{err}</li>
        {/each}
      </ul>
    {/if}
    <div class="theme-json-actions flex flex-wrap items-center justify-between gap-2">
      <div class="theme-json-action-group flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onclick={onCopy}
          class="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-[11px] text-foreground transition-colors hover:bg-accent"
        >
          <Copy size={11} strokeWidth={2.25} />
          <span>Copy JSON</span>
        </button>
        <button
          type="button"
          onclick={onSave}
          class="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-[11px] text-foreground transition-colors hover:bg-accent"
        >
          <Download size={11} strokeWidth={2.25} />
          <span>Save to file</span>
        </button>
      </div>
      {#if !isBuiltin}
        <div class="theme-json-action-group flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onclick={onReset}
            disabled={!jsonDirty}
            class={cn(
              "flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-[11px] transition-colors",
              jsonDirty
                ? "text-foreground hover:bg-accent"
                : "cursor-not-allowed text-muted-foreground opacity-60",
            )}
          >
            <RotateCcw size={11} strokeWidth={2.25} />
            <span>Discard edits</span>
          </button>
          <button
            type="button"
            onclick={onApply}
            disabled={!jsonDirty}
            class={cn(
              "rounded-md border border-border px-3 py-1 text-[11px] font-medium transition-colors",
              jsonDirty
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "cursor-not-allowed bg-card text-muted-foreground opacity-60",
            )}
          >
            Apply changes
          </button>
        </div>
      {/if}
    </div>
    {#if jsonNotice}
      <div class="text-[11px] text-muted-foreground">{jsonNotice}</div>
    {/if}
  </div>
</section>

<style>
  @container theme-editor (max-width: 620px) {
    .theme-json-actions {
      align-items: stretch;
      flex-direction: column;
    }

    .theme-json-action-group {
      justify-content: flex-end;
    }
  }
</style>
