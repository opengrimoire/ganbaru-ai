<script lang="ts">
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import Download from "@lucide/svelte/icons/download";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import Monitor from "@lucide/svelte/icons/monitor";
  import ScanLine from "@lucide/svelte/icons/scan-line";
  import Smartphone from "@lucide/svelte/icons/smartphone";
  import { onMount, untrack } from "svelte";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";
  import {
    cancelDesktopBundleReceive,
    createPairingInvitation,
    grantDesktopNetworkAccess,
    enrollWithDesktop,
    readPairingStatus,
    receiveDesktopBundle,
    recoverLocalVaultCopy,
    requestAndroidBundle,
    revokeDesktopNetworkAccess,
    unlinkVaultDevice,
    type PairingInvitation,
    type PairingStatus,
    type DesktopNetworkAccess,
  } from "$lib/api/vault-handoff";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import ToggleSetting from "$lib/components/settings/ToggleSetting.svelte";
  import { formatHandoffError } from "$lib/vault/handoff-workflow";
  import MobilePairingScanner from "./MobilePairingScanner.svelte";

  type BusyAction = "status" | "invite" | "network" | "pair" | "ownership" | "refresh" | "unlink" | "recover";

  let {
    platform,
    presentation = "settings",
    initialInvitation = null,
    initialStatus = null,
    onActivated,
    onStatusChange,
  }: {
    platform: "desktop" | "android";
    presentation?: "settings" | "onboarding" | "control";
    initialInvitation?: PairingInvitation | null;
    initialStatus?: PairingStatus | null;
    onActivated?: () => void;
    onStatusChange?: (status: PairingStatus) => void;
  } = $props();

  const { t } = getLocalization();
  const desktopQrAvailable = __GANBARU_AI_BUILD_PLATFORM__ !== "android";
  let status = $state<PairingStatus | null>(untrack(() => initialStatus));
  let invitation = $state<PairingInvitation | null>(untrack(() => initialInvitation));
  let scanning = $state(false);
  let scannerVersion = $state(0);
  let busy = $state<BusyAction | null>(untrack(() => initialStatus ? null : "status"));
  let notice = $state<string | null>(null);
  let error = $state<string | null>(null);
  let networkError = $state<string | null>(null);
  let confirmation = $state<"network" | "networkRevoke" | "unlink" | "recover" | null>(null);
  let networkAccess = $state<DesktopNetworkAccess | null>(
    untrack(() => initialInvitation?.networkAccess ?? initialStatus?.networkAccess ?? null),
  );
  let networkStepsVisible = $state(
    untrack(() => {
      const state = initialInvitation?.networkAccess?.state ?? initialStatus?.networkAccess?.state;
      return state === "authorizationRequired" || state === "manualActionRequired";
    }),
  );

  const buttonClass =
    "inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md border border-border px-3 text-[0.8rem] font-medium transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-55";
  const primaryButtonClass = `${buttonClass} border-primary bg-primary text-primary-foreground hover:bg-primary/90`;
  const controlButtonClass = $derived(
    `flex min-w-0 w-full items-center justify-between gap-4 overflow-hidden px-3 text-left text-sm transition-colors ${platform === "android" ? "min-h-12 active:bg-accent" : "py-1.5 hover:bg-accent"} disabled:cursor-not-allowed disabled:text-muted-foreground/50`,
  );
  const desktopNetworkAccessSetting = $derived(
    presentation === "settings"
      && platform === "desktop"
      && __GANBARU_AI_BUILD_PLATFORM__ === "linux"
      && networkAccess !== null,
  );
  const networkAccessEnabled = $derived(
    !desktopNetworkAccessSetting
      || networkAccess?.state === "granted"
      || networkAccess?.state === "notRequired",
  );
  const networkAccessDescription = $derived(
    networkAccess?.state === "notRequired"
      ? t("vaultHandoff.networkAccessNotRequired")
      : networkAccess?.state === "manualActionRequired"
        ? t("vaultHandoff.networkAccessManual")
        : t("vaultHandoff.networkAccessAllowed"),
  );

  function fail(cause: unknown): void {
    error = formatHandoffError(cause, t);
  }

  function applyNetworkAccess(next: DesktopNetworkAccess): void {
    networkAccess = next;
    if (next.state === "authorizationRequired" || next.state === "manualActionRequired") {
      networkStepsVisible = true;
    }
  }

  async function loadStatus(): Promise<PairingStatus> {
    const next = await readPairingStatus();
    status = next;
    if (next.networkAccess) applyNetworkAccess(next.networkAccess);
    onStatusChange?.(next);
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
      if (invitation.networkAccess) applyNetworkAccess(invitation.networkAccess);
    } catch (cause) {
      fail(cause);
    } finally {
      busy = null;
    }
  }

  async function updateNetworkAccess(grant: boolean): Promise<void> {
    busy = "network";
    error = null;
    networkError = null;
    notice = null;
    try {
      applyNetworkAccess(
        grant
          ? await grantDesktopNetworkAccess()
          : await revokeDesktopNetworkAccess(),
      );
      notice = grant ? null : t("vaultHandoff.networkAccessRevoked");
    } catch (cause) {
      networkError = formatHandoffError(cause, t);
    } finally {
      busy = null;
    }
  }

  async function grantNetworkAccess(): Promise<void> {
    confirmation = null;
    await updateNetworkAccess(true);
  }

  async function revokeNetworkAccess(): Promise<void> {
    confirmation = null;
    await updateNetworkAccess(false);
  }

  function setNetworkAccess(enabled: boolean): void {
    if (enabled) confirmation = "network";
    else confirmation = "networkRevoke";
  }

  async function acceptInvitation(encoded: string): Promise<void> {
    busy = "pair";
    error = null;
    notice = null;
    try {
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
    const prepareOnboarding = (): void => {
      if (presentation !== "onboarding" || status?.linked) return;
      if (platform === "desktop") {
        if (!invitation) void showInvitation();
      } else {
        scanning = true;
      }
    };
    if (status) {
      onStatusChange?.(status);
      prepareOnboarding();
    } else {
      void refreshStatus().then(prepareOnboarding);
    }
    const timer = window.setInterval(() => {
      if (busy) return;
      void loadStatus().then((next) => {
        if (next.linked) invitation = null;
      }).catch(() => undefined);
    }, 3_000);
    return () => window.clearInterval(timer);
  });
</script>

{#snippet onboardingLoader()}
  <div
    class="grid min-h-56 place-items-center"
    role="status"
    aria-label={t("common.loading")}
  >
    <LoaderCircle size={24} strokeWidth={1.8} class="animate-spin text-muted-foreground" />
  </div>
{/snippet}

<section class={presentation === "control" ? "" : "flex flex-col gap-4"}>
  {#if presentation === "settings"}
    <h2 class="px-1 text-[0.866667rem] font-semibold text-foreground">{t("vaultHandoff.heading")}</h2>
    {#if desktopNetworkAccessSetting}
      <ToggleSetting
        label={t("vaultHandoff.networkAccessHeading")}
        description={networkAccessDescription}
        checked={networkAccessEnabled}
        disabled={busy !== null || networkAccess?.state === "notRequired" || networkAccess?.state === "manualActionRequired"}
        onChange={setNetworkAccess}
      />
    {/if}
  {/if}

  {#if busy === "status"}
    {#if presentation === "onboarding"}
      {@render onboardingLoader()}
    {:else}
      <div class="flex items-center gap-2 px-1 text-[0.8rem] text-muted-foreground">
        <LoaderCircle size={14} strokeWidth={2} class="animate-spin" aria-hidden="true" />
        {t("settings.data.loadingFolder")}
      </div>
    {/if}
  {:else if status}
    <fieldset
      disabled={presentation === "settings" && !networkAccessEnabled}
      class={presentation === "settings"
        ? `m-0 flex min-w-0 flex-col gap-3 border-0 p-0 ${networkAccessEnabled ? "" : "opacity-50"}`
        : "contents"}
    >
    {#if presentation === "settings"}
      <div class="px-1 py-1">
        <div class="text-[0.866667rem] text-foreground">{t("vaultHandoff.devicesHeading")}</div>
        <div class="mt-0.5 text-[0.8rem] text-muted-foreground">{t("vaultHandoff.description")}</div>
      </div>
    {/if}
    {#if presentation !== "onboarding" || status.linked}
    <div class={presentation === "control"
      ? `flex w-full items-center gap-2 px-3 ${platform === "android" ? "min-h-12" : "py-1.5"}`
      : "flex items-start gap-2 px-1 py-1"}>
      {#if platform === "android"}
        <Monitor size={presentation === "control" ? 14 : 17} strokeWidth={1.8} class={presentation === "control" ? "shrink-0 opacity-70" : "mt-0.5 shrink-0"} aria-hidden="true" />
      {:else}
        <Smartphone size={presentation === "control" ? 14 : 17} strokeWidth={1.8} class={presentation === "control" ? "shrink-0 opacity-70" : "mt-0.5 shrink-0"} aria-hidden="true" />
      {/if}
      <div class="flex min-w-0 flex-1 items-baseline gap-1 overflow-hidden whitespace-nowrap">
        <div class={presentation === "control" ? "min-w-0 truncate text-sm text-foreground" : "min-w-0 truncate text-[0.866667rem] font-medium text-foreground"}>
          {status.linked
            ? status.peerLabel ?? (platform === "android"
                ? t("vaultHandoff.desktopDevice")
                : t("vaultHandoff.androidDevice"))
            : t("vaultHandoff.notLinked")}
        </div>
        {#if presentation !== "onboarding" && status.linked}
          <span class={presentation === "control" ? "shrink-0 text-sm text-foreground" : "shrink-0 text-[0.866667rem] font-medium text-foreground"}>{t("vaultHandoff.linkedLabel")}</span>
        {/if}
      </div>
      {#if presentation === "settings" && status.linked}
        <button
          type="button"
          class={buttonClass}
          disabled={busy !== null || status.pendingTransfer}
          onclick={() => { confirmation = "unlink"; }}
        >
          {t("vaultHandoff.unlink")}
        </button>
      {/if}
    </div>
    {/if}

    {#if !status.linked && platform === "desktop" && presentation === "settings"}
      <button type="button" class={primaryButtonClass} disabled={busy !== null} onclick={() => void showInvitation()}>
        {#if busy === "invite"}<LoaderCircle size={14} class="animate-spin" />{/if}
        {t("vaultHandoff.createQr")}
      </button>
    {:else if !status.linked && platform === "desktop" && presentation === "onboarding" && !invitation}
      {#if error}
        <button type="button" class={buttonClass} disabled={busy !== null} onclick={() => void showInvitation()}>
          {t("vaultHandoff.retry")}
        </button>
      {:else}
        {@render onboardingLoader()}
      {/if}
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

    {#if desktopQrAvailable && platform === "desktop" && invitation && presentation === "onboarding"}
      <div class={networkStepsVisible
        ? "grid items-start gap-7 min-[800px]:grid-cols-2 min-[800px]:gap-10"
        : "flex flex-col items-center gap-4"}>
        {#if networkStepsVisible}
          <div class="flex flex-col items-center gap-3 px-1 text-center">
            <div class="space-y-1">
              <p class="text-base font-semibold text-foreground">
                {t("vaultHandoff.stepOne")}
              </p>
              <p class="mx-auto max-w-88 text-sm leading-6 text-muted-foreground">
                {t("vaultHandoff.networkAccessDescription")}
              </p>
            </div>
            {#if networkAccess?.state === "authorizationRequired"}
              <button
                type="button"
                class={`${buttonClass} bg-background`}
                disabled={busy !== null}
                onclick={() => { confirmation = "network"; }}
              >
                {#if busy === "network"}<LoaderCircle size={14} class="animate-spin" />{/if}
                {t("vaultHandoff.allowNetworkAccess")}
              </button>
            {:else if networkAccess?.state === "granted" || networkAccess?.state === "notRequired"}
              <p class="text-[0.8rem] leading-5 text-muted-foreground">
                {t("vaultHandoff.networkAccessGranted")}
              </p>
            {:else if networkAccess?.state === "manualActionRequired"}
              <p role="alert" class="text-[0.8rem] leading-5 text-destructive">
                {t("vaultHandoff.networkAccessManual")}
              </p>
            {/if}
            {#if networkError}
              <p role="alert" class="w-full max-w-88 text-[0.8rem] leading-5 text-destructive">
                {networkError}
              </p>
            {/if}
          </div>
        {/if}

        <div class="flex min-w-0 flex-col items-center gap-4">
          <div class="space-y-1 px-1 text-center">
            {#if networkStepsVisible}
              <p class="text-base font-semibold text-foreground">
                {t("vaultHandoff.stepTwo")}
              </p>
            {/if}
            <p class="mx-auto max-w-sm text-sm leading-6 text-muted-foreground">
              {t("vaultHandoff.desktopOnboardingDescription")}
            </p>
          </div>
          {#await import("./PairingQrCode.svelte") then module}
            {@const PairingQrCode = module.default}
            <PairingQrCode {invitation} onExpired={() => void showInvitation()} />
          {/await}
        </div>
      </div>
    {/if}

    {#if status.linked}
      {#if presentation === "control" || !status.canWrite || (platform === "android" && (busy === "ownership" || busy === "refresh"))}
      <div class={presentation === "control"
        ? "flex flex-col"
        : "flex flex-wrap gap-2"}>
        {#if presentation === "control"}<div class="mx-3 my-1.5 h-px bg-border"></div>{/if}
        {#if presentation === "control" || !status.canWrite}
          <button
            type="button"
            class={presentation === "control" ? controlButtonClass : primaryButtonClass}
            disabled={presentation === "control" && busy === "ownership"
              ? platform !== "android"
              : busy !== null || status.pendingTransfer || status.canWrite !== false}
            onclick={() => {
              if (presentation === "control" && busy === "ownership" && platform === "android") void cancelReceive();
              else void (platform === "android" ? receive("ownership") : requestFromAndroid("ownership"));
            }}
          >
            {#if presentation === "control"}
              <span class="min-w-0 truncate">{busy === "ownership" && platform === "android" ? t("vaultHandoff.cancel") : t("vaultHandoff.useHere")}</span>
              {#if busy === "ownership"}
                <LoaderCircle size={14} strokeWidth={1.8} class="shrink-0 animate-spin opacity-70" aria-hidden="true" />
              {:else}
                <ArrowRight size={14} strokeWidth={1.8} class="shrink-0 opacity-70" aria-hidden="true" />
              {/if}
            {:else}
              {#if busy === "ownership"}<LoaderCircle size={14} class="animate-spin" />{/if}
              {t("vaultHandoff.useHere")}
            {/if}
          </button>
          {#if presentation === "control" || (status.replicaReady && presentation !== "onboarding")}
            <button
              type="button"
              class={presentation === "control" ? controlButtonClass : buttonClass}
              disabled={presentation === "control" && busy === "refresh"
                ? platform !== "android"
                : busy !== null || status.pendingTransfer || status.canWrite !== false || !status.replicaReady}
              onclick={() => {
                if (presentation === "control" && busy === "refresh" && platform === "android") void cancelReceive();
                else void (platform === "android" ? receive("refresh") : requestFromAndroid("refresh"));
              }}
            >
              {#if presentation === "control"}
                <span class="min-w-0 truncate">{busy === "refresh" && platform === "android" ? t("vaultHandoff.cancel") : t("vaultHandoff.refreshCopy")}</span>
                {#if busy === "refresh"}
                  <LoaderCircle size={14} strokeWidth={1.8} class="shrink-0 animate-spin opacity-70" aria-hidden="true" />
                {:else}
                  <Download size={14} strokeWidth={1.8} class="shrink-0 opacity-70" aria-hidden="true" />
                {/if}
              {:else}
                {#if busy === "refresh"}<LoaderCircle size={14} class="animate-spin" />{/if}
                {t("vaultHandoff.refreshCopy")}
              {/if}
            </button>
          {/if}
        {/if}
        {#if presentation !== "control" && platform === "android" && (busy === "ownership" || busy === "refresh")}
          <button type="button" class={buttonClass} onclick={() => void cancelReceive()}>
            {t("vaultHandoff.cancel")}
          </button>
        {/if}
        {#if presentation === "settings"}
          {#if !status.canWrite && status.replicaReady && !status.pendingTransfer}
            <button type="button" class={buttonClass} disabled={busy !== null} onclick={() => { confirmation = "recover"; }}>
              {t("vaultHandoff.recover")}
            </button>
          {/if}
        {/if}
      </div>
      {/if}
      {#if presentation === "settings"}
        {#if platform === "android" && !status.replicaReady}
          <p class="px-1 text-[0.8rem] leading-5 text-muted-foreground">{t("vaultHandoff.localBackup")}</p>
        {/if}
      {/if}
    {/if}

    </fieldset>
  {:else if error && presentation !== "onboarding"}
    <button type="button" class={buttonClass} disabled={busy !== null} onclick={() => void refreshStatus()}>
      {t("vaultHandoff.retry")}
    </button>
  {/if}

  {#if presentation !== "control" && (busy === "pair" || busy === "ownership" || busy === "refresh")}
    <p role="status" class="flex items-center gap-2 px-1 text-[0.8rem] text-muted-foreground">
      <LoaderCircle size={14} strokeWidth={2} class="animate-spin" aria-hidden="true" />
      {busy === "pair"
        ? t("vaultHandoff.workingPairing")
        : busy === "ownership"
          ? t("vaultHandoff.workingOwnership")
          : t("vaultHandoff.workingRefresh")}
    </p>
  {/if}
  {#if notice && presentation !== "control"}<p role="status" class="px-1 text-[0.8rem] leading-5 text-muted-foreground">{notice}</p>{/if}
  {#if error}<p role="alert" class="px-1 text-[0.8rem] leading-5 text-destructive">{error}</p>{/if}
</section>

{#if desktopQrAvailable && platform === "desktop" && invitation && presentation === "settings"}
  {#await import("./PairingQrDialog.svelte") then module}
    {@const PairingQrDialog = module.default}
    <PairingQrDialog
      {invitation}
      {networkAccess}
      networkBusy={busy === "network"}
      {networkError}
      onGrantNetworkAccess={() => { confirmation = "network"; }}
      onRefresh={() => void showInvitation()}
      onClose={() => { invitation = null; }}
    />
  {/await}
{/if}

{#if confirmation === "network"}
  <ConfirmDialog
    title={t("vaultHandoff.networkAccessConfirmTitle")}
    message={t("vaultHandoff.networkAccessConfirmMessage")}
    confirmLabel={t("vaultHandoff.allowNetworkAccess")}
    cancelLabel={t("common.cancel")}
    danger={false}
    onConfirm={() => void grantNetworkAccess()}
    onCancel={() => { confirmation = null; }}
  />
{:else if confirmation === "networkRevoke"}
  <ConfirmDialog
    title={t("vaultHandoff.networkAccessRevokeTitle")}
    message={t("vaultHandoff.networkAccessRevokeMessage")}
    confirmLabel={t("vaultHandoff.networkAccessRevokeAction")}
    cancelLabel={t("common.cancel")}
    danger={false}
    onConfirm={() => void revokeNetworkAccess()}
    onCancel={() => { confirmation = null; }}
  />
{:else if confirmation === "unlink"}
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
