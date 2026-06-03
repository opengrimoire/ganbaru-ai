<script lang="ts">
  import { getHourInTimezone } from "./utils";
  import { getPreferences } from "$lib/stores/preferences.svelte";

  let {
    timezones = [] as string[],
    anchorDate = new Date(),
    tzCount = 1,
  }: {
    timezones?: string[];
    anchorDate?: Date;
    tzCount?: number;
  } = $props();

  const preferences = getPreferences();
  const hours = Array.from({ length: 24 }, (_, i) => i);

  function formatTickLabel(hour: number, tz: string): string {
    const label = getHourInTimezone(
      anchorDate,
      hour,
      tz,
      preferences.calendarTimeFormat,
      "short",
    );
    if (preferences.calendarTimeFormat !== "12h") return label;
    return label.replace(/\b(am|pm)\b$/, (period) => period.toUpperCase());
  }
</script>

<div
  class="grid select-none"
  style="grid-column: span {tzCount}; grid-template-columns: subgrid;"
>
  {#each timezones as tz, tzIdx}
    <div
      class="min-w-0"
      style={tzIdx > 0 ? "border-left: 1px solid var(--cal-gridline);" : ""}
    >
      {#each hours as hour}
        <div
          class="relative flex items-start justify-center"
          style="height: calc(var(--hour-h) * 1px);"
        >
          {#if hour > 0}
            <span
              class="absolute top-[-0.45em] -translate-x-1/2 whitespace-nowrap text-[0.733333rem] leading-none antialiased"
              style="left: {preferences.calendarTimeFormat === '12h' ? 'calc(50% - 0.2px)' : '50%'}; color: var(--cal-time-label);"
            >
              {formatTickLabel(hour, tz)}
            </span>
          {/if}
        </div>
      {/each}
    </div>
  {/each}
</div>
