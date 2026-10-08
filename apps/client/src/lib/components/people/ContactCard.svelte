<script lang="ts">
  import Copy from "@lucide/svelte/icons/copy";
  import Eye from "@lucide/svelte/icons/eye";
  import EyeOff from "@lucide/svelte/icons/eye-off";
  import ImageDown from "@lucide/svelte/icons/image-down";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { getPreferences } from "$lib/stores/preferences.svelte";
  import { activeVaultIdentity } from "$lib/vault/active-vault";
  import { cn } from "$lib/utils";
  import { CONTACT_CARD_PLACEHOLDER_SEED, contactCardCode, contactCardMatrix, contactCardPlaceholderCode } from "./model";

  /**
   * The local user's contact card, laid out like a settings row: the pasteable code, its actions, and the QR code
   * on the trailing side. Until a press reveals them, both show a blurred placeholder derived from a fixed seed, so
   * an accidental screen share or stream leaks nothing even if the blur is undone.
   */
  const QUIET_ZONE_MODULES = 2;
  const ACTION_ICON_SIZE = 13;
  const { t } = getLocalization();
  const preferences = getPreferences();
  const displayName = $derived(preferences.profileDisplayName || t("people.you"));
  const seed = $derived(activeVaultIdentity() ?? displayName);

  let revealed = $state(false);

  const code = $derived(revealed ? contactCardCode(seed) : contactCardPlaceholderCode());
  const matrix = $derived(contactCardMatrix(revealed ? seed : CONTACT_CARD_PLACEHOLDER_SEED));
  const viewBox = $derived(`${-QUIET_ZONE_MODULES} ${-QUIET_ZONE_MODULES} ${matrix.width + 2 * QUIET_ZONE_MODULES} ${matrix.width + 2 * QUIET_ZONE_MODULES}`);
</script>

{#snippet revealOverlay()}
  {#if !revealed}
    <button type="button" class="absolute inset-0 cursor-pointer rounded-md" aria-label={t("people.card.reveal")} onclick={() => { revealed = true; }}></button>
  {/if}
{/snippet}

<div class="flex items-start gap-5 max-[480px]:flex-col max-[480px]:items-stretch">
  <div class="flex min-w-0 flex-1 flex-col gap-3">
    <div class="min-w-0">
      <div class="flex items-center gap-1">
        <span class="text-[0.866667rem] text-foreground">{t("people.card.codeLabel")}</span>
        <button type="button" class="people-card-toggle" aria-pressed={revealed} aria-label={revealed ? t("people.card.hide") : t("people.card.reveal")} onclick={() => { revealed = !revealed; }}>
          {#if revealed}<EyeOff size={ACTION_ICON_SIZE} />{:else}<Eye size={ACTION_ICON_SIZE} />{/if}
        </button>
      </div>
      <div class="mt-0.5 text-[0.8rem] text-muted-foreground">{t("people.card.codeDescription")}</div>
    </div>
    <div class="relative">
      <code class={cn("block rounded-md border border-border px-3 py-2 font-mono text-[0.8rem] break-all text-foreground", revealed ? "select-all" : "select-none")} aria-hidden={!revealed}>
        <span class={cn("inline-block", !revealed && "blur-[2px]")}>{code}</span>
      </code>
      {@render revealOverlay()}
    </div>
    <div class="flex flex-wrap gap-1.5">
      <button type="button" class="people-card-action control-unavailable" aria-disabled="true"><Copy size={ACTION_ICON_SIZE} />{t("people.card.copyCode")}</button>
      <button type="button" class="people-card-action control-unavailable" aria-disabled="true"><ImageDown size={ACTION_ICON_SIZE} />{t("people.card.saveImage")}</button>
      <button type="button" class="people-card-action control-unavailable" aria-disabled="true"><RefreshCw size={ACTION_ICON_SIZE} />{t("people.card.regenerateAction")}</button>
    </div>
  </div>
  <div class="relative shrink-0 overflow-hidden rounded-md max-[480px]:self-center">
    <svg
      {viewBox}
      class={cn("aspect-square w-40 bg-white max-[480px]:w-full max-[480px]:max-w-56", !revealed && "blur-xs")}
      role="img"
      aria-label={t("people.card.qrLabel", displayName)}
      aria-hidden={!revealed}
      shape-rendering="crispEdges"
    >
      <rect x={-QUIET_ZONE_MODULES} y={-QUIET_ZONE_MODULES} width={matrix.width + 2 * QUIET_ZONE_MODULES} height={matrix.width + 2 * QUIET_ZONE_MODULES} fill="white" />
      {#each matrix.modules as enabled, index (index)}
        {#if enabled}
          <rect x={index % matrix.width} y={Math.floor(index / matrix.width)} width="1" height="1" fill="black" />
        {/if}
      {/each}
    </svg>
    {@render revealOverlay()}
  </div>
</div>

<style>
  .people-card-action { display: inline-flex; height: 1.75rem; flex: 0 0 auto; align-items: center; justify-content: center; gap: 0.375rem; border: 1px solid var(--border); border-radius: 0.375rem; padding-inline: 0.625rem; color: var(--foreground); font-size: calc(0.8rem * var(--type-scale)); font-weight: 500; transition: background-color 120ms ease; }
  .people-card-action:hover { background: var(--accent); }
  .people-card-toggle { display: grid; width: 1.25rem; height: 1.25rem; flex: 0 0 auto; place-items: center; border-radius: var(--floating-item-radius); color: var(--muted-foreground); }
  .people-card-toggle:hover { background: var(--accent); color: var(--foreground); }
</style>
