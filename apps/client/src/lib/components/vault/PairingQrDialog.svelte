<script lang="ts">
  import X from "@lucide/svelte/icons/x";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
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
    onGrantNetworkAccess,
    onRefresh,
    onClose,
  }: {
    invitation: PairingInvitation;
    networkAccess: DesktopNetworkAccess | null;
    networkBusy: boolean;
    networkError: string | null;
    onGrantNetworkAccess: () => void;
    onRefresh: () => void;
    onClose: () => void;
  } = $props();

  const { t } = getLocalization();
  let dialog = $state<HTMLDivElement | null>(null);
  let closeButton = $state<HTMLButtonElement | null>(null);

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
      <PairingQrCode {invitation} onExpired={onRefresh} />
    </div>

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
