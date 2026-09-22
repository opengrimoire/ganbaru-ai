<script lang="ts">
  import { untrack } from "svelte";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import MusicBuilderDialog from "./MusicBuilderDialog.svelte";

  let {
    currentName,
    saving = false,
    error = null,
    onClose,
    onSave,
  }: {
    currentName: string;
    saving?: boolean;
    error?: string | null;
    onClose: () => void;
    onSave: (name: string) => void;
  } = $props();

  const { t } = getLocalization();
  let name = $state(untrack(() => currentName));
</script>

<MusicBuilderDialog title={t("music.builder.renameSource")} titleId="music-source-name-title" size="small" dismissDisabled={saving} onDismiss={onClose}>
  <label class="block">
    <span class="mb-1.5 block text-xs font-medium">{t("music.builder.sourceName")}</span>
    <input data-dialog-autofocus bind:value={name} maxlength="200" class="h-11 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:border-ring" onkeydown={(event) => { if (event.key === "Enter" && name.trim() && name.trim() !== currentName) onSave(name.trim()); }} />
  </label>
  {#if error}<p class="mt-3 text-sm text-destructive" role="alert">{error}</p>{/if}

  {#snippet footer()}
    <button type="button" onclick={onClose} disabled={saving} class="name-cancel">{t("music.builder.cancel")}</button>
    <button type="button" onclick={() => onSave(name.trim())} disabled={saving || !name.trim() || name.trim() === currentName} class="name-save">{t("music.builder.save")}</button>
  {/snippet}
</MusicBuilderDialog>

<style>
  .name-save, .name-cancel { display: inline-flex; min-height: 3rem; align-items: center; justify-content: center; border: 1px solid var(--border); border-radius: 0.375rem; padding: 0.5rem 0.95rem; font-size: calc(0.875rem * var(--type-scale)); font-weight: 500; }
  .name-save { background: var(--primary); color: var(--primary-foreground); }
  .name-cancel { background: var(--card); color: var(--foreground); }
  .name-cancel:hover { background: var(--accent); }
  .name-save:disabled { opacity: 0.45; }
</style>
