<script lang="ts">
  import { onDestroy } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
  import Download from "@lucide/svelte/icons/download";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import { BUILD_REF } from "$lib/buildInfo";
  import { cn } from "$lib/utils";

  type UpdateStatus =
    | "idle"
    | "checking"
    | "current"
    | "available"
    | "downloading"
    | "installed"
    | "error";

  let status = $state<UpdateStatus>("idle");
  let pendingUpdate = $state<Update | null>(null);
  let currentVersion = $state<string | null>(null);
  let latestVersion = $state<string | null>(null);
  let releaseNotes = $state<string | null>(null);
  let errorMessage = $state<string | null>(null);
  let downloadedBytes = $state(0);
  let contentLength = $state<number | null>(null);

  const progressPercent = $derived(
    contentLength && contentLength > 0
      ? Math.min(100, Math.round((downloadedBytes / contentLength) * 100))
      : null,
  );

  const statusCopy = $derived.by(() => {
    switch (status) {
      case "checking":
        return "Checking the configured release feed";
      case "current":
        return "Ganbaru AI is up to date";
      case "available":
        return `Version ${latestVersion ?? "unknown"} is available`;
      case "downloading":
        return progressPercent === null
          ? `Downloading ${formatBytes(downloadedBytes)}`
          : `Downloading ${progressPercent}%`;
      case "installed":
        return "Update installed. Restarting Ganbaru AI";
      case "error":
        return errorMessage ?? "Update check failed";
      default:
        return "No update check has run in this window";
    }
  });

  const buttonClass =
    "inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border px-3 text-[0.866667rem] font-medium transition-colors disabled:pointer-events-none disabled:opacity-55";
  const primaryButtonClass = `${buttonClass} bg-primary text-primary-foreground hover:bg-primary/90`;
  const secondaryButtonClass = `${buttonClass} bg-card text-foreground hover:bg-accent`;

  function closePendingUpdate(update: Update | null): void {
    if (!update) return;
    void update.close().catch((error: unknown) => {
      console.error("Failed to close pending update resource:", error);
    });
  }

  function resetUpdateState(): void {
    closePendingUpdate(pendingUpdate);
    pendingUpdate = null;
    latestVersion = null;
    releaseNotes = null;
    errorMessage = null;
    downloadedBytes = 0;
    contentLength = null;
  }

  function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"] as const;
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }
    const digits = unitIndex === 0 || value >= 10 ? 0 : 1;
    return `${value.toFixed(digits)} ${units[unitIndex]}`;
  }

  function errorText(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    return String(error);
  }

  function updateCheckErrorMessage(error: unknown): string {
    const message = errorText(error);
    if (/endpoint|pubkey|public key|configured|configuration/i.test(message)) {
      return "This build does not have a release update feed configured";
    }
    return message;
  }

  function handleDownloadEvent(event: DownloadEvent): void {
    switch (event.event) {
      case "Started":
        contentLength = event.data.contentLength ?? null;
        downloadedBytes = 0;
        break;
      case "Progress":
        downloadedBytes += event.data.chunkLength;
        break;
      case "Finished":
        if (contentLength === null) contentLength = downloadedBytes;
        break;
    }
  }

  async function checkForUpdates(): Promise<void> {
    if (status === "checking" || status === "downloading" || status === "installed") return;
    resetUpdateState();
    status = "checking";

    try {
      const update = await check({ timeout: 30_000 });
      if (!update) {
        status = "current";
        return;
      }

      pendingUpdate = update;
      currentVersion = update.currentVersion;
      latestVersion = update.version;
      releaseNotes = update.body ?? null;
      status = "available";
    } catch (error: unknown) {
      status = "error";
      errorMessage = updateCheckErrorMessage(error);
    }
  }

  async function installUpdate(): Promise<void> {
    if (!pendingUpdate || status !== "available") return;
    status = "downloading";
    errorMessage = null;
    downloadedBytes = 0;
    contentLength = null;

    try {
      await pendingUpdate.downloadAndInstall(handleDownloadEvent, { timeout: 120_000 });
      status = "installed";
      await invoke("restart_app");
    } catch (error: unknown) {
      status = "error";
      errorMessage = errorText(error);
    }
  }

  onDestroy(() => {
    closePendingUpdate(pendingUpdate);
  });
</script>

<div class="flex flex-col gap-6">
  <section class="flex flex-col gap-4">
    <div class="flex flex-col gap-1 px-1">
      <h2 class="text-[0.866667rem] font-semibold text-foreground">Updates</h2>
      <p class="max-w-176 text-[0.8rem] leading-5 text-muted-foreground">
        Update checks contact the configured GitHub Releases feed only when requested.
      </p>
    </div>

    <div class="flex flex-col gap-3 rounded-md border border-border bg-card/75 p-4">
      <div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div class="min-w-0">
          <p class="text-[0.8rem] font-medium uppercase text-muted-foreground">Installed build</p>
          <p class="mt-1 wrap-break-word text-[0.933333rem] font-medium text-foreground">{BUILD_REF}</p>
          {#if currentVersion}
            <p class="mt-1 text-[0.8rem] text-muted-foreground">
              Current release version: {currentVersion}
            </p>
          {/if}
        </div>

        <button
          type="button"
          class={secondaryButtonClass}
          disabled={status === "checking" || status === "downloading" || status === "installed"}
          onclick={() => {
            void checkForUpdates();
          }}
        >
          <RefreshCw
            size={15}
            strokeWidth={1.9}
            class={cn("shrink-0", status === "checking" ? "animate-spin" : "")}
          />
          <span>Check for updates</span>
        </button>
      </div>

      <div
        class={cn(
          "rounded-md border px-3 py-2 text-[0.866667rem]",
          status === "error"
            ? "border-destructive/45 bg-destructive/10 text-destructive"
            : status === "available"
              ? "border-action-confirm/45 bg-action-confirm/10 text-foreground"
            : "border-border bg-background/60 text-muted-foreground",
        )}
      >
        {statusCopy}
      </div>

      {#if status === "downloading"}
        <div class="h-2 overflow-hidden rounded-full bg-muted">
          <div
            class="h-full rounded-full bg-primary transition-[width]"
            style={`width: ${progressPercent ?? 18}%;`}
          ></div>
        </div>
        <p class="text-[0.8rem] text-muted-foreground">
          {#if contentLength}
            {formatBytes(downloadedBytes)} of {formatBytes(contentLength)}
          {:else}
            {formatBytes(downloadedBytes)} downloaded
          {/if}
        </p>
      {/if}

      {#if status === "available"}
        <div class="flex flex-col gap-3">
          {#if releaseNotes}
            <div class="max-h-28 overflow-y-auto whitespace-pre-line wrap-break-word rounded-md border border-border bg-background/60 px-3 py-2 text-[0.8rem] leading-5 text-muted-foreground">
              {releaseNotes}
            </div>
          {/if}
          <button
            type="button"
            class={primaryButtonClass}
            onclick={() => {
              void installUpdate();
            }}
          >
            <Download size={15} strokeWidth={1.9} class="shrink-0" />
            <span>Download and install</span>
          </button>
        </div>
      {/if}

      {#if status === "installed"}
        <div class="flex items-center gap-2 text-[0.8rem] text-muted-foreground">
          <RotateCcw size={14} strokeWidth={1.8} class="shrink-0" />
          <span>Ganbaru AI will restart after the installer finishes.</span>
        </div>
      {/if}
    </div>
  </section>
</div>
