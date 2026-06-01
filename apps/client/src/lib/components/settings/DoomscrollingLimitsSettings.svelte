<script lang="ts">
  import Check from "@lucide/svelte/icons/check";
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Plus from "@lucide/svelte/icons/plus";
  import Power from "@lucide/svelte/icons/power";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import { getEventColor } from "$lib/components/calendar/utils";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";
  import {
    computeDoomscrollingLimitEntryWindowTotals,
    doomscrollingLimitEntryKey,
    type DoomscrollingLimitEntry,
    type DoomscrollingLimitPeriod,
    type DoomscrollingLimitTotal,
    type DoomscrollingUsageLimit,
  } from "$lib/doomscrolling";
  import { getDoomscrolling } from "$lib/stores/doomscrolling.svelte";
  import { getDoomscrollingUsage } from "$lib/stores/doomscrolling-usage.svelte";
  import { getTheme } from "$lib/stores/theme.svelte";
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
  const theme = getTheme();

  let pendingAction = $state<PendingLimitAction | null>(null);

  const desktopAvailabilityMessage = $derived(
    usage.foregroundStatus.available
      ? null
      : usage.foregroundStatus.reason?.toLowerCase().includes("wayland")
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

  interface LimitProgressSegment {
    entry: DoomscrollingLimitEntry;
    usedSeconds: number;
    widthPercent: number;
    color: string;
  }

  interface LimitBudgetView {
    total: DoomscrollingLimitTotal;
    period: DoomscrollingLimitPeriod;
    segments: LimitProgressSegment[];
  }

  function entryColor(entry: DoomscrollingLimitEntry): string {
    return getEventColor(entry.color ?? undefined, theme.current).bg;
  }

  function totalPeriod(total: DoomscrollingLimitTotal): DoomscrollingLimitPeriod {
    return total.period ?? "day";
  }

  function periodUsageLabel(period: DoomscrollingLimitPeriod): string {
    return period === "week" ? "this week" : "today";
  }

  function formatLimitSeconds(seconds: number): string {
    return formatMinutes(seconds);
  }

  function limitProgressSegments(
    limit: DoomscrollingUsageLimit,
    total: DoomscrollingLimitTotal,
  ): LimitProgressSegment[] {
    const entryTotals = computeDoomscrollingLimitEntryWindowTotals(
      limit,
      usage.samples,
      total.windowStartLocalDate ?? usage.localDate,
      total.windowEndLocalDate ?? usage.localDate,
    );
    const usedSecondsByEntryId = new Map(
      entryTotals.map((entryTotal) => [entryTotal.entryId, entryTotal.usedSeconds] as const),
    );
    const totalUsedSeconds = entryTotals.reduce(
      (total, entryTotal) => total + entryTotal.usedSeconds,
      0,
    );
    const widthBaseSeconds = Math.max(total.limitSeconds, totalUsedSeconds, 1);
    return limit.entries
      .map((entry) => {
        const usedSeconds = usedSecondsByEntryId.get(entry.id) ?? 0;
        return {
          entry,
          usedSeconds,
          widthPercent: Math.min(100, Math.max(0, (usedSeconds / widthBaseSeconds) * 100)),
          color: entryColor(entry),
        };
      })
      .filter((segment) => segment.usedSeconds > 0 && segment.widthPercent > 0);
  }

  function limitBudgetViews(limit: DoomscrollingUsageLimit): LimitBudgetView[] {
    const storedTotals = usage.totalsFor(limit.id);
    const storedTotalByPeriod = new Map(
      storedTotals.map((total) => [totalPeriod(total), total] as const),
    );
    const totals = [
        limit.minutesPerDay === null ? null : (storedTotalByPeriod.get("day") ?? {
          limitId: limit.id,
          period: "day" as const,
          windowStartLocalDate: usage.localDate,
          windowEndLocalDate: usage.localDate,
          usedSeconds: 0,
          limitSeconds: limit.minutesPerDay * 60,
          remainingSeconds: limit.minutesPerDay * 60,
          exhausted: false,
        }),
        limit.minutesPerWeek === null || limit.minutesPerWeek === undefined ? null : (storedTotalByPeriod.get("week") ?? {
          limitId: limit.id,
          period: "week" as const,
          windowStartLocalDate: usage.weekStartLocalDate,
          windowEndLocalDate: usage.localDate,
          usedSeconds: 0,
          limitSeconds: limit.minutesPerWeek * 60,
          remainingSeconds: limit.minutesPerWeek * 60,
          exhausted: false,
        }),
      ].filter((total): total is DoomscrollingLimitTotal => total !== null);
    return totals
      .map((total) => ({
        total,
        period: totalPeriod(total),
        segments: limitProgressSegments(limit, total),
      }))
      .sort((a, b) => {
        const order = { day: 0, week: 1 } satisfies Record<DoomscrollingLimitPeriod, number>;
        return order[a.period] - order[b.period];
      });
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
        <h2 class="text-[0.866667rem] font-semibold text-foreground">Usage limits</h2>
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
        {@const budgetViews = limitBudgetViews(limit)}
        <article
          class={cn(
            "flex min-w-0 flex-col gap-1.5 border-b border-border/70 py-4 transition-opacity",
            !limit.enabled && "opacity-50",
          )}
          aria-label={limit.enabled ? limit.name : `${limit.name} disabled`}
        >
          <div class="flex min-w-0 flex-wrap items-start justify-between gap-2">
            <div class="min-w-0 flex-1">
              <h3 class="truncate text-[0.866667rem] text-foreground">
                {limit.name}
              </h3>
              <div class="mt-0.5 flex min-w-0 flex-col gap-2">
                {#each budgetViews as view (`${limit.id}:${view.period}`)}
                  <div class="flex min-w-0 flex-col gap-2 pt-2 first:pt-0">
                    <div class="text-[0.8rem] text-muted-foreground">
                      {formatMinutes(view.total.usedSeconds)} used of {formatLimitSeconds(view.total.limitSeconds)} {periodUsageLabel(view.period)}
                    </div>

                    <div class="flex h-1.5 overflow-hidden rounded-full bg-muted">
                      {#if view.segments.length > 0}
                        {#each view.segments as segment (segment.entry.id)}
                          <div
                            class="h-full first:rounded-l-full last:rounded-r-full"
                            style={`width: ${segment.widthPercent}%; background-color: ${segment.color};`}
                            title={`${entryLabel(segment.entry)}: ${formatMinutes(segment.usedSeconds)}`}
                          ></div>
                        {/each}
                      {/if}
                    </div>

                    <div class="flex min-w-0 flex-wrap gap-1.5">
                      {#each limit.entries as entry (doomscrollingLimitEntryKey(entry))}
                        <span class="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-transparent px-2 py-1 text-[0.733333rem] text-foreground">
                          <span
                            class="h-2 w-2 shrink-0 rounded-full"
                            style={`background-color: ${entryColor(entry)};`}
                            aria-hidden="true"
                          ></span>
                          <span class="truncate">{entryLabel(entry)}</span>
                        </span>
                      {/each}
                    </div>
                  </div>
                {/each}
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
                  <Check size={13} strokeWidth={2.25} class="shrink-0" />
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
        </article>
      {:else}
        <div class="flex h-10 items-center border-b border-border/70 text-[0.8rem] text-muted-foreground">
          No usage limits yet
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
        description="Apply daily and weekly budgets whenever Ganbaru AI is running"
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

    {#if desktopAvailabilityMessage}
      <section class="flex flex-col gap-2">
        <div class="flex min-h-9 items-center gap-2.5 rounded-md border border-border bg-background/60 px-3 py-1.5 text-muted-foreground dark:bg-transparent">
          <CircleAlert size={14} strokeWidth={2.25} class="shrink-0" />
          <div class="min-w-0 text-[0.8rem]">{desktopAvailabilityMessage}</div>
        </div>
      </section>

      <div class="h-px bg-border/70" aria-hidden="true"></div>
    {/if}

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
