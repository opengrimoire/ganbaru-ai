<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { appSessionStartedAt } from "$lib/stores/app-session";
  import { getDoomscrollingExtensionConnection } from "$lib/stores/doomscrolling-extension-status.svelte";
  import { cn } from "$lib/utils";

  const EXTENSION_STARTUP_GRACE_MS = 45_000;
  const EXTENSION_STARTUP_PENDING_REASONS = new Set([
    "connection is from an older app session",
    "no extension connection has been recorded",
  ]);

  const extensionConnection = getDoomscrollingExtensionConnection();
  const { t } = getLocalization();

  const extensionStatus = $derived(extensionConnection.status);
  const extensionStatusLoading = $derived(extensionConnection.loading);
  const extensionStatusError = $derived(extensionConnection.error);
  const extensionStatusConnected = $derived(extensionStatus?.connected === true);
  const extensionStatusWaitingForFirstConnection = $derived.by(() => {
    if (!extensionStatus || extensionStatus.connected) return false;
    if (!extensionStatus.reason || !EXTENSION_STARTUP_PENDING_REASONS.has(extensionStatus.reason)) {
      return false;
    }
    const sessionStartedAtMs = Date.parse(appSessionStartedAt);
    const checkedAtMs = Date.parse(extensionStatus.checkedAt);
    if (!Number.isFinite(sessionStartedAtMs) || !Number.isFinite(checkedAtMs)) return false;
    return checkedAtMs - sessionStartedAtMs <= EXTENSION_STARTUP_GRACE_MS;
  });
  const extensionStatusShowInstallAction = $derived(
    extensionStatus !== null
      && !extensionStatus.connected
      && !extensionStatusWaitingForFirstConnection,
  );

  function extensionStatusTitle(): string {
    if (extensionStatusError && !extensionStatus) return t("settings.doomscrolling.extension.unavailable");
    if (extensionStatusLoading && !extensionStatus) return t("settings.doomscrolling.extension.checking");
    if (extensionStatusWaitingForFirstConnection) return t("settings.doomscrolling.extension.waiting");
    return extensionStatusConnected
      ? t("settings.doomscrolling.extension.connected")
      : t("settings.doomscrolling.extension.notConnected");
  }

  async function openExtensionInstallDocs(): Promise<void> {
    try {
      await invoke("doomscrolling_open_extension_install_docs");
    } catch (err) {
      console.warn("Failed to open extension install docs:", err);
    }
  }

  onMount(() => {
    return extensionConnection.start();
  });
</script>

<div
  class={cn(
    "flex min-h-9 flex-wrap items-center justify-between gap-2 rounded-md border bg-background/60 px-3 py-1.5 transition-colors dark:bg-transparent",
    (extensionStatusLoading && !extensionStatus) || extensionStatusWaitingForFirstConnection
      ? "border-border text-muted-foreground"
      : extensionStatusConnected
        ? "border-border text-foreground"
        : "border-destructive/35 bg-destructive/5 text-destructive",
  )}
  aria-live="polite"
>
  <div class="flex min-w-0 items-center gap-2.5">
    <span
      class="flex h-5 w-5 shrink-0 items-center justify-center"
      aria-hidden="true"
    >
      {#if (extensionStatusLoading && !extensionStatus) || extensionStatusWaitingForFirstConnection}
        <LoaderCircle size={14} strokeWidth={2.25} class="animate-spin" />
      {:else if extensionStatusConnected}
        <CircleCheck size={14} strokeWidth={2.25} />
      {:else}
        <CircleAlert size={14} strokeWidth={2.25} />
      {/if}
    </span>
    <div class="min-w-0 truncate text-[0.866667rem] font-medium">
      {extensionStatusTitle()}
    </div>
  </div>
  {#if extensionStatusShowInstallAction}
    <button
      type="button"
      onclick={openExtensionInstallDocs}
      class="flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-[0.8rem] font-medium text-foreground transition-colors hover:bg-accent dark:bg-transparent"
    >
      <span>{t("settings.doomscrolling.extension.install")}</span>
      <ExternalLink size={12} strokeWidth={2.25} />
    </button>
  {/if}
</div>
