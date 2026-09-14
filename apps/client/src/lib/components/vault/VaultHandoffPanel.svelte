<script lang="ts">
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import ScanLine from "@lucide/svelte/icons/scan-line";
  import Smartphone from "@lucide/svelte/icons/smartphone";
  import { onMount } from "svelte";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";
  import {
    cancelDesktopBundleReceive,
    createPairingInvitation,
    enrollWithDesktop,
    readPairingStatus,
    receiveDesktopBundle,
    recoverLocalVaultCopy,
    requestAndroidBundle,
    unlinkVaultDevice,
    type PairingInvitation,
    type PairingStatus,
  } from "$lib/api/vault-handoff";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { formatHandoffError } from "$lib/vault/handoff-workflow";
  import MobilePairingScanner from "./MobilePairingScanner.svelte";

  type BusyAction = "status" | "invite" | "pair" | "ownership" | "refresh" | "unlink" | "recover";

  let {
    platform,
    onActivated,
    beforeEnroll,
  }: {
    platform: "desktop" | "android";
    onActivated?: () => void;
    beforeEnroll?: () => void | Promise<void>;
  } = $props();

  const { t } = getLocalization();
  let status = $state<PairingStatus | null>(null);
  let invitation = $state<PairingInvitation | null>(null);
  let scanning = $state(false);
  let scannerVersion = $state(0);
  let busy = $state<BusyAction | null>("status");
  let notice = $state<string | null>(null);
  let error = $state<string | null>(null);
  let confirmation = $state<"unlink" | "recover" | null>(null);

  const buttonClass =
    "inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md border border-border px-3 text-[0.8rem] font-medium transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-55";
  const primaryButtonClass = `${buttonClass} border-primary bg-primary text-primary-foreground hover:bg-primary/90`;

  function fail(cause: unknown): void {
    error = formatHandoffError(cause, t);
  }

  async function loadStatus(): Promise<PairingStatus> {
    const next = await readPairingStatus();
    status = next;
    return next;
  }

  async function refreshStatus(): Promise<void> {
    busy = "status";
    error = null;
    try {
      await loadStatus();
    } catch (cause) {
      fail(cause);
    } finally {
      busy = null;
    }
  }

  async function showInvitation(): Promise<void> {
    busy = "invite";
    error = null;
    notice = null;
    try {
      invitation = await createPairingInvitation();
    } catch (cause) {
      fail(cause);
    } finally {
      busy = null;
    }
  }

  async function acceptInvitation(encoded: string): Promise<void> {
    busy = "pair";
    error = null;
    notice = null;
    try {
      await beforeEnroll?.();
      await enrollWithDesktop(encoded, t("vaultHandoff.deviceLabel"));
      scanning = false;
      await loadStatus();
      notice = t("vaultHandoff.linked");
    } catch (cause) {
      fail(cause);
      scannerVersion += 1;
      scanning = true;
    } finally {
      busy = null;
    }
  }

  async function receive(mode: "ownership" | "refresh"): Promise<void> {
    busy = mode;
    error = null;
    notice = null;
    try {
      const outcome = await receiveDesktopBundle(mode);
      if (outcome.inProgress) {
        notice = t("vaultHandoff.requestSent");
        return;
      }
      await loadStatus();
      notice = mode === "ownership" ? t("vaultHandoff.linked") : t("vaultHandoff.refreshed");
      if (outcome.activated) onActivated?.();
    } catch (cause) {
      fail(cause);
    } finally {
      busy = null;
    }
  }

  async function waitForDesktopResult(mode: "ownership" | "refresh"): Promise<void> {
    let sawPending = false;
    for (let attempt = 0; attempt < 90; attempt += 1) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 1_000));
      const next = await loadStatus();
      sawPending ||= next.pendingTransfer;
      if (mode === "ownership" && next.canWrite) return;
      if (mode === "refresh" && sawPending && !next.pendingTransfer) return;
    }
    throw new Error("coordinator request timed out");
  }

  async function requestFromAndroid(mode: "ownership" | "refresh"): Promise<void> {
    busy = mode;
    error = null;
    notice = t("vaultHandoff.requestSent");
    try {
      await requestAndroidBundle(mode);
      await waitForDesktopResult(mode);
      notice = mode === "ownership" ? t("vaultHandoff.linked") : t("vaultHandoff.refreshed");
      onActivated?.();
    } catch (cause) {
      fail(cause);
    } finally {
      busy = null;
    }
  }

  async function unlink(): Promise<void> {
    confirmation = null;
    busy = "unlink";
    error = null;
    try {
      await unlinkVaultDevice();
      await loadStatus();
      invitation = null;
      notice = t("vaultHandoff.unlinked");
    } catch (cause) {
      fail(cause);
    } finally {
      busy = null;
    }
  }

  async function recover(): Promise<void> {
    confirmation = null;
    busy = "recover";
    error = null;
    try {
      await recoverLocalVaultCopy();
      await loadStatus();
      notice = t("vaultHandoff.recovered");
      onActivated?.();
    } catch (cause) {
      fail(cause);
    } finally {
      busy = null;
    }
  }

  async function cancelReceive(): Promise<void> {
    try {
      await cancelDesktopBundleReceive();
    } catch (cause) {
      fail(cause);
    }
  }

  onMount(() => {
    void refreshStatus();
    const timer = window.setInterval(() => {
      if (busy) return;
      void loadStatus().then((next) => {
        if (next.linked) invitation = null;
      }).catch(() => undefined);
    }, 3_000);
    return () => window.clearInterval(timer);
  });
</script>

<section class="flex flex-col gap-4">
  <div class="px-1">
    <h2 class="text-[0.866667rem] font-semibold text-foreground">{t("vaultHandoff.heading")}</h2>
    <p class="mt-1 text-[0.8rem] leading-5 text-muted-foreground">{t("vaultHandoff.description")}</p>
  </div>

  {#if busy === "status"}
    <div class="flex items-center gap-2 px-1 text-[0.8rem] text-muted-foreground">
      <LoaderCircle size={14} strokeWidth={2} class="animate-spin" aria-hidden="true" />
      {t("settings.data.loadingFolder")}
    </div>
  {:else if status}
    <div class="rounded-md border border-border bg-card/40 p-3">
      <div class="flex items-start gap-2">
        <Smartphone size={17} strokeWidth={1.8} class="mt-0.5 shrink-0" aria-hidden="true" />
        <div class="min-w-0 flex-1">
          <div class="text-[0.866667rem] font-medium text-foreground">
            {status.linked
              ? t(
                  "vaultHandoff.linkedTo",
                  status.peerLabel ??
                    (platform === "android"
                      ? t("vaultHandoff.desktopDevice")
                      : t("vaultHandoff.androidDevice")),
                )
              : t("vaultHandoff.notLinked")}
          </div>
          {#if status.linked}
            <p class="mt-0.5 text-[0.8rem] leading-5 text-muted-foreground">
              {status.recoveryRequired
                ? t("vaultOwnership.recovery")
                : status.canWrite
                  ? t("vaultHandoff.thisDeviceOwns")
                  : t("vaultHandoff.otherDeviceOwns")}
              {#if status.pendingTransfer} {t("vaultHandoff.transferPending")}{/if}
            </p>
          {/if}
        </div>
        <button type="button" class={buttonClass} disabled={busy !== null} onclick={() => void refreshStatus()}>
          <RefreshCw size={13} strokeWidth={2} aria-hidden="true" />
          {t("vaultHandoff.retry")}
        </button>
      </div>
    </div>

    {#if !status.linked && platform === "desktop"}
      <button type="button" class={primaryButtonClass} disabled={busy !== null} onclick={() => void showInvitation()}>
        {#if busy === "invite"}<LoaderCircle size={14} class="animate-spin" />{/if}
        {t("vaultHandoff.createQr")}
      </button>
    {:else if !status.linked && platform === "android"}
      {#if scanning}
        {#key scannerVersion}
          <MobilePairingScanner
            disabled={busy !== null}
            onInvitation={acceptInvitation}
            onCancel={() => { scanning = false; }}
            onError={(cause) => { fail(cause); scanning = false; }}
          />
        {/key}
      {:else}
        <button type="button" class={primaryButtonClass} disabled={busy !== null} onclick={() => { scanning = true; error = null; }}>
          <ScanLine size={14} strokeWidth={2} aria-hidden="true" />
          {t("vaultHandoff.linkToDesktop")}
        </button>
      {/if}
    {/if}

    {#if !status.linked && status.canWrite === false}
      <button type="button" class={buttonClass} disabled={busy !== null} onclick={() => { confirmation = "recover"; }}>
        {t("vaultHandoff.recover")}
      </button>
    {/if}

    {#if platform === "desktop" && invitation}
      <div class="grid justify-items-center gap-3 rounded-md border border-border p-4">
        <svg
          viewBox={`0 0 ${invitation.qr.width} ${invitation.qr.width}`}
          class="aspect-square w-full max-w-56 bg-white p-2"
          role="img"
          aria-label={t("vaultHandoff.qrAlt")}
          shape-rendering="crispEdges"
        >
          <rect width={invitation.qr.width} height={invitation.qr.width} fill="white" />
          {#each invitation.qr.modules as enabled, index}
            {#if enabled}
              <rect x={index % invitation.qr.width} y={Math.floor(index / invitation.qr.width)} width="1" height="1" fill="black" />
            {/if}
          {/each}
        </svg>
        <p class="max-w-md text-center text-[0.8rem] leading-5 text-muted-foreground">
          {t("vaultHandoff.qrInstructions")}
        </p>
      </div>
    {/if}

    {#if status.linked}
      <div class="flex flex-wrap gap-2">
        {#if !status.canWrite}
          <button
            type="button"
            class={primaryButtonClass}
            disabled={busy !== null || status.pendingTransfer}
            onclick={() => void (platform === "android" ? receive("ownership") : requestFromAndroid("ownership"))}
          >
            {#if busy === "ownership"}<LoaderCircle size={14} class="animate-spin" />{/if}
            {t("vaultHandoff.useHere")}
          </button>
          {#if status.replicaReady}
            <button
              type="button"
              class={buttonClass}
              disabled={busy !== null || status.pendingTransfer}
              onclick={() => void (platform === "android" ? receive("refresh") : requestFromAndroid("refresh"))}
            >
              {#if busy === "refresh"}<LoaderCircle size={14} class="animate-spin" />{/if}
              {t("vaultHandoff.refreshCopy")}
            </button>
          {/if}
        {/if}
        {#if platform === "android" && (busy === "ownership" || busy === "refresh")}
          <button type="button" class={buttonClass} onclick={() => void cancelReceive()}>
            {t("vaultHandoff.cancel")}
          </button>
        {/if}
        <button type="button" class={buttonClass} disabled={busy !== null || status.pendingTransfer} onclick={() => { confirmation = "unlink"; }}>
          {t("vaultHandoff.unlink")}
        </button>
        {#if !status.canWrite && status.replicaReady && !status.pendingTransfer}
          <button type="button" class={buttonClass} disabled={busy !== null} onclick={() => { confirmation = "recover"; }}>
            {t("vaultHandoff.recover")}
          </button>
        {/if}
      </div>
      {#if platform === "android" && !status.replicaReady}
        <p class="px-1 text-[0.8rem] leading-5 text-muted-foreground">{t("vaultHandoff.localBackup")}</p>
      {/if}
      <p class="px-1 text-[0.8rem] leading-5 text-muted-foreground">{t("vaultHandoff.offlineNotice")}</p>
    {/if}
  {/if}

  {#if busy === "pair" || busy === "ownership" || busy === "refresh"}
    <p role="status" class="flex items-center gap-2 px-1 text-[0.8rem] text-muted-foreground">
      <LoaderCircle size={14} strokeWidth={2} class="animate-spin" aria-hidden="true" />
      {busy === "pair"
        ? t("vaultHandoff.workingPairing")
        : busy === "ownership"
          ? t("vaultHandoff.workingOwnership")
          : t("vaultHandoff.workingRefresh")}
    </p>
  {/if}
  {#if notice}<p role="status" class="px-1 text-[0.8rem] leading-5 text-muted-foreground">{notice}</p>{/if}
  {#if error}<p role="alert" class="px-1 text-[0.8rem] leading-5 text-destructive">{error}</p>{/if}
</section>

{#if confirmation === "unlink"}
  <ConfirmDialog
    title={t("vaultHandoff.unlinkTitle")}
    message={t("vaultHandoff.unlinkMessage")}
    confirmLabel={t("vaultHandoff.unlink")}
    cancelLabel={t("common.cancel")}
    onConfirm={() => void unlink()}
    onCancel={() => { confirmation = null; }}
  />
{:else if confirmation === "recover"}
  <ConfirmDialog
    title={t("vaultHandoff.recoverTitle")}
    message={t("vaultHandoff.recoverMessage")}
    confirmLabel={t("vaultHandoff.recover")}
    cancelLabel={t("common.cancel")}
    onConfirm={() => void recover()}
    onCancel={() => { confirmation = null; }}
  />
{/if}
