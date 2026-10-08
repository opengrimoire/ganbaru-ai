<script lang="ts">
  import { onMount } from "svelte";
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import Copy from "@lucide/svelte/icons/copy";
  import Eye from "@lucide/svelte/icons/eye";
  import EyeOff from "@lucide/svelte/icons/eye-off";
  import ImageDown from "@lucide/svelte/icons/image-down";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import { type PeopleErrorCode, saveCardImage } from "$lib/api/people";
  import type { PairingQrMatrix } from "$lib/api/vault-handoff";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { BUILD_PLATFORM_PROFILE, platformHasCapability } from "$lib/platform";
  import { getPeople } from "$lib/stores/people.svelte";
  import { getPreferences } from "$lib/stores/preferences.svelte";
  import { cn } from "$lib/utils";
  import { writeTextToClipboard } from "$lib/utils/clipboard";
  import { contactCardPlaceholderCode, placeholderCardMatrix } from "./model";

  /**
   * The local user's contact card, laid out like a settings row: the pasteable code, its actions, and the QR code
   * on the trailing side. Until a press reveals them, both show a blurred placeholder derived from a fixed seed, so
   * an accidental screen share or stream leaks nothing even if the blur is undone. Opening the tab signs a fresh
   * card so the network hint inside it is current.
   */
  const QUIET_ZONE_MODULES = 2;
  const ACTION_ICON_SIZE = 13;
  const IMAGE_MODULE_PIXELS = 8;
  const IMAGE_QUIET_ZONE_MODULES = 4;
  const IMAGE_FILE_NAME = "contact-card.png";
  const STATUS_TIMEOUT_MS = 3_000;
  const { t } = getLocalization();
  const preferences = getPreferences();
  const people = getPeople();
  const canSaveImage = platformHasCapability(BUILD_PLATFORM_PROFILE, "storage.native-file-picker");
  const displayName = $derived(preferences.profileDisplayName || t("people.you"));
  const placeholderCode = contactCardPlaceholderCode();
  const placeholderMatrix = placeholderCardMatrix();

  let revealed = $state(false);
  let busy = $state(false);
  let status = $state<{ message: string; error: boolean } | null>(null);
  let statusTimer: ReturnType<typeof setTimeout> | null = null;

  const card = $derived(people.card);
  const ready = $derived(revealed && card !== null);
  const code = $derived(ready && card ? card.text : placeholderCode);
  const matrix = $derived<PairingQrMatrix>(ready && card ? card.qr : placeholderMatrix);
  const viewBox = $derived(`${-QUIET_ZONE_MODULES} ${-QUIET_ZONE_MODULES} ${matrix.width + 2 * QUIET_ZONE_MODULES} ${matrix.width + 2 * QUIET_ZONE_MODULES}`);
  const actionsAvailable = $derived(card !== null && !busy);
  /** Why the card is missing or limited; `blocking` marks reasons that keep the card from existing at all. */
  const detail = $derived.by<{ message: string; blocking: boolean } | null>(() => {
    if (people.cardError) return { message: describeCardError(people.cardError.code), blocking: true };
    if (people.identity && !people.identity.privateKeyAvailable) return { message: t("people.card.keyPending"), blocking: true };
    if (card && card.endpointHint === "") return { message: t("people.card.unreachable"), blocking: false };
    return null;
  });

  const actionsBlocked = $derived(card === null && (detail?.blocking ?? false));
  /** Bumped to replay the flash on the blocking reason, which re-creates the line so the animation restarts. */
  let detailFlash = $state(0);

  /**
   * Hides a shown card, or shows it once it exists. While the card cannot exist, the toggle keeps its state and
   * flashes the reason instead, after one fresh load in case the profile changed since the tab opened.
   */
  async function toggleReveal(): Promise<void> {
    if (revealed) {
      revealed = false;
      return;
    }
    if (card === null && !people.cardLoading) await people.loadCard().catch(() => undefined);
    if (people.card !== null) {
      revealed = true;
      return;
    }
    if (detail?.blocking) detailFlash += 1;
  }

  function describeCardError(code: PeopleErrorCode): string {
    switch (code) {
      case "profile_incomplete":
        return t("people.card.profileIncomplete");
      case "key_unavailable":
        return t("people.card.keyPending");
      case "identity_unavailable":
      case "read_only":
        return t("people.card.readOnly");
      default:
        return t("people.card.loadFailed");
    }
  }

  function showStatus(message: string, error = false): void {
    if (statusTimer) clearTimeout(statusTimer);
    status = { message, error };
    statusTimer = setTimeout(() => {
      status = null;
      statusTimer = null;
    }, STATUS_TIMEOUT_MS);
  }

  async function copyCode(): Promise<void> {
    if (!card) return;
    try {
      await writeTextToClipboard(card.text);
      showStatus(t("people.card.copied"));
    } catch {
      showStatus(t("people.card.copyFailed"), true);
    }
  }

  /** Paints the QR modules on a canvas and hands the PNG bytes to the native save dialog. */
  async function saveImage(): Promise<void> {
    if (!card || !canSaveImage) return;
    busy = true;
    try {
      const pngBase64 = renderQrPng(card.qr);
      await saveCardImage(t("people.card.saveImageTitle"), IMAGE_FILE_NAME, pngBase64);
    } catch {
      showStatus(t("people.card.saveFailed"), true);
    } finally {
      busy = false;
    }
  }

  function renderQrPng(qr: PairingQrMatrix): string {
    const side = (qr.width + 2 * IMAGE_QUIET_ZONE_MODULES) * IMAGE_MODULE_PIXELS;
    const canvas = document.createElement("canvas");
    canvas.width = side;
    canvas.height = side;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, side, side);
    context.fillStyle = "#000000";
    qr.modules.forEach((enabled, index) => {
      if (!enabled) return;
      const x = (index % qr.width + IMAGE_QUIET_ZONE_MODULES) * IMAGE_MODULE_PIXELS;
      const y = (Math.floor(index / qr.width) + IMAGE_QUIET_ZONE_MODULES) * IMAGE_MODULE_PIXELS;
      context.fillRect(x, y, IMAGE_MODULE_PIXELS, IMAGE_MODULE_PIXELS);
    });
    const dataUrl = canvas.toDataURL("image/png");
    const separator = dataUrl.indexOf(",");
    if (separator < 0) throw new Error("PNG encoding failed");
    return dataUrl.slice(separator + 1);
  }

  async function regenerate(): Promise<void> {
    if (!card) return;
    busy = true;
    try {
      await people.regenerateCard();
      showStatus(t("people.card.regenerated"));
    } catch {
      // The card error line explains the failure.
    } finally {
      busy = false;
    }
  }

  onMount(() => {
    void people.loadCard().catch(() => undefined);
    return () => {
      if (statusTimer) clearTimeout(statusTimer);
    };
  });
</script>

{#snippet revealOverlay()}
  {#if !revealed}
    <button type="button" class="absolute inset-0 cursor-pointer rounded-md" aria-label={t("people.card.reveal")} onclick={toggleReveal}></button>
  {/if}
{/snippet}

<div class="flex items-start gap-5 max-[480px]:flex-col max-[480px]:items-stretch">
  <div class="flex min-w-0 flex-1 flex-col gap-3">
    <div class="min-w-0">
      <div class="flex items-center gap-1">
        <span class="text-[0.866667rem] text-foreground">{t("people.card.codeLabel")}</span>
        <button type="button" class="people-card-toggle" aria-pressed={revealed} aria-label={revealed ? t("people.card.hide") : t("people.card.reveal")} onclick={toggleReveal}>
          {#if revealed}<EyeOff size={ACTION_ICON_SIZE} />{:else}<Eye size={ACTION_ICON_SIZE} />{/if}
        </button>
      </div>
      <div class="mt-0.5 text-[0.8rem] text-muted-foreground">{t("people.card.codeDescription")}</div>
    </div>
    <div class="relative">
      <code class={cn("block rounded-md border border-border px-3 py-2 font-mono text-[0.8rem] break-all text-foreground", ready ? "select-all" : "select-none")} aria-hidden={!ready}>
        <span class={cn("inline-block", !ready && "blur-[2px]")}>{code}</span>
      </code>
      {@render revealOverlay()}
    </div>
    {#if detail?.blocking}
      {#key detailFlash}
        <p class={cn("people-card-blocker", detailFlash > 0 && "people-card-blocker-flash")} role="status"><span class="flex h-lh shrink-0 items-center text-status-tentative"><CircleAlert size={ACTION_ICON_SIZE} /></span>{detail.message}</p>
      {/key}
    {:else if detail}
      <p class="text-[0.8rem] text-muted-foreground">{detail.message}</p>
    {/if}
    <div class="flex flex-wrap items-center gap-1.5">
      <button type="button" class={cn("people-card-action", actionsBlocked && "people-card-action-blocked")} aria-disabled={!actionsAvailable || undefined} onclick={() => { if (actionsAvailable) void copyCode(); }}><Copy size={ACTION_ICON_SIZE} />{t("people.card.copyCode")}</button>
      <button type="button" class={cn("people-card-action", actionsBlocked && "people-card-action-blocked", !canSaveImage && "control-unavailable")} aria-disabled={!actionsAvailable || !canSaveImage || undefined} onclick={() => { if (actionsAvailable && canSaveImage) void saveImage(); }}><ImageDown size={ACTION_ICON_SIZE} />{t("people.card.saveImage")}</button>
      <button type="button" class={cn("people-card-action", actionsBlocked && "people-card-action-blocked")} aria-disabled={!actionsAvailable || undefined} onclick={() => { if (actionsAvailable) void regenerate(); }}><RefreshCw size={ACTION_ICON_SIZE} />{t("people.card.regenerateAction")}</button>
      <span class={cn("text-[0.8rem]", status?.error ? "text-destructive" : "text-muted-foreground")} aria-live="polite">{status?.message ?? ""}</span>
    </div>
  </div>
  <div class="relative shrink-0 overflow-hidden rounded-md max-[480px]:self-center">
    <svg
      {viewBox}
      class={cn("aspect-square w-40 bg-white max-[480px]:w-full max-[480px]:max-w-56", !ready && "blur-xs")}
      role="img"
      aria-label={t("people.card.qrLabel", displayName)}
      aria-hidden={!ready}
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
  .people-card-action:hover:not([aria-disabled="true"]) { background: var(--accent); }
  .people-card-action[aria-disabled="true"] { cursor: not-allowed; }
  .people-card-action-blocked { color: var(--muted-foreground); opacity: 0.5; }
  .people-card-blocker { position: relative; isolation: isolate; display: flex; align-items: flex-start; gap: 0.375rem; margin-inline: -0.375rem; border-radius: 0.375rem; padding: 0.125rem 0.375rem; color: var(--foreground); font-size: calc(0.8rem * var(--type-scale)); }
  .people-card-blocker-flash::before { position: absolute; inset: 0; z-index: -1; border-radius: inherit; background: var(--selection-background); opacity: 0; pointer-events: none; content: ""; animation: people-card-blocker-flash 720ms ease-in-out; }
  @keyframes people-card-blocker-flash {
    0%, 50%, 100% { opacity: 0; }
    25%, 75% { opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    .people-card-blocker-flash::before { animation-duration: 1ms; }
  }
  .people-card-toggle { display: grid; width: 1.25rem; height: 1.25rem; flex: 0 0 auto; place-items: center; border-radius: var(--floating-item-radius); color: var(--muted-foreground); }
  .people-card-toggle:hover { background: var(--accent); color: var(--foreground); }
</style>
