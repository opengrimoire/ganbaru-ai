<script lang="ts">
  import { getTheme } from "$lib/stores/theme.svelte";
  import { getPreferences } from "$lib/stores/preferences.svelte";
  import {
    FONT_SCALE_MIN,
    FONT_SCALE_MAX,
    DEFAULT_FONT_SCALE,
  } from "$lib/stores/preferences";
  import type { EventColor } from "$lib/components/calendar/types";
  import { cn } from "$lib/utils";

  const theme = getTheme();
  const preferences = getPreferences();

  // A compact preview row of representative event-palette slots. Shows how
  // the theme's colors look without dumping all 24 swatches in the picker.
  const PREVIEW_SLOTS: readonly EventColor[] = [
    "tomato",
    "tangerine",
    "banana",
    "basil",
    "peacock",
    "blueberry",
    "grape",
    "graphite",
  ];

  const FONT_SCALE_STEP = 0.05;
</script>

<div class="space-y-8">
  <header>
    <h1 class="text-lg font-semibold text-foreground">Appearance</h1>
    <p class="mt-1 text-[13px] text-muted-foreground">
      Pick a theme, font, and text size. These settings are independent.
    </p>
  </header>

  <!-- Theme picker -->
  <section class="space-y-3">
    <div>
      <h2 class="text-[13px] font-semibold text-foreground">Theme</h2>
      <p class="text-[12px] text-muted-foreground">
        Changes colors across the app and the calendar palette.
      </p>
    </div>
    <div class="grid gap-2">
      {#each Object.values(theme.registry) as option}
        {@const isActive = option.id === theme.id}
        <button
          onclick={() => theme.setTheme(option.id)}
          class={cn(
            "flex items-center justify-between gap-4 rounded-md border px-3 py-2 text-left transition-colors",
            isActive
              ? "border-primary bg-accent/40"
              : "border-border bg-card hover:bg-accent/40 dark:bg-transparent",
          )}
        >
          <div class="flex flex-col">
            <span class="text-[13px] font-medium text-foreground">{option.displayName}</span>
            <span class="text-[11px] uppercase tracking-wider text-muted-foreground">
              {option.base}
            </span>
          </div>
          <div class="flex items-center gap-1">
            {#each PREVIEW_SLOTS as slot}
              <span
                class="h-3.5 w-3.5 rounded-full"
                style="background-color: {option.eventPalette[slot]};"
              ></span>
            {/each}
          </div>
        </button>
      {/each}
    </div>
  </section>

  <!-- Font family -->
  <section class="space-y-2">
    <div>
      <h2 class="text-[13px] font-semibold text-foreground">Font family</h2>
      <p class="text-[12px] text-muted-foreground">
        All font options resolve to system or installed fonts. No remote loading.
      </p>
    </div>
    <select
      value={preferences.fontFamilyId}
      onchange={(e) => preferences.setFontFamily(e.currentTarget.value)}
      class="w-full max-w-xs rounded-md border border-border bg-card px-3 py-1.5 text-[13px] text-foreground transition-colors hover:bg-accent focus:outline-none focus:ring-1 focus:ring-ring dark:bg-transparent"
    >
      {#each preferences.fontFamilies as option}
        <option value={option.id}>{option.displayName}</option>
      {/each}
    </select>
  </section>

  <!-- Font scale -->
  <section class="space-y-2">
    <div class="flex items-start justify-between gap-4">
      <div>
        <h2 class="text-[13px] font-semibold text-foreground">Font scale</h2>
        <p class="text-[12px] text-muted-foreground">
          Multiplies the base text size. Affects the whole app.
        </p>
      </div>
      <button
        onclick={() => preferences.resetFontScale()}
        class="shrink-0 rounded-md border border-border bg-card px-2.5 py-1 text-[12px] text-foreground transition-colors hover:bg-accent dark:bg-transparent"
        disabled={preferences.fontScale === DEFAULT_FONT_SCALE}
      >
        Reset
      </button>
    </div>
    <div class="flex items-center gap-3">
      <input
        type="range"
        min={FONT_SCALE_MIN}
        max={FONT_SCALE_MAX}
        step={FONT_SCALE_STEP}
        value={preferences.fontScale}
        oninput={(e) => preferences.setFontScale(parseFloat(e.currentTarget.value))}
        class="flex-1 accent-primary"
      />
      <span class="w-12 text-right text-[12px] tabular-nums text-foreground">
        {Math.round(preferences.fontScale * 100)}%
      </span>
    </div>
  </section>
</div>
