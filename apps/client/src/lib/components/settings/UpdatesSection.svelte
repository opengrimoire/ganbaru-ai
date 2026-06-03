<script lang="ts">
  import Download from "@lucide/svelte/icons/download";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import ToggleSetting from "./ToggleSetting.svelte";
  import { BUILD_REF } from "$lib/buildInfo";
  import { getUpdateManager } from "$lib/stores/updates.svelte";
  import { cn } from "$lib/utils";

  const updates = getUpdateManager();

  const actionButtonClass =
    "inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md border border-border px-2.5 text-[0.8rem] font-medium transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-55";
  const primaryButtonClass = `${actionButtonClass} border-primary bg-primary text-primary-foreground hover:bg-primary/90`;
  const secondaryButtonClass = `${actionButtonClass} bg-card text-foreground hover:bg-accent dark:bg-transparent`;
</script>

<div class="flex flex-col gap-6">
  <section class="flex flex-col gap-4">
    <h2 class="px-1 text-[0.866667rem] font-semibold text-foreground">Notifications</h2>

    <ToggleSetting
      label="Update notifications"
      description="Check once a day and show a prompt when a new version is available"
      checked={updates.autoNotifications}
      onChange={(checked) => updates.setAutoNotifications(checked)}
    />
  </section>

  <div class="h-px bg-border/70" aria-hidden="true"></div>

  <section class="flex flex-col gap-4">
    <h2 class="px-1 text-[0.866667rem] font-semibold text-foreground">Build</h2>

    <div class="flex flex-col gap-3">
      <div class="flex items-start justify-between gap-4 px-1 py-1 max-[480px]:flex-col max-[480px]:items-stretch max-[480px]:gap-2">
        <div class="min-w-0 flex-1">
          <div class="text-[0.866667rem] text-foreground">Installed build</div>
          <div class="mt-0.5 wrap-break-word text-[0.8rem] leading-5 text-muted-foreground">
            {BUILD_REF}
          </div>
          {#if updates.currentVersion}
            <div class="mt-1 text-[0.8rem] leading-5 text-muted-foreground">
              Current release version: {updates.currentVersion}
            </div>
          {/if}
          {#if updates.lastAutoCheckAt}
            <div class="mt-1 text-[0.8rem] leading-5 text-muted-foreground">
              Last automatic check: {new Date(updates.lastAutoCheckAt).toLocaleString()}
            </div>
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

      <div class="px-1 py-1">
        <div class="text-[0.866667rem] text-foreground">Update status</div>
        <div
          class={cn(
            "mt-0.5 text-[0.8rem] leading-5",
            updates.status === "error"
              ? "text-destructive"
              : updates.status === "available"
                ? "text-foreground"
              : "text-muted-foreground",
          )}
        >
          {updates.statusCopy}
        </div>

        {#if updates.status === "downloading"}
          <div class="mt-2 h-2 overflow-hidden rounded-full bg-muted">
            <div
              class="h-full rounded-full bg-primary transition-[width]"
              style={`width: ${updates.progressPercent ?? 18}%;`}
            ></div>
          </div>
          <div class="mt-1 text-[0.8rem] leading-5 text-muted-foreground">
            {#if updates.contentLength}
              {updates.formatBytes(updates.downloadedBytes)} of {updates.formatBytes(updates.contentLength)}
            {:else}
              {updates.formatBytes(updates.downloadedBytes)} downloaded
            {/if}
          </div>
        {/if}

        {#if updates.status === "installed"}
          <div class="mt-2 flex items-center gap-2 text-[0.8rem] leading-5 text-muted-foreground">
            <RotateCcw size={14} strokeWidth={1.8} class="shrink-0" />
            <span>Ganbaru AI will restart after the installer finishes.</span>
          </div>
        {/if}
      </div>
    </div>
  </section>

  {#if updates.status === "available"}
    <div class="h-px bg-border/70" aria-hidden="true"></div>

    <section class="flex flex-col gap-4">
      <h2 class="px-1 text-[0.866667rem] font-semibold text-foreground">Available update</h2>

      <div class="flex flex-col gap-3">
        <div class="flex items-start justify-between gap-4 px-1 py-1 max-[480px]:flex-col max-[480px]:items-stretch max-[480px]:gap-2">
          <div class="min-w-0 flex-1">
            <div class="text-[0.866667rem] text-foreground">
              Version {updates.latestVersion ?? "unknown"}
            </div>
            <div class="mt-0.5 text-[0.8rem] leading-5 text-muted-foreground">
              Download and install the available Ganbaru AI update.
            </div>
          </div>
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

        {#if updates.releaseNotes}
          <div class="px-1 py-1">
            <div class="text-[0.866667rem] text-foreground">Release notes</div>
            <div class="mt-1 max-h-28 overflow-y-auto whitespace-pre-line wrap-break-word rounded-md border border-border bg-background/60 px-3 py-2 text-[0.8rem] leading-5 text-muted-foreground">
              {updates.releaseNotes}
            </div>
          </div>
        {/if}
      </div>
    </section>
  {/if}
</div>
