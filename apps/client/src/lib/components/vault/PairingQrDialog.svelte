<script lang="ts">
  import X from "@lucide/svelte/icons/x";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import Copy from "@lucide/svelte/icons/copy";
  import { onMount, tick } from "svelte";
  import type {
    DesktopNetworkAccess,
    PairingInvitation,
  } from "$lib/api/vault-handoff";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import {
    activateModalFocus,
    activateModalKeyboardLayer,
    trapModalTabKey,
  } from "$lib/modal-focus";
  import PairingQrCode from "./PairingQrCode.svelte";

  let {
    invitation,
    networkAccess,
    networkBusy,
    networkError,
    invitationError,
    onGrantNetworkAccess,
    onRefresh,
    onRetry,
    onClose,
  }: {
    invitation: PairingInvitation | null;
    networkAccess: DesktopNetworkAccess | null;
    networkBusy: boolean;
    networkError: string | null;
    invitationError: string | null;
    onGrantNetworkAccess: () => void;
    onRefresh: () => void;
    onRetry: () => void;
    onClose: () => void;
  } = $props();

  const { t } = getLocalization();
  let dialog = $state<HTMLDivElement | null>(null);
  let closeButton = $state<HTMLButtonElement | null>(null);
  let copied = $state(false);
  let copyFailed = $state(false);

  async function copyCode(): Promise<void> {
    if (!invitation) return;
    copyFailed = false;
    try {
      await navigator.clipboard.writeText(invitation.invitation);
      copied = true;
      window.setTimeout(() => { copied = false; }, 2_000);
    } catch {
      copyFailed = true;
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Tab" && dialog) {
      trapModalTabKey(dialog, event);
      event.stopPropagation();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    event.stopPropagation();
  }

  onMount(() => {
    const deactivateKeyboard = activateModalKeyboardLayer(handleKeydown);
    let deactivateFocus = (): void => undefined;
    void tick().then(() => {
      if (dialog) deactivateFocus = activateModalFocus(dialog, closeButton);
    });
    return () => {
      deactivateKeyboard();
      deactivateFocus();
    };
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="fixed inset-0 z-90 flex items-center justify-center p-4" onclick={onClose}>
  <div class="absolute inset-0 bg-black/50"></div>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    bind:this={dialog}
    class="relative z-10 flex max-h-full w-full max-w-md flex-col overflow-y-auto rounded-md border border-black/20 bg-card px-5 py-5 text-card-foreground shadow-2xl outline-none dark:border-white/10 dark:bg-sidebar dark:text-sidebar-foreground sm:px-8"
    role="dialog"
    aria-modal="true"
    aria-labelledby="pairing-qr-title"
    tabindex="-1"
    onclick={(event) => event.stopPropagation()}
    onkeydown={handleKeydown}
  >
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <h2 id="pairing-qr-title" class="text-base font-semibold text-foreground">
          {t("vaultHandoff.qrDialogTitle")}
        </h2>
        <p class="mt-1 text-[0.866667rem] leading-5 text-muted-foreground">
          {t("vaultHandoff.qrInstructions")}
        </p>
      </div>
      <button
        bind:this={closeButton}
        type="button"
        class="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label={t("common.close")}
        onclick={onClose}
      >
        <X size={16} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>

    <div class="mt-5">
      {#if invitation}
        <PairingQrCode {invitation} onExpired={onRefresh} />
      {:else}
        <div class="grid justify-items-center gap-3" role="status" aria-label={t("common.loading")}>
          <div class="grid aspect-square w-full max-w-80 place-items-center bg-white">
            {#if invitationError}
              <div class="flex max-w-56 flex-col items-center gap-3 px-4 text-center">
                <p class="text-[0.8rem] leading-5 text-destructive">{invitationError}</p>
                <button
                  type="button"
                  class="inline-flex min-h-9 items-center justify-center rounded-md border border-border bg-background px-3 text-[0.8rem] font-medium text-foreground hover:bg-accent"
                  onclick={onRetry}
                >
                  {t("common.retry")}
                </button>
              </div>
            {:else}
              <LoaderCircle size={28} strokeWidth={1.8} class="animate-spin text-black/45" aria-hidden="true" />
            {/if}
          </div>
          <div class="h-5" aria-hidden="true"></div>
        </div>
      {/if}
    </div>

    <div class="mx-auto mt-3 min-h-9">
      {#if invitation}
        <button
          type="button"
          class="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md border border-border px-3 text-[0.8rem] font-medium hover:bg-accent"
          onclick={() => void copyCode()}
        >
          <Copy size={14} strokeWidth={1.8} aria-hidden="true" />
          {copied ? t("vaultHandoff.codeCopied") : t("vaultHandoff.copyCode")}
        </button>
      {/if}
    </div>
    {#if copyFailed}
      <p role="alert" class="mt-2 text-center text-[0.8rem] text-destructive">
        {t("vaultHandoff.copyCodeFailed")}
      </p>
    {/if}

    {#if networkAccess?.state === "authorizationRequired"}
      <div class="mt-4 space-y-2 text-center">
        <p class="text-[0.8rem] leading-5 text-muted-foreground">
          {t("vaultHandoff.networkAccessDescription")}
        </p>
        <button
          type="button"
          class="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-[0.8rem] font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-55"
          disabled={networkBusy}
          onclick={onGrantNetworkAccess}
        >
          {#if networkBusy}<LoaderCircle size={14} class="animate-spin" />{/if}
          {t("vaultHandoff.allowNetworkAccess")}
        </button>
      </div>
    {:else if networkAccess?.state === "manualActionRequired"}
      <p role="alert" class="mt-4 text-center text-[0.8rem] leading-5 text-destructive">
        {t("vaultHandoff.networkAccessManual")}
      </p>
    {/if}
    {#if networkError}
      <p role="alert" class="mt-3 text-center text-[0.8rem] leading-5 text-destructive">
        {networkError}
      </p>
    {/if}
  </div>
</div>
