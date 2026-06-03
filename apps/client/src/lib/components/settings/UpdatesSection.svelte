<script lang="ts">
  import Download from "@lucide/svelte/icons/download";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import ToggleSetting from "./ToggleSetting.svelte";
  import { BUILD_REF } from "$lib/buildInfo";
  import { getUpdateManager } from "$lib/stores/updates.svelte";
  import { cn } from "$lib/utils";

  const updates = getUpdateManager();

  const buttonClass =
    "inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border px-3 text-[0.866667rem] font-medium transition-colors disabled:pointer-events-none disabled:opacity-55";
  const primaryButtonClass = `${buttonClass} bg-primary text-primary-foreground hover:bg-primary/90`;
  const secondaryButtonClass = `${buttonClass} bg-card text-foreground hover:bg-accent`;
</script>

<div class="flex flex-col gap-6">
  <section class="flex flex-col gap-4">
    <div class="px-1">
      <h2 class="text-[0.866667rem] font-semibold text-foreground">Updates</h2>
    </div>

    <ToggleSetting
      label="Update notifications"
      description="Check once a day and show a prompt when a new version is available"
      checked={updates.autoNotifications}
      onChange={(checked) => updates.setAutoNotifications(checked)}
    />

    <div class="flex flex-col gap-3 rounded-md border border-border bg-card/75 p-4">
      <div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div class="min-w-0">
          <p class="text-[0.8rem] font-medium uppercase text-muted-foreground">Installed build</p>
          <p class="mt-1 wrap-break-word text-[0.933333rem] font-medium text-foreground">{BUILD_REF}</p>
          {#if updates.currentVersion}
            <p class="mt-1 text-[0.8rem] text-muted-foreground">
              Current release version: {updates.currentVersion}
            </p>
          {/if}
          {#if updates.lastAutoCheckAt}
            <p class="mt-1 text-[0.8rem] text-muted-foreground">
              Last automatic check: {new Date(updates.lastAutoCheckAt).toLocaleString()}
            </p>
          {/if}
        </div>

        <button
          type="button"
          class={secondaryButtonClass}
          disabled={updates.status === "checking" || updates.status === "downloading" || updates.status === "installed"}
          onclick={() => {
            void updates.checkForUpdates();
          }}
        >
          <RefreshCw
            size={15}
            strokeWidth={1.9}
            class={cn("shrink-0", updates.status === "checking" ? "animate-spin" : "")}
          />
          <span>Check for updates</span>
        </button>
      </div>

      <div
        class={cn(
          "rounded-md border px-3 py-2 text-[0.866667rem]",
          updates.status === "error"
            ? "border-destructive/45 bg-destructive/10 text-destructive"
            : updates.status === "available"
              ? "border-action-confirm/45 bg-action-confirm/10 text-foreground"
            : "border-border bg-background/60 text-muted-foreground",
        )}
      >
        {updates.statusCopy}
      </div>

      {#if updates.status === "downloading"}
        <div class="h-2 overflow-hidden rounded-full bg-muted">
          <div
            class="h-full rounded-full bg-primary transition-[width]"
            style={`width: ${updates.progressPercent ?? 18}%;`}
          ></div>
        </div>
        <p class="text-[0.8rem] text-muted-foreground">
          {#if updates.contentLength}
            {updates.formatBytes(updates.downloadedBytes)} of {updates.formatBytes(updates.contentLength)}
          {:else}
            {updates.formatBytes(updates.downloadedBytes)} downloaded
          {/if}
        </p>
      {/if}

      {#if updates.status === "available"}
        <div class="flex flex-col gap-3">
          {#if updates.releaseNotes}
            <div class="max-h-28 overflow-y-auto whitespace-pre-line wrap-break-word rounded-md border border-border bg-background/60 px-3 py-2 text-[0.8rem] leading-5 text-muted-foreground">
              {updates.releaseNotes}
            </div>
          {/if}
          <button
            type="button"
            class={primaryButtonClass}
            onclick={() => {
              void updates.installUpdate();
            }}
          >
            <Download size={15} strokeWidth={1.9} class="shrink-0" />
            <span>Download and install</span>
          </button>
        </div>
      {/if}

      {#if updates.status === "installed"}
        <div class="flex items-center gap-2 text-[0.8rem] text-muted-foreground">
          <RotateCcw size={14} strokeWidth={1.8} class="shrink-0" />
          <span>Ganbaru AI will restart after the installer finishes.</span>
        </div>
      {/if}
    </div>
  </section>
</div>
