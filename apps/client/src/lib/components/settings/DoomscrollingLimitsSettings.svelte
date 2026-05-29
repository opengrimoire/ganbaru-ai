<script lang="ts">
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Plus from "@lucide/svelte/icons/plus";
  import Power from "@lucide/svelte/icons/power";
  import PowerOff from "@lucide/svelte/icons/power-off";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";
  import {
    doomscrollingLimitEntryKey,
    type DoomscrollingLimitEntry,
    type DoomscrollingUsageLimit,
  } from "$lib/doomscrolling";
  import { getDoomscrolling } from "$lib/stores/doomscrolling.svelte";
  import { getDoomscrollingUsage } from "$lib/stores/doomscrolling-usage.svelte";
  import { cn } from "$lib/utils";
  import DoomscrollingBrowserConnectionStatus from "./DoomscrollingBrowserConnectionStatus.svelte";
  import ToggleSetting from "./ToggleSetting.svelte";
  import type { DoomscrollingLimitEditorTarget } from "./types";

  interface PendingLimitAction {
    type: "disable" | "delete" | "global-disable";
    limitId: string | null;
  }

  let {
    onOpenLimitEditor = () => {},
  }: {
    onOpenLimitEditor?: (target: DoomscrollingLimitEditorTarget) => void;
  } = $props();

  const doomscrolling = getDoomscrolling();
  const usage = getDoomscrollingUsage();

  let pendingAction = $state<PendingLimitAction | null>(null);

  const desktopAvailabilityMessage = $derived(
    usage.foregroundStatus.available
      ? null
      : usage.foregroundStatus.reason
        ?? "Desktop foreground tracking is unavailable. Desktop app limits will not count or close apps on this system.",
  );

  function formatMinutes(totalSeconds: number): string {
    const minutes = Math.floor(totalSeconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder > 0 ? `${hours}h ${remainder}m` : `${hours}h`;
  }

  function formatDailyLimit(minutes: number): string {
    return minutes < 60 ? `${minutes}m` : formatMinutes(minutes * 60);
  }

  function totalUsedSeconds(limitId: string): number {
    return usage.totalFor(limitId)?.usedSeconds ?? 0;
  }

  function progressPercent(limit: DoomscrollingUsageLimit): number {
    const used = totalUsedSeconds(limit.id);
    const total = limit.minutesPerDay * 60;
    return Math.min(100, Math.round((used / total) * 100));
  }

  function websiteDisplayName(host: string): string {
    const firstLabel = host.replace(/^www\./, "").split(".", 1)[0] ?? host;
    return `${firstLabel.charAt(0).toUpperCase()}${firstLabel.slice(1)}`;
  }

  function entryLabel(entry: DoomscrollingLimitEntry): string {
    return entry.name
      ?? entry.mobileAppName
      ?? entry.desktopAppName
      ?? (entry.websiteHost ? websiteDisplayName(entry.websiteHost) : "Linked source");
  }

  function entrySourceSummary(entry: DoomscrollingLimitEntry): string {
    const parts: string[] = [];
    if (entry.websiteHost) parts.push(`Website ${entry.websiteHost}`);
    if (entry.mobileAppName) parts.push(`Mobile ${entry.mobileAppName}`);
    if (entry.desktopAppName) parts.push(`Desktop ${entry.desktopAppName}`);
    return parts.join(" · ");
  }

  function requestLimitEnabledChange(limit: DoomscrollingUsageLimit, enabled: boolean): void {
    if (enabled) {
      doomscrolling.setUsageLimitEnabled(limit.id, true);
      void usage.refresh();
      return;
    }
    pendingAction = { type: "disable", limitId: limit.id };
  }

  function requestLimitDelete(limit: DoomscrollingUsageLimit): void {
    pendingAction = { type: "delete", limitId: limit.id };
  }

  function requestGlobalEnabledChange(enabled: boolean): void {
    if (enabled) {
      doomscrolling.setLimitsEnabled(true);
      void usage.refresh();
      return;
    }
    pendingAction = { type: "global-disable", limitId: null };
  }

  function confirmPendingAction(): void {
    if (!pendingAction) return;
    if (pendingAction.type === "global-disable") {
      doomscrolling.setLimitsEnabled(false);
    } else if (pendingAction.limitId) {
      if (pendingAction.type === "disable") {
        doomscrolling.setUsageLimitEnabled(pendingAction.limitId, false);
      } else {
        doomscrolling.removeUsageLimit(pendingAction.limitId);
      }
    }
    pendingAction = null;
    void usage.refresh();
  }

  function cancelPendingAction(): void {
    pendingAction = null;
  }

  function pendingTitle(action: PendingLimitAction): string {
    if (action.type === "global-disable") return "Turn off usage limits?";
    const limit = doomscrolling.usageLimits.find((item) => item.id === action.limitId);
    const name = limit?.name ?? "this limit";
    return action.type === "disable" ? `Disable ${name}?` : `Delete ${name}?`;
  }

  function pendingMessage(action: PendingLimitAction): string {
    if (action.type === "global-disable") {
      return "Daily usage limits will stop blocking websites and closing apps until you enable them again";
    }
    return action.type === "disable"
      ? "It will stay in the list but will not block when exhausted until you enable it again"
      : "This cannot be undone. Today's tracked usage will stay in history and can still roll up into matching limits.";
  }

  function pendingConfirmLabel(action: PendingLimitAction): string {
    if (action.type === "global-disable") return "Turn off (Enter)";
    return action.type === "disable" ? "Disable (Enter)" : "Delete (Enter)";
  }
</script>

{#snippet limitList()}
  <section class="flex flex-col gap-4">
    <div class="flex min-w-0 flex-wrap items-center justify-between gap-2 px-1">
      <div class="min-w-0">
        <h2 class="text-[0.866667rem] font-semibold text-foreground">Daily limits</h2>
        <div class="mt-0.5 text-[0.8rem] text-muted-foreground">
          Each limit can link one or many websites, mobile apps, and desktop apps
        </div>
      </div>
      <button
        type="button"
        onclick={() => onOpenLimitEditor({ mode: "create" })}
        class="flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-[0.8rem] font-medium text-foreground transition-colors hover:bg-accent dark:bg-transparent"
      >
        <Plus size={13} strokeWidth={2.25} />
        <span>Add limit</span>
      </button>
    </div>

    <div class="flex flex-col px-1">
      {#each doomscrolling.usageLimits as limit (limit.id)}
        {@const used = totalUsedSeconds(limit.id)}
        <article
          class="flex min-w-0 flex-col gap-2 border-b border-border/70 py-2"
          aria-label={limit.enabled ? limit.name : `${limit.name} disabled`}
        >
          <div class="flex min-w-0 flex-wrap items-start justify-between gap-2">
            <div class="min-w-0 flex-1">
              <h3 class={cn("truncate text-[0.866667rem] text-foreground", !limit.enabled && "opacity-50 line-through")}>
                {limit.name}
              </h3>
              <div class="mt-0.5 text-[0.8rem] text-muted-foreground">
                {formatMinutes(used)} used of {formatDailyLimit(limit.minutesPerDay)} today
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onclick={() => requestLimitEnabledChange(limit, !limit.enabled)}
                aria-label={limit.enabled ? `Disable ${limit.name}` : `Enable ${limit.name}`}
                data-app-tooltip-disabled="true"
                class="flex h-7 w-24 shrink-0 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-2 text-[0.8rem] text-foreground transition-colors hover:bg-accent dark:bg-transparent"
              >
                {#if limit.enabled}
                  <PowerOff size={13} strokeWidth={2} class="shrink-0" />
                  <span>Enabled</span>
                {:else}
                  <Power size={13} strokeWidth={2} class="shrink-0" />
                  <span>Disabled</span>
                {/if}
              </button>
              <button
                type="button"
                onclick={() => onOpenLimitEditor({ mode: "edit", limitId: limit.id })}
                disabled={!limit.enabled}
                aria-label={`Edit ${limit.name}`}
                data-app-tooltip-disabled="true"
                class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-card text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40 dark:bg-transparent"
              >
                <Pencil size={13} strokeWidth={2} />
              </button>
              <button
                type="button"
                onclick={() => requestLimitDelete(limit)}
                aria-label={`Delete ${limit.name}`}
                data-app-tooltip-disabled="true"
                class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-card text-foreground transition-colors hover:bg-accent dark:bg-transparent"
              >
                <Trash2 size={13} strokeWidth={2} />
              </button>
            </div>
          </div>

          <div class="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              class="h-full rounded-full bg-primary"
              style={`width: ${progressPercent(limit)}%`}
            ></div>
          </div>

          <div class="flex min-w-0 flex-wrap gap-1.5">
            {#each limit.entries as entry (doomscrollingLimitEntryKey(entry))}
              <span class="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-transparent px-2 py-1 text-[0.733333rem] text-muted-foreground">
                <span class="shrink-0 text-foreground">{entryLabel(entry)}</span>
                <span class="truncate text-muted-foreground">{entrySourceSummary(entry)}</span>
              </span>
            {/each}
          </div>
        </article>
      {:else}
        <div class="flex h-10 items-center border-b border-border/70 text-[0.8rem] text-muted-foreground">
          No daily limits yet
        </div>
      {/each}
    </div>
  </section>
{/snippet}

<div class="flex flex-col gap-6">
  <DoomscrollingBrowserConnectionStatus />

  <section class="flex flex-col gap-4">
    <h2 class="px-1 text-[0.866667rem] font-semibold text-foreground">Usage limit configuration</h2>
    <div class="flex flex-col gap-3">
      <ToggleSetting
        label="Enable usage limits"
        description="Apply daily budgets whenever GanbaruAI is running"
        checked={doomscrolling.limitsEnabled}
        onChange={requestGlobalEnabledChange}
      />
    </div>
  </section>

  <fieldset
    disabled={!doomscrolling.limitsEnabled}
    aria-disabled={!doomscrolling.limitsEnabled}
    class={cn(
      "m-0 flex min-w-0 flex-col gap-6 border-0 p-0 transition-opacity",
      !doomscrolling.limitsEnabled && "opacity-50",
    )}
  >
    <div class="h-px bg-border/70" aria-hidden="true"></div>

    <section class="flex flex-col gap-2">
      {#if desktopAvailabilityMessage}
        <div class="flex min-h-9 items-center gap-2.5 rounded-md border border-border bg-background/60 px-3 py-1.5 text-muted-foreground dark:bg-transparent">
          <CircleAlert size={14} strokeWidth={2.25} class="shrink-0" />
          <div class="min-w-0 text-[0.8rem]">{desktopAvailabilityMessage}</div>
        </div>
      {/if}

      <div class="flex min-h-9 items-center gap-2.5 rounded-md border border-border bg-background/60 px-3 py-1.5 text-muted-foreground dark:bg-transparent">
        <CircleAlert size={14} strokeWidth={2.25} class="shrink-0" />
        <div class="min-w-0 text-[0.8rem]">Mobile app entries are saved for later, but mobile usage is not counted yet.</div>
      </div>
    </section>

    <div class="h-px bg-border/70" aria-hidden="true"></div>

    {@render limitList()}
  </fieldset>
</div>

{#if pendingAction}
  <ConfirmDialog
    title={pendingTitle(pendingAction)}
    message={pendingMessage(pendingAction)}
    confirmLabel={pendingConfirmLabel(pendingAction)}
    cancelLabel="Cancel (Esc)"
    onConfirm={confirmPendingAction}
    onCancel={cancelPendingAction}
  />
{/if}
