<script lang="ts">
  /**
   * Live preview of a theme while the user edits it.
   *
   * The pane re-declares every user-editable CSS variable as an inline style
   * on its root element. That inline scope "unshadows" the
   * `.theme-editor-chrome` overrides that sit above it, so the preview
   * renders the theme the user will actually see. Re-runs on any source,
   * override, or palette change because all derivation is `$derived` from
   * the theme prop.
   */
  import {
    resolveAppTokens,
    resolveCalendarTokens,
    type Theme,
  } from "$lib/stores/themes";
  import {
    blendHex,
    pickReadableForeground,
  } from "$lib/components/ui/colorMath";

  let { theme }: { theme: Theme } = $props();

  const appTokens = $derived(resolveAppTokens(theme));
  const calTokens = $derived(resolveCalendarTokens(theme));

  const styleVars = $derived.by(() => {
    const parts: string[] = [];
    for (const [key, value] of Object.entries(appTokens)) {
      parts.push(`${key}: ${value}`);
    }
    for (const [key, value] of Object.entries(calTokens)) {
      parts.push(`${key}: ${value}`);
    }
    return parts.join("; ");
  });

  const priorityStyles = $derived.by(() => {
    const canvas = appTokens["--background"];
    const ink = appTokens["--foreground"];
    const priorities = ["easy", "medium", "hard", "epic"] as const;
    const out: Record<string, { bg: string; fg: string }> = {};
    for (const p of priorities) {
      const base = appTokens[`--priority-${p}`];
      const bg = blendHex(base, canvas, 0.18);
      const fg = pickReadableForeground(bg, { ink, canvas });
      out[p] = { bg, fg };
    }
    return out;
  });

  const eventSlot = $derived(theme.eventPalette[6] ?? theme.eventPalette[0]);

  const calDays = [
    { label: "Mon", num: 14, today: false },
    { label: "Tue", num: 15, today: true },
    { label: "Wed", num: 16, today: false },
  ];
</script>

<div
  class="flex flex-col gap-3 rounded-lg border p-3 text-[12px]"
  style="{styleVars}; background-color: var(--background); color: var(--foreground); border-color: var(--border);"
  aria-label="Live theme preview"
>
  <div class="flex items-center justify-between gap-2">
    <span class="text-[11px] font-semibold uppercase tracking-wide" style="color: var(--muted-foreground);">
      Preview
    </span>
    <span class="text-[10px]" style="color: var(--muted-foreground);">
      Live
    </span>
  </div>

  <!-- Buttons row -->
  <div class="flex flex-wrap items-center gap-1.5">
    <button
      type="button"
      class="rounded-md px-2 py-1 text-[11px] font-medium"
      style="background-color: var(--primary); color: var(--primary-foreground);"
      tabindex="-1"
    >
      Primary
    </button>
    <button
      type="button"
      class="rounded-md px-2 py-1 text-[11px] font-medium"
      style="background-color: var(--secondary); color: var(--secondary-foreground);"
      tabindex="-1"
    >
      Secondary
    </button>
    <button
      type="button"
      class="rounded-md px-2 py-1 text-[11px] font-medium"
      style="background-color: var(--destructive); color: var(--destructive-foreground);"
      tabindex="-1"
    >
      Delete
    </button>
    <button
      type="button"
      class="rounded-md border px-2 py-1 text-[11px] font-medium"
      style="border-color: var(--border); background-color: transparent; color: var(--foreground);"
      tabindex="-1"
    >
      Outline
    </button>
    <button
      type="button"
      class="rounded-md px-2 py-1 text-[11px] font-medium"
      style="background-color: transparent; color: var(--foreground);"
      tabindex="-1"
    >
      Ghost
    </button>
  </div>

  <!-- Priority badges row -->
  <div class="flex flex-wrap items-center gap-1.5">
    {#each ["easy", "medium", "hard", "epic"] as p}
      <span
        class="rounded px-1.5 py-0.5 text-[10px] font-medium capitalize"
        style:background-color={priorityStyles[p].bg}
        style:color={priorityStyles[p].fg}
      >
        {p}
      </span>
    {/each}
  </div>

  <!-- Text sample row -->
  <div class="flex flex-col gap-0.5">
    <div class="text-[13px] font-semibold" style="color: var(--foreground);">
      Heading reads here
    </div>
    <div class="text-[11px]" style="color: var(--foreground);">
      Body copy on the canvas stays legible.
    </div>
    <div class="text-[11px]" style="color: var(--muted-foreground);">
      Muted caption recedes but never disappears.
    </div>
    <div class="text-[11px] underline" style="color: var(--primary);">
      Primary-colored link
    </div>
  </div>

  <!-- Mini calendar strip -->
  <div
    class="overflow-hidden rounded-md border"
    style="border-color: var(--cal-gridline); background-color: var(--cal-bg);"
  >
    <div
      class="grid grid-cols-3 border-b text-[10px]"
      style="border-color: var(--cal-gridline); background-color: var(--cal-header-bg); color: var(--foreground);"
    >
      {#each calDays as d}
        <div class="flex items-center justify-center gap-1 px-1 py-1">
          <span style="color: var(--cal-time-label);">{d.label}</span>
          {#if d.today}
            <span
              class="flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-semibold"
              style="background-color: var(--cal-today-circle); color: var(--cal-today-circle-text);"
            >
              {d.num}
            </span>
          {:else}
            <span style="color: var(--foreground);">{d.num}</span>
          {/if}
        </div>
      {/each}
    </div>
    <div class="relative grid grid-cols-3" style="height: 32px;">
      {#each calDays as _, i}
        <div
          class="relative"
          style="{i < 2 ? `border-right: 1px solid var(--cal-gridline);` : ''}"
        >
          {#if i === 1}
            <div
              class="absolute left-1 right-1 top-1 rounded px-1 text-[9px]"
              style="background-color: {eventSlot}; color: {pickReadableForeground(eventSlot, { ink: appTokens['--foreground'], canvas: appTokens['--background'] })};"
            >
              Event
            </div>
            <div
              class="absolute left-0 right-0"
              style="top: 60%; height: 1px; background-color: var(--cal-current-time);"
            ></div>
          {/if}
        </div>
      {/each}
    </div>
  </div>
</div>
