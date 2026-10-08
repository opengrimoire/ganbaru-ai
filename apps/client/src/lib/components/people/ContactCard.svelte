<script lang="ts">
  import Copy from "@lucide/svelte/icons/copy";
  import ImageDown from "@lucide/svelte/icons/image-down";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { getPreferences } from "$lib/stores/preferences.svelte";
  import { activeVaultIdentity } from "$lib/vault/active-vault";
  import { contactCardCode, contactCardMatrix } from "./model";

  /** The local user's contact card: a QR code and a pasteable code derived from the vault identity. */
  const QUIET_ZONE_MODULES = 2;
  const { t } = getLocalization();
  const preferences = getPreferences();
  const displayName = $derived(preferences.profileDisplayName || t("people.you"));
  const seed = $derived(activeVaultIdentity() ?? displayName);
  const code = $derived(contactCardCode(seed));
  const matrix = $derived(contactCardMatrix(seed));
  const viewBox = $derived(`${-QUIET_ZONE_MODULES} ${-QUIET_ZONE_MODULES} ${matrix.width + 2 * QUIET_ZONE_MODULES} ${matrix.width + 2 * QUIET_ZONE_MODULES}`);
</script>

<div class="flex gap-5 max-[480px]:flex-col">
  <svg
    {viewBox}
    class="aspect-square w-40 shrink-0 rounded-md bg-white max-[480px]:w-full max-[480px]:max-w-56 max-[480px]:self-center"
    role="img"
    aria-label={t("people.card.qrLabel", displayName)}
    shape-rendering="crispEdges"
  >
    <rect x={-QUIET_ZONE_MODULES} y={-QUIET_ZONE_MODULES} width={matrix.width + 2 * QUIET_ZONE_MODULES} height={matrix.width + 2 * QUIET_ZONE_MODULES} fill="white" />
    {#each matrix.modules as enabled, index (index)}
      {#if enabled}
        <rect x={index % matrix.width} y={Math.floor(index / matrix.width)} width="1" height="1" fill="black" />
      {/if}
    {/each}
  </svg>
  <div class="flex min-w-0 flex-1 flex-col justify-center gap-3">
    <div class="grid gap-1">
      <span class="text-[0.733333rem] font-medium text-muted-foreground">{t("people.card.codeLabel")}</span>
      <code class="rounded-md border border-border px-3 py-2 font-mono text-[0.8rem] break-all text-foreground select-all">{code}</code>
    </div>
    <div class="flex flex-wrap gap-1.5">
      <button type="button" class="people-card-action control-unavailable" aria-disabled="true"><Copy size={13} />{t("people.card.copyCode")}</button>
      <button type="button" class="people-card-action control-unavailable" aria-disabled="true"><ImageDown size={13} />{t("people.card.saveImage")}</button>
    </div>
  </div>
</div>

<style>
  .people-card-action { display: inline-flex; height: 1.75rem; flex: 0 0 auto; align-items: center; justify-content: center; gap: 0.375rem; border: 1px solid var(--border); border-radius: 0.375rem; padding-inline: 0.625rem; color: var(--foreground); font-size: calc(0.8rem * var(--type-scale)); font-weight: 500; transition: background-color 120ms ease; }
  .people-card-action:hover { background: var(--accent); }
</style>
