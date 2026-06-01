<script lang="ts">
  import Check from "@lucide/svelte/icons/check";
  import Plus from "@lucide/svelte/icons/plus";
  import Power from "@lucide/svelte/icons/power";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import { cn } from "$lib/utils";

  interface DoomscrollingRuleListItem {
    id: string;
    label: string;
    enabled: boolean;
    locked?: boolean;
    stateLabel?: string;
  }

  let {
    id,
    heading,
    description,
    placeholder,
    emptyText,
    errorText,
    items,
    onAdd,
    onOpenSelector,
    selectorLabel = "Add",
    onEnabledChange,
    onDelete,
  }: {
    id: string;
    heading: string;
    description: string;
    placeholder: string;
    emptyText: string;
    errorText: string;
    items: readonly DoomscrollingRuleListItem[];
    onAdd: (text: string) => boolean;
    onOpenSelector?: () => void;
    selectorLabel?: string;
    onEnabledChange: (label: string, enabled: boolean) => void;
    onDelete: (label: string) => void;
  } = $props();

  let draft = $state("");
  let error = $state("");

  function addItem(): void {
    if (onAdd(draft)) {
      draft = "";
      error = "";
      return;
    }
    error = errorText;
  }

  function submitAdd(event: SubmitEvent): void {
    event.preventDefault();
    addItem();
  }
</script>

<div class="flex flex-col gap-2 px-1 py-1">
  <div class="min-w-0">
    <label for={id} class="text-[0.866667rem] text-foreground">{heading}</label>
    <div class="mt-0.5 text-[0.8rem] text-muted-foreground">
      {description}
    </div>
  </div>
  <div class="flex flex-col">
    {#if onOpenSelector}
      <button
        type="button"
        onclick={onOpenSelector}
        class="flex h-10 min-w-0 items-center gap-1.5 border-b border-border/70 px-1 text-[0.8rem] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <Plus size={13} strokeWidth={2.25} />
        <span>{selectorLabel}</span>
      </button>
    {:else}
      <form
        class="flex min-w-0 items-center gap-2 border-b border-border/70 py-1.5 focus-within:border-ring"
        onsubmit={submitAdd}
      >
        <input
          {id}
          bind:value={draft}
          oninput={() => {
            error = "";
          }}
          type="text"
          spellcheck="false"
          {placeholder}
          class="flex h-7 min-w-0 flex-1 items-center bg-transparent px-1 text-[0.8rem] leading-snug text-foreground outline-none placeholder:text-muted-foreground"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          class="flex h-7 shrink-0 items-center justify-center gap-1.5 px-1 text-[0.8rem] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus size={13} strokeWidth={2.25} />
          <span>Add</span>
        </button>
      </form>
    {/if}
    {#if error}
      <div class="px-1 pt-1.5 text-[0.8rem] text-destructive">{error}</div>
    {/if}
    <div class="flex flex-col">
      {#each items as item (item.id)}
        <div
          class="flex min-w-0 items-center gap-2 border-b border-border/70 py-1.5"
          role="group"
          aria-label={item.enabled ? item.label : `${item.label} disabled`}
        >
          <span
            class={cn(
              "flex h-7 min-w-0 flex-1 items-center truncate px-1 text-[0.8rem] leading-snug text-foreground",
              !item.enabled && "opacity-50 line-through",
            )}
          >
            {item.label}
          </span>
          {#if item.locked}
            <span class="flex h-7 w-32 shrink-0 items-center justify-center rounded-md border border-border bg-card px-2 text-[0.8rem] text-muted-foreground dark:bg-transparent">
              {item.stateLabel ?? "Locked"}
            </span>
          {:else}
            <button
              type="button"
              onclick={() => onEnabledChange(item.label, !item.enabled)}
              aria-label={item.enabled ? `Disable ${item.label}` : `Enable ${item.label}`}
              data-app-tooltip-disabled="true"
              class="flex h-7 w-24 shrink-0 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-2 text-[0.8rem] text-foreground hover:bg-accent dark:bg-transparent"
            >
              {#if item.enabled}
                <Check size={13} strokeWidth={2.25} class="shrink-0" />
                <span>Enabled</span>
              {:else}
                <Power size={13} strokeWidth={2} class="shrink-0" />
                <span>Disabled</span>
              {/if}
            </button>
            <button
              type="button"
              onclick={() => onDelete(item.label)}
              aria-label={`Remove ${item.label}`}
              data-app-tooltip-disabled="true"
              class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-card text-foreground transition-colors hover:bg-accent dark:bg-transparent"
            >
              <Trash2 size={13} strokeWidth={2} />
            </button>
          {/if}
        </div>
      {:else}
        <div class="flex h-10 items-center border-b border-border/70 px-1 text-[0.8rem] text-muted-foreground">
          {emptyText}
        </div>
      {/each}
    </div>
  </div>
</div>
