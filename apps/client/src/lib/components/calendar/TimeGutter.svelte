<script lang="ts">
  import { getHourInTimezone } from "./utils";

  let {
    timezones = [] as string[],
    anchorDate = new Date(),
    tzCount = 1,
  }: {
    timezones?: string[];
    anchorDate?: Date;
    tzCount?: number;
  } = $props();

  const hours = Array.from({ length: 24 }, (_, i) => i);
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
              class="absolute top-[-0.45em] text-[0.733333rem] leading-none antialiased"
              style="color: var(--cal-time-label);"
            >
              {getHourInTimezone(anchorDate, hour, tz)}
            </span>
          {/if}
        </div>
      {/each}
    </div>
  {/each}
</div>
