<script lang="ts">
  import { tick } from "svelte";
  import type { HTMLInputAttributes } from "svelte/elements";
  import Plus from "@lucide/svelte/icons/plus";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  let { label, draft = $bindable(""), active = $bindable(false), disabled = false, inputAttributes, onDraftChange, onActiveChange, onsubmit, oncreate }: {
    label: string;
    draft?: string;
    active?: boolean;
    disabled?: boolean;
    inputAttributes?: HTMLInputAttributes;
    onDraftChange?: (draft: string) => void;
    onActiveChange?: (active: boolean) => void;
  } & ({ onsubmit: (title: string) => Promise<boolean>; oncreate?: never }
    | { oncreate: () => void; onsubmit?: never }) = $props();
  const { t } = getLocalization();
  let input: HTMLInputElement | undefined = $state();
  let trigger: HTMLButtonElement | undefined = $state();
  let pending = $state(false);
  let error = $state<string | null>(null);

  async function begin(): Promise<void> {
    if (oncreate) { oncreate(); return; }
    active = true;
    onActiveChange?.(true);
    await tick();
    input?.focus();
  }

  async function submit(): Promise<void> {
    if (!onsubmit || !draft.trim() || disabled || pending) return;
    pending = true;
    error = null;
    try {
      if (await onsubmit(draft.trim())) { draft = ""; onDraftChange?.(""); }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      pending = false;
      await tick();
      input?.focus();
    }
  }

  function cancel(): void {
    draft = "";
    active = false;
    error = null;
    onDraftChange?.("");
    onActiveChange?.(false);
    void tick().then(() => trigger?.focus({ preventScroll: true }));
  }
</script>

<div class="min-w-0">
  {#if active || draft}
    <form class="flex min-h-10 min-w-0 items-center gap-1 rounded-md bg-accent/20 px-2" onsubmit={(event) => { event.preventDefault(); void submit(); }}>
      <input {...inputAttributes} bind:this={input} value={draft} oninput={(event) => { draft = event.currentTarget.value; onDraftChange?.(draft); }} aria-label={label} placeholder={label} disabled={disabled || pending} class="min-h-9 w-full min-w-0 bg-transparent text-[0.866667rem] text-foreground outline-none" onkeydown={(event) => { event.stopPropagation(); if (event.key === "Escape" && !pending) { event.preventDefault(); cancel(); } }} />
      <button type="submit" class="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" disabled={disabled || pending || !draft.trim()} aria-label={label}><Plus class="size-4" /></button>
      <button type="button" class="rounded-md px-2 py-1 text-[0.8rem] text-muted-foreground hover:bg-accent" disabled={pending} onclick={cancel}>{t("common.cancel")}</button>
    </form>
  {:else}
    <button bind:this={trigger} type="button" class="flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-left text-[0.866667rem] text-muted-foreground hover:bg-accent/40 hover:text-foreground" {disabled} onclick={() => { void begin(); }}><Plus class="size-4" />{label}</button>
  {/if}
  {#if error}<p role="alert" class="px-2 py-1 text-[0.8rem] text-destructive">{error}</p>{/if}
</div>
