<script lang="ts">
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import { onMount, type Component } from "svelte";
  import {
    readPairingStatus,
    type PairingStatus,
  } from "$lib/api/vault-handoff";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { mobileTopBarPanelGeometry } from "$lib/mobile-layout";
  import { cn } from "$lib/utils";
  import { getVaultOwnership } from "$lib/vault/ownership.svelte";

  interface HandoffPanelProps {
    platform: "desktop" | "android";
    presentation: "settings";
    initialStatus?: PairingStatus | null;
    onActivated?: () => void;
    onStatusChange?: (status: PairingStatus) => void;
  }

  let {
    platform,
    presentation,
    onOpened,
  }: {
    platform: "desktop" | "android";
    presentation: "desktop" | "mobile";
    onOpened?: () => void;
  } = $props();

  const { t } = getLocalization();
  const ownership = getVaultOwnership();
  let status = $state<PairingStatus | null>(null);
  let open = $state(false);
  let loading = $state(false);
  let loadError = $state<string | null>(null);
  let HandoffPanel = $state<Component<HandoffPanelProps> | null>(null);
  let triggerElement = $state<HTMLButtonElement | null>(null);
  let mobilePanelStyle = $state("");

  const stateLabel = $derived(
    status?.linked
      ? status.pendingTransfer
        ? t("vaultHandoff.transferPending")
        : status.canWrite
          ? t("vaultHandoff.thisDeviceOwns")
          : t("vaultHandoff.otherDeviceOwns")
      : t("vaultHandoff.notLinked"),
  );

  async function refreshStatus(): Promise<void> {
    try {
      status = await readPairingStatus();
      await ownership.refresh();
    } catch (error) {
      console.warn("Failed to read linked-device status:", error);
    }
  }

  async function loadPanel(): Promise<void> {
    if (HandoffPanel || loading) return;
    loading = true;
    loadError = null;
    try {
      const module = await import("./VaultHandoffPanel.svelte");
      HandoffPanel = module.default;
    } catch (error) {
      loadError = error instanceof Error ? error.message : t("vaultHandoff.unknownError");
      console.error("Failed to load linked-device controls:", error);
    } finally {
      loading = false;
    }
  }

  function rootPixelValue(property: string): number {
    const value = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue(property),
    );
    return Number.isFinite(value) ? Math.max(0, value) : 0;
  }

  function updateMobilePanelPosition(): void {
    if (presentation !== "mobile" || !triggerElement) return;
    const triggerRect = triggerElement.getBoundingClientRect();
    const visualViewport = window.visualViewport;
    const viewportOffsetLeft = visualViewport?.offsetLeft ?? 0;
    const viewportOffsetTop = visualViewport?.offsetTop ?? 0;
    const viewportWidth = visualViewport?.width ?? window.innerWidth;
    const viewportHeight = visualViewport?.height ?? window.innerHeight;
    const safeAreaLeft = rootPixelValue("--safe-area-left");
    const safeAreaRight = rootPixelValue("--safe-area-right");
    const safeAreaTop = rootPixelValue("--safe-area-top");
    const safeAreaBottom = rootPixelValue("--safe-area-bottom");
    const geometry = mobileTopBarPanelGeometry({
      anchorLeft: triggerRect.left,
      anchorWidth: triggerRect.width,
      anchorBottom: triggerRect.bottom,
      desiredWidth: 320,
      desiredHeight: viewportHeight,
      viewportLeft: viewportOffsetLeft + safeAreaLeft,
      viewportWidth: Math.max(0, viewportWidth - safeAreaLeft - safeAreaRight),
      viewportTop: viewportOffsetTop + safeAreaTop,
      viewportHeight: Math.max(0, viewportHeight - safeAreaTop - safeAreaBottom),
    });
    mobilePanelStyle = [
      `left:${Math.round(geometry.left)}px`,
      `top:${Math.round(geometry.top)}px`,
      `width:${Math.round(geometry.width)}px`,
      `max-height:${Math.round(geometry.height)}px`,
    ].join(";");
  }

  function openPanel(): void {
    onOpened?.();
    updateMobilePanelPosition();
    open = true;
    void refreshStatus();
    void loadPanel();
  }

  function closePanel(): void {
    open = false;
  }

  function handleStatusChange(next: PairingStatus): void {
    status = next;
    void ownership.refresh();
  }

  function handleActivated(): void {
    closePanel();
    void refreshStatus();
  }

  onMount(() => {
    void refreshStatus();
    const timer = window.setInterval(() => {
      if (!open) void refreshStatus();
    }, 5_000);
    const handleVisibility = (): void => {
      if (document.visibilityState === "visible") void refreshStatus();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  });

  $effect(() => {
    if (!open || presentation !== "mobile") return;
    updateMobilePanelPosition();
    const visualViewport = window.visualViewport;
    window.addEventListener("resize", updateMobilePanelPosition);
    visualViewport?.addEventListener("resize", updateMobilePanelPosition);
    visualViewport?.addEventListener("scroll", updateMobilePanelPosition);
    return () => {
      window.removeEventListener("resize", updateMobilePanelPosition);
      visualViewport?.removeEventListener("resize", updateMobilePanelPosition);
      visualViewport?.removeEventListener("scroll", updateMobilePanelPosition);
    };
  });
</script>

<div class={cn("relative shrink-0", presentation === "mobile" && "h-full min-w-0")}>
  <button
    bind:this={triggerElement}
    type="button"
    data-linked-device-trigger
    class={cn(
      "group relative flex items-center justify-center text-muted-foreground transition-colors",
      presentation === "desktop"
        ? "size-8 rounded-lg hover:bg-sidebar-accent"
        : "h-full w-full min-w-0",
      open && (presentation === "desktop" ? "bg-sidebar-accent text-foreground" : "text-foreground"),
    )}
    title={`${t("vaultHandoff.heading")}\n${stateLabel}`}
    aria-label={t("vaultHandoff.heading")}
    aria-haspopup="dialog"
    aria-expanded={open}
    onclick={() => { if (open) closePanel(); else openPanel(); }}
  >
    <span class={cn(
      "grid place-items-center rounded-full transition-colors",
      presentation === "mobile" ? "h-8 w-8 group-active:bg-accent/70" : "size-full",
      open && presentation === "mobile" && "bg-accent/70",
    )}>
      <RefreshCw
        size={presentation === "desktop" ? 14 : 19}
        strokeWidth={presentation === "desktop" ? 1.5 : 1.8}
        class={cn(status?.pendingTransfer && "animate-spin", presentation === "desktop" && "text-foreground/68 dark:text-white/76")}
        aria-hidden="true"
      />
    </span>
    {#if status?.linked && status.canWrite === false && !status.pendingTransfer}
      <span
        class={cn(
          "absolute size-1.5 rounded-full bg-warning",
          presentation === "desktop" ? "bottom-1 right-1" : "bottom-2 right-[calc(50%-0.8rem)]",
        )}
        aria-hidden="true"
      ></span>
    {/if}
  </button>

  {#if open}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="fixed inset-0 z-40"
      onclick={closePanel}
      onkeydown={(event) => { if (event.key === "Escape") closePanel(); }}
    ></div>
    <div
      role="dialog"
      aria-label={t("vaultHandoff.heading")}
      class={cn(
        "z-50 overflow-y-auto rounded-lg border border-border bg-popover p-4 text-popover-foreground shadow-xl",
        presentation === "desktop"
          ? "absolute right-0 top-9 max-h-[calc(100vh-3rem)] w-80 max-w-[calc(100vw-1rem)]"
          : "fixed rounded-xl",
      )}
      style={presentation === "mobile" ? mobilePanelStyle : undefined}
    >
      {#if HandoffPanel}
        <HandoffPanel
          {platform}
          presentation="settings"
          initialStatus={status}
          onStatusChange={handleStatusChange}
          onActivated={handleActivated}
        />
      {:else if loadError}
        <div class="flex flex-col gap-3 text-sm" role="alert">
          <p class="wrap-break-word text-xs text-muted-foreground">{loadError}</p>
          <button
            type="button"
            class="min-h-9 rounded-md border border-border px-3 font-medium hover:bg-accent"
            onclick={() => void loadPanel()}
          >
            {t("vaultHandoff.retry")}
          </button>
        </div>
      {:else}
        <p class="p-4 text-center text-sm text-muted-foreground" aria-busy="true">
          {t("common.loading")}
        </p>
      {/if}
    </div>
  {/if}
</div>
