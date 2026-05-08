<script lang="ts">
  /**
   * Modal shown when the user clicks "New theme". Lets them start from a
   * curated preset (contrast-validated in `themePresets.test.ts`) or from a
   * blank seed clone of the current theme.
   *
   * Preview cards re-declare every derived CSS variable inline so each
   * preset renders with its own tokens, not the caller's theme.
   */
  import X from "@lucide/svelte/icons/x";
  import {
    deriveAppTokens,
    deriveCalendarTokens,
    BASE_APP_TOKENS,
    BASE_CALENDAR_TOKENS,
    type ThemeSources,
  } from "$lib/stores/themes";
  import { THEME_PRESETS, type ThemePreset } from "$lib/data/themePresets";

  let {
    onPick,
    onStartBlank,
    onClose,
  }: {
    onPick: (preset: ThemePreset) => void;
    onStartBlank: () => void;
    onClose: () => void;
  } = $props();

  function tokensForPreset(
    sources: ThemeSources,
    base: "light" | "dark",
  ): Record<string, string> {
    const app = deriveAppTokens(sources);
    const cal = deriveCalendarTokens(sources);
    return { ...BASE_APP_TOKENS[base], ...BASE_CALENDAR_TOKENS[base], ...app, ...cal };
  }

  function styleVarsFor(
    sources: ThemeSources,
    base: "light" | "dark",
  ): string {
    const tokens = tokensForPreset(sources, base);
    return Object.entries(tokens)
      .map(([k, v]) => `${k}: ${v}`)
      .join("; ");
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") onClose();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div
  class="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4 max-[520px]:p-2"
  role="dialog"
  aria-modal="true"
  aria-label="Pick a starting preset"
>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="absolute inset-0"
    onclick={onClose}
    aria-hidden="true"
  ></div>

  <div
    class="relative flex max-h-[90vh] w-[min(560px,100%)] flex-col gap-4 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-2xl max-[520px]:p-3"
  >
    <header class="flex items-start justify-between gap-3">
      <div class="min-w-0 flex-1">
        <h2 class="text-[14px] font-semibold text-foreground">
          Pick a starting preset
        </h2>
        <p class="mt-1 text-[12px] text-muted-foreground">
          Every preset is pre-validated for AA contrast. Pick one to start,
          then tweak in the editor.
        </p>
      </div>
      <button
        type="button"
        onclick={onClose}
        aria-label="Close preset picker"
        class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <X size={14} strokeWidth={2} />
      </button>
    </header>

    <div class="grid grid-cols-3 gap-3 max-[520px]:grid-cols-1">
      {#each THEME_PRESETS as preset (preset.id)}
        <button
          type="button"
          onclick={() => onPick(preset)}
          class="group flex flex-col gap-2 rounded-lg border border-border p-2 text-left transition-all hover:border-foreground/40 hover:shadow-md"
        >
          <!-- Miniature preview -->
          <div
            class="flex h-[88px] w-full flex-col overflow-hidden rounded-md border"
            style="{styleVarsFor(preset.sources, preset.base)}; background-color: var(--background); border-color: var(--border);"
            aria-hidden="true"
          >
            <!-- Title bar strip -->
            <div
              class="flex h-3 items-center justify-end gap-0.5 px-1"
              style="background-color: var(--sidebar);"
            >
              <span class="h-1 w-1 rounded-full" style="background-color: var(--muted-foreground);"></span>
              <span class="h-1 w-1 rounded-full" style="background-color: var(--muted-foreground);"></span>
              <span class="h-1 w-1 rounded-full" style="background-color: var(--destructive);"></span>
            </div>
            <!-- Content -->
            <div class="flex flex-1 gap-1 p-1">
              <!-- Side card -->
              <div
                class="flex w-8 flex-col gap-0.5 rounded-sm p-0.5"
                style="background-color: var(--card);"
              >
                <span class="h-0.5 w-full rounded-full" style="background-color: var(--foreground);"></span>
                <span class="h-0.5 w-3/4 rounded-full" style="background-color: var(--muted-foreground);"></span>
              </div>
              <!-- Button + calendar tile -->
              <div class="flex flex-1 flex-col gap-0.5">
                <div
                  class="h-2 rounded-sm"
                  style="background-color: var(--primary);"
                ></div>
                <div
                  class="flex flex-1 gap-px rounded-sm p-px"
                  style="background-color: var(--cal-bg);"
                >
                  <div class="flex-1" style="border-right: 1px solid var(--cal-gridline);"></div>
                  <div class="flex-1 relative" style="border-right: 1px solid var(--cal-gridline);">
                    <span
                      class="absolute left-px right-px top-px h-1 rounded-sm"
                      style="background-color: var(--primary);"
                    ></span>
                  </div>
                  <div class="flex-1"></div>
                </div>
              </div>
            </div>
          </div>
          <!-- Label -->
          <div class="flex flex-col gap-0.5">
            <span class="text-[11px] font-semibold text-foreground">
              {preset.displayName}
            </span>
            <span class="line-clamp-2 text-[10px] text-muted-foreground">
              {preset.description}
            </span>
          </div>
        </button>
      {/each}
    </div>

    <div class="flex items-center justify-between gap-3 border-t border-border pt-3 max-[520px]:flex-col max-[520px]:items-stretch">
      <span class="text-[11px] text-muted-foreground">
        Prefer to start from your current theme?
      </span>
      <button
        type="button"
        onclick={onStartBlank}
        class="rounded-md border border-border bg-card px-3 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-accent max-[520px]:self-end"
      >
        Start blank
      </button>
    </div>
  </div>
</div>
