<script module lang="ts">
  export interface HoverTimeGuideState {
    horizontalInstant: boolean;
    instant: boolean;
    minute: number;
    positionMinute: number;
    width: number;
    x: number;
  }
</script>

<script lang="ts">
  import { pickBrightForeground } from "$lib/components/ui/colorMath";
  import {
    resolveAppTokens,
    resolveCalendarTokens,
    type Theme,
  } from "$lib/stores/themes";

  let {
    guide,
    theme,
  }: {
    guide: HoverTimeGuideState | null;
    theme: Theme;
  } = $props();

  const resolvedAppTokens = $derived(resolveAppTokens(theme));
  const resolvedCalendarTokens = $derived(resolveCalendarTokens(theme));
  const hoverGuideColor = $derived(resolvedCalendarTokens["--cal-current-time"]);
  const hoverGuideTextColor = $derived(
    pickBrightForeground(hoverGuideColor, resolvedAppTokens["--foreground"]),
  );

  function formatMinuteLabel(minute: number): string {
    const clamped = Math.max(0, Math.min(1440, Math.round(minute)));
    const h = Math.floor(clamped / 60);
    const m = clamped % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
</script>

<div class="pointer-events-none absolute inset-0 z-[49]" aria-hidden="true">
  {#if guide}
    <div
      class="hover-time-guide-x {guide.horizontalInstant ? 'hover-time-guide-transition-paused' : ''}"
      style="
        width: {guide.width}px;
        transform: translate3d({guide.x}px, 0, 0);
        --hover-time-guide-color: {hoverGuideColor};
        --hover-time-guide-text: {hoverGuideTextColor};
      "
    >
      <div
        class="hover-time-guide-y {guide.instant ? 'hover-time-guide-transition-paused' : ''}"
        style="
          transform: translate3d(0, calc({guide.positionMinute} / 60 * var(--hour-h) * 1px), 0);
        "
      >
        <div
          class="hover-time-label absolute"
          style="
            top: 0;
            left: 2px;
            transform: translateY({guide.positionMinute <= 0 ? '0' : guide.positionMinute >= 1440 ? '-100%' : '-50%'});
          "
        >
          {formatMinuteLabel(guide.minute)}
        </div>
        <div
          class="hover-time-line absolute right-0"
          style="left: 42px; top: -1px;"
        ></div>
      </div>
    </div>
  {/if}
</div>

<style>
  .hover-time-guide-x {
    position: absolute;
    left: 0;
    top: 0;
    transition: transform 95ms ease-out, width 95ms ease-out;
  }

  .hover-time-guide-y {
    position: relative;
    transition: transform 70ms linear;
  }

  .hover-time-label {
    border-radius: 3px;
    border: 1px solid color-mix(in srgb, var(--hover-time-guide-text) 22%, transparent);
    background-color: var(--hover-time-guide-color);
    color: var(--hover-time-guide-text);
    font-size: 10px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    font-feature-settings: "tnum";
    line-height: 1;
    box-sizing: border-box;
    width: 38px;
    padding: 2px 3px 1px;
    box-shadow: 0 1px 4px color-mix(in srgb, black 24%, transparent);
    text-align: center;
  }

  .hover-time-line {
    height: 2px;
    background-color: var(--hover-time-guide-color);
    opacity: 1;
  }

  .hover-time-guide-transition-paused {
    transition: none;
  }
</style>
