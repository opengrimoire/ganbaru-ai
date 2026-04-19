<script lang="ts">
  import { untrack } from "svelte";
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import X from "@lucide/svelte/icons/x";
  import Copy from "@lucide/svelte/icons/copy";
  import Download from "@lucide/svelte/icons/download";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import Sun from "@lucide/svelte/icons/sun";
  import Moon from "@lucide/svelte/icons/moon";
  import { invoke } from "@tauri-apps/api/core";
  import { save as saveDialog } from "@tauri-apps/plugin-dialog";
  import { cn } from "$lib/utils";
  import { PALETTE_SIZE } from "$lib/components/calendar/types";
  import { blendHex } from "$lib/components/calendar/utils";
  import {
    APP_TOKEN_KEYS,
    CALENDAR_TOKEN_KEYS,
    type Theme,
  } from "$lib/stores/themes";
  import { getTheme } from "$lib/stores/theme.svelte";
  import ColorField from "$lib/components/ui/ColorField.svelte";

  type TokenInfo = { title: string; description: string };

  const APP_TOKEN_INFO: Record<string, TokenInfo> = {
    "--background": {
      title: "Background",
      description: "Main app background behind everything else.",
    },
    "--foreground": {
      title: "Text",
      description: "Default text color across the app.",
    },
    "--card": {
      title: "Card",
      description: "Background of grouped panels and tinted cards.",
    },
    "--card-foreground": {
      title: "Card text",
      description: "Text shown inside cards.",
    },
    "--popover": {
      title: "Popover",
      description: "Background of dropdowns, menus, and floating panels.",
    },
    "--popover-foreground": {
      title: "Popover text",
      description: "Text shown inside popovers and menus.",
    },
    "--primary": {
      title: "Primary action",
      description: "Main accent color for highlighted buttons and links.",
    },
    "--primary-foreground": {
      title: "Primary action text",
      description: "Text on primary buttons.",
    },
    "--secondary": {
      title: "Secondary surface",
      description: "Background of muted, less emphasized buttons.",
    },
    "--secondary-foreground": {
      title: "Secondary surface text",
      description: "Text on secondary surfaces.",
    },
    "--muted": {
      title: "Muted surface",
      description: "Background of subtle areas like input wells.",
    },
    "--muted-foreground": {
      title: "Muted text",
      description: "Subdued text for hints and labels.",
    },
    "--accent": {
      title: "Hover surface",
      description: "Soft tint shown when hovering buttons and rows.",
    },
    "--accent-foreground": {
      title: "Hover text",
      description: "Text shown on the hover tint.",
    },
    "--destructive": {
      title: "Destructive",
      description: "Color used for delete actions and warnings.",
    },
    "--ring": {
      title: "Focus ring",
      description: "Outline shown around focused inputs and buttons.",
    },
    "--sidebar": {
      title: "Sidebar",
      description: "Background of the side navigation panel.",
    },
    "--sidebar-foreground": {
      title: "Sidebar text",
      description: "Default text inside the sidebar.",
    },
    "--sidebar-primary": {
      title: "Sidebar highlight",
      description: "Color of the active sidebar item.",
    },
    "--sidebar-primary-foreground": {
      title: "Sidebar highlight text",
      description: "Text on the active sidebar item.",
    },
    "--sidebar-accent": {
      title: "Sidebar hover",
      description: "Tint applied when hovering sidebar items.",
    },
    "--sidebar-accent-foreground": {
      title: "Sidebar hover text",
      description: "Text shown on the sidebar hover tint.",
    },
    "--sidebar-ring": {
      title: "Sidebar focus ring",
      description: "Outline shown around a focused sidebar item.",
    },
  };

  const CALENDAR_TOKEN_INFO: Record<string, TokenInfo> = {
    "--cal-bg": {
      title: "Calendar background",
      description: "Background of the calendar grid.",
    },
    "--cal-header-bg": {
      title: "Calendar header",
      description: "Background of the day and time headers.",
    },
    "--cal-gridline": {
      title: "Grid lines",
      description: "Color of the hour and day separator lines.",
    },
    "--cal-today-circle": {
      title: "Today marker",
      description: "Filled circle around today's date in the header.",
    },
    "--cal-today-circle-text": {
      title: "Today marker text",
      description: "Date number inside the today circle.",
    },
    "--cal-time-label": {
      title: "Time labels",
      description: "Hour numbers down the side of the calendar.",
    },
    "--cal-current-time": {
      title: "Now line",
      description: "Horizontal line marking the current time.",
    },
    "--cal-timeline-rail": {
      title: "Session rail track",
      description: "Background strip beside an event during a pomodoro.",
    },
    "--cal-timeline-break": {
      title: "Break marker",
      description: "Color of break segments on the session rail.",
    },
    "--cal-timeline-focus": {
      title: "Focus marker",
      description: "Color of focus segments on the session rail.",
    },
  };

  let {
    theme,
    onDone,
  }: {
    theme: Theme;
    onDone: () => void;
  } = $props();

  const themeStore = getTheme();
  const THEME_FILE_FILTER = [{ name: "Theme JSON", extensions: ["json"] }];

  const isBuiltin = $derived(themeStore.isBuiltin(theme.id));

  // The JSON drawer mirrors the theme's serialized form. We only refresh it
  // from props while the user has not yet typed anything, otherwise their
  // pending edits would be wiped every time a form field updates the store.
  let jsonDraft = $state(untrack(() => themeStore.exportTheme(theme.id) ?? ""));
  let jsonDirty = $state(false);
  let jsonErrors = $state<string[]>([]);
  let jsonNotice = $state<string | undefined>(undefined);
  let jsonNoticeTimer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    const next = themeStore.exportTheme(theme.id) ?? "";
    if (!jsonDirty) jsonDraft = next;
  });

  function flashJsonNotice(message: string) {
    jsonNotice = message;
    if (jsonNoticeTimer) clearTimeout(jsonNoticeTimer);
    jsonNoticeTimer = setTimeout(() => {
      jsonNotice = undefined;
    }, 1800);
  }

  function humanize(token: string): string {
    const stripped = token.replace(/^--/, "").replace(/^cal-/, "");
    const spaced = stripped.replace(/-/g, " ");
    if (spaced.length === 0) return spaced;
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }

  function setName(next: string) {
    themeStore.renameTheme(theme.id, next);
  }

  // Default --cal-bg per base. Built-in themes' blendCanvas matches these
  // (since past events fade into the calendar grid, not the surrounding
  // app), so they double as the fallback when a user theme drops its
  // --cal-bg override.
  const BASE_CAL_BG: Record<"light" | "dark", string> = {
    light: "#FFFFFF",
    dark: "#131314",
  };

  function effectiveCalBg(t: Theme): string {
    return t.calendarTokenOverrides?.["--cal-bg"] ?? BASE_CAL_BG[t.base];
  }

  function setBase(next: "light" | "dark") {
    const updates: Partial<Theme> = { base: next };
    if (!theme.calendarTokenOverrides?.["--cal-bg"]) {
      updates.blendCanvas = BASE_CAL_BG[next];
    }
    themeStore.updateTheme(theme.id, updates);
  }

  function setSlot(index: number, hex: string) {
    const next = [...theme.eventPalette];
    next[index] = hex;
    themeStore.updateTheme(theme.id, { eventPalette: next });
  }

  const paletteIndices = Array.from({ length: PALETTE_SIZE }, (_, i) => i);

  function setAppToken(key: string, hex: string) {
    const next = { ...(theme.appTokenOverrides ?? {}), [key]: hex };
    themeStore.updateTheme(theme.id, { appTokenOverrides: next });
  }

  function clearAppToken(key: string) {
    if (!theme.appTokenOverrides) return;
    const next = { ...theme.appTokenOverrides };
    delete next[key];
    themeStore.updateTheme(theme.id, { appTokenOverrides: next });
  }

  function setCalToken(key: string, hex: string) {
    const next = { ...(theme.calendarTokenOverrides ?? {}), [key]: hex };
    const updates: Partial<Theme> = { calendarTokenOverrides: next };
    // Past event variants blend toward --cal-bg, so keep the cached
    // blendCanvas in lockstep with whatever the user picks.
    if (key === "--cal-bg") updates.blendCanvas = hex;
    themeStore.updateTheme(theme.id, updates);
  }

  function clearCalToken(key: string) {
    if (!theme.calendarTokenOverrides) return;
    const next = { ...theme.calendarTokenOverrides };
    delete next[key];
    const updates: Partial<Theme> = { calendarTokenOverrides: next };
    if (key === "--cal-bg") updates.blendCanvas = BASE_CAL_BG[theme.base];
    themeStore.updateTheme(theme.id, updates);
  }

  function readComputedToken(token: string): string {
    if (typeof document === "undefined") return "#000000";
    const computed = getComputedStyle(document.documentElement)
      .getPropertyValue(token)
      .trim();
    if (/^#[0-9a-fA-F]{6}$/.test(computed)) return computed;
    return "#000000";
  }

  async function copyJsonToClipboard() {
    try {
      await navigator.clipboard.writeText(jsonDraft);
      flashJsonNotice("JSON copied to clipboard");
    } catch (err) {
      console.error("clipboard write failed", err);
      flashJsonNotice("Could not copy JSON");
    }
  }

  async function saveJsonToFile() {
    try {
      const target = await saveDialog({
        defaultPath: `${theme.id}.json`,
        filters: THEME_FILE_FILTER,
      });
      if (!target) return;
      await invoke("vault_write_text", { path: target, contents: jsonDraft });
      flashJsonNotice("Saved to file");
    } catch (err) {
      console.error("save dialog failed", err);
      flashJsonNotice("Could not save file");
    }
  }

  function applyJsonChanges() {
    const result = themeStore.replaceTheme(theme.id, jsonDraft);
    if (!result.ok) {
      jsonErrors = result.errors;
      return;
    }
    jsonErrors = [];
    jsonDirty = false;
    flashJsonNotice("Theme updated from JSON");
  }

  function resetJsonDraft() {
    jsonDraft = themeStore.exportTheme(theme.id) ?? "";
    jsonDirty = false;
    jsonErrors = [];
  }

  function onJsonInput(e: Event) {
    jsonDraft = (e.currentTarget as HTMLTextAreaElement).value;
    jsonDirty = true;
    jsonErrors = [];
  }

  // Built-in detail view shows only overrides that the seed theme actually
  // ships with, otherwise the empty list of all 23 app tokens would dwarf
  // the meaningful content.
  const populatedAppTokens = $derived(
    theme.appTokenOverrides
      ? Object.keys(theme.appTokenOverrides).filter((k) =>
          (APP_TOKEN_KEYS as readonly string[]).includes(k),
        )
      : [],
  );
  const populatedCalTokens = $derived(
    theme.calendarTokenOverrides
      ? Object.keys(theme.calendarTokenOverrides).filter((k) =>
          (CALENDAR_TOKEN_KEYS as readonly string[]).includes(k),
        )
      : [],
  );
</script>

<div class="flex flex-col gap-6">
  <!-- Header -->
  <section class="flex flex-col gap-2">
    <button
      type="button"
      onclick={onDone}
      class="flex items-center gap-1.5 self-start rounded-md px-2 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
    >
      <ArrowLeft size={13} strokeWidth={2} />
      <span>Back to themes</span>
    </button>
    <div
      class="flex flex-col gap-3 overflow-hidden rounded-lg bg-card p-4 dark:bg-background"
    >
      <div class="flex items-center justify-between gap-3">
        {#if isBuiltin}
          {@const BaseIcon = theme.base === "dark" ? Moon : Sun}
          <div class="flex min-w-0 flex-1 items-center gap-2">
            <BaseIcon
              size={15}
              strokeWidth={1.75}
              class="shrink-0 text-muted-foreground"
            />
            <span class="truncate text-[14px] font-semibold text-foreground">
              {theme.displayName}
            </span>
          </div>
        {:else}
          <input
            type="text"
            value={theme.displayName}
            oninput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
            maxlength={60}
            aria-label="Theme name"
            class="flex-1 rounded-md border border-border bg-card px-3 py-1.5 text-[14px] font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-ring dark:bg-transparent"
          />
          <div class="flex h-8 items-center gap-0 rounded-md border border-border p-0.5">
            {#each ["light", "dark"] as const as base}
              <button
                type="button"
                onclick={() => setBase(base)}
                class={cn(
                  "rounded-sm px-3 py-1 text-[12px] font-medium transition-colors",
                  theme.base === base
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {base}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </section>

  <!-- App shell tokens -->
  {#if !isBuiltin || populatedAppTokens.length > 0}
    <section class="flex flex-col gap-2">
      <div class="flex items-center justify-between px-1">
        <h2 class="text-[13px] font-semibold text-foreground">App shell</h2>
        <span class="text-[11px] text-muted-foreground">
          {isBuiltin
            ? "Tokens this theme overrides on the app shell."
            : "Override CSS variables used across the whole app."}
        </span>
      </div>
      <div
        class="flex flex-col divide-y divide-border overflow-hidden rounded-lg bg-card dark:bg-background"
      >
        {#if isBuiltin}
          {#each populatedAppTokens as key}
            {@const value = theme.appTokenOverrides?.[key] ?? ""}
            {@const info = APP_TOKEN_INFO[key] ?? { title: humanize(key), description: "" }}
            <div class="flex items-center justify-between gap-3 px-4 py-2.5">
              <div class="min-w-0 flex-1">
                <div class="text-[12px] text-foreground">{info.title}</div>
                <div class="text-[11px] text-muted-foreground">{info.description}</div>
              </div>
              <span
                class="h-[26px] w-[26px] shrink-0 rounded-md border border-border shadow-sm"
                style="background-color: {value};"
                title={value}
              ></span>
            </div>
          {/each}
        {:else}
          {#each APP_TOKEN_KEYS as key}
            {@const override = theme.appTokenOverrides?.[key]}
            {@const info = APP_TOKEN_INFO[key] ?? { title: humanize(key), description: "" }}
            <div class="flex items-center justify-between gap-3 px-4 py-2.5">
              <div class="min-w-0 flex-1">
                <div class="text-[12px] text-foreground">{info.title}</div>
                <div class="text-[11px] text-muted-foreground">{info.description}</div>
              </div>
              <ColorField
                value={override ?? readComputedToken(key)}
                onChange={(hex) => setAppToken(key, hex)}
              />
              <button
                type="button"
                onclick={() => clearAppToken(key)}
                title={override ? "Clear override" : "No override set"}
                aria-label="Clear override"
                disabled={!override}
                class="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-card disabled:hover:text-muted-foreground dark:bg-transparent dark:disabled:hover:bg-transparent"
              >
                <X size={13} strokeWidth={2} />
              </button>
            </div>
          {/each}
        {/if}
      </div>
    </section>
  {/if}

  <!-- Event palette -->
  <section class="flex flex-col gap-2">
    <div class="flex items-center justify-between px-1">
      <h2 class="text-[13px] font-semibold text-foreground">Event palette</h2>
      <span class="text-[11px] text-muted-foreground">
        {isBuiltin
          ? "24 colors events can be tagged with."
          : "24 color slots events can be tagged with. Each slot also has a faded variant for past events, blended toward Calendar background."}
      </span>
    </div>
    <div
      class="flex flex-col gap-3 rounded-lg p-3 ring-1 ring-border"
      style="background-color: {effectiveCalBg(theme)};"
    >
      <div class="grid grid-cols-4 gap-x-2 gap-y-1.5">
        {#each paletteIndices as index}
          {@const base = theme.eventPalette[index]}
          {@const past = blendHex(
            base,
            effectiveCalBg(theme),
            theme.base === "dark" ? 0.5 : 0.3,
          )}
          {#if isBuiltin}
            <div class="flex min-w-0 items-center gap-1.5">
              <span
                class="h-[22px] w-[22px] shrink-0 rounded-md border border-border shadow-sm"
                style="background-color: {past};"
                title="Past {past}"
              ></span>
              <span
                class="h-[22px] w-[22px] shrink-0 rounded-md border border-border shadow-sm"
                style="background-color: {base};"
                title="Normal {base}"
              ></span>
              <span
                class="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground"
              >
                {base}
              </span>
            </div>
          {:else}
            <div class="flex min-w-0 items-center gap-1.5">
              <span
                class="h-[22px] w-[22px] shrink-0 rounded-md border border-border shadow-sm"
                style="background-color: {past};"
                title="Past variant {past}"
              ></span>
              <ColorField
                value={base}
                onChange={(hex) => setSlot(index, hex)}
                fluid
                swatchSize={22}
                class="min-w-0 flex-1"
              />
            </div>
          {/if}
        {/each}
      </div>
    </div>
  </section>

  <!-- Calendar tokens -->
  {#if !isBuiltin || populatedCalTokens.length > 0}
    <section class="flex flex-col gap-2">
      <div class="flex items-center justify-between px-1">
        <h2 class="text-[13px] font-semibold text-foreground">Calendar shell</h2>
        <span class="text-[11px] text-muted-foreground">
          {isBuiltin
            ? "Tokens this theme overrides on the calendar grid."
            : "Override CSS variables used inside the calendar grid."}
        </span>
      </div>
      <div
        class="flex flex-col divide-y divide-border overflow-hidden rounded-lg bg-card dark:bg-background"
      >
        {#if isBuiltin}
          {#each populatedCalTokens as key}
            {@const value = theme.calendarTokenOverrides?.[key] ?? ""}
            {@const info = CALENDAR_TOKEN_INFO[key] ?? { title: humanize(key), description: "" }}
            <div class="flex items-center justify-between gap-3 px-4 py-2.5">
              <div class="min-w-0 flex-1">
                <div class="text-[12px] text-foreground">{info.title}</div>
                <div class="text-[11px] text-muted-foreground">{info.description}</div>
              </div>
              <span
                class="h-[26px] w-[26px] shrink-0 rounded-md border border-border shadow-sm"
                style="background-color: {value};"
                title={value}
              ></span>
            </div>
          {/each}
        {:else}
          {#each CALENDAR_TOKEN_KEYS as key}
            {@const override = theme.calendarTokenOverrides?.[key]}
            {@const info = CALENDAR_TOKEN_INFO[key] ?? { title: humanize(key), description: "" }}
            <div class="flex items-center justify-between gap-3 px-4 py-2.5">
              <div class="min-w-0 flex-1">
                <div class="text-[12px] text-foreground">{info.title}</div>
                <div class="text-[11px] text-muted-foreground">{info.description}</div>
              </div>
              <ColorField
                value={override ?? readComputedToken(key)}
                onChange={(hex) => setCalToken(key, hex)}
              />
              <button
                type="button"
                onclick={() => clearCalToken(key)}
                title={override ? "Clear override" : "No override set"}
                aria-label="Clear override"
                disabled={!override}
                class="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-card disabled:hover:text-muted-foreground dark:bg-transparent dark:disabled:hover:bg-transparent"
              >
                <X size={13} strokeWidth={2} />
              </button>
            </div>
          {/each}
        {/if}
      </div>
    </section>
  {/if}

  <!-- JSON -->
  <section class="flex flex-col gap-2">
    <div class="flex items-center justify-between px-1">
      <h2 class="text-[13px] font-semibold text-foreground">JSON</h2>
      <span class="text-[11px] text-muted-foreground">
        {isBuiltin
          ? "Read-only representation of the theme."
          : "Edit the theme directly. Apply to commit your changes."}
      </span>
    </div>
    <div
      class="flex flex-col gap-2 rounded-lg bg-card p-3 dark:bg-background"
    >
      <textarea
        value={jsonDraft}
        oninput={isBuiltin ? undefined : onJsonInput}
        readonly={isBuiltin}
        spellcheck={false}
        rows={12}
        class="w-full resize-y rounded-md border border-border bg-background p-2 font-mono text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      ></textarea>
      {#if jsonErrors.length > 0}
        <ul
          class="flex flex-col gap-0.5 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive"
        >
          {#each jsonErrors as err}
            <li>{err}</li>
          {/each}
        </ul>
      {/if}
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onclick={copyJsonToClipboard}
            class="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-[11px] text-foreground transition-colors hover:bg-accent dark:bg-transparent"
          >
            <Copy size={11} strokeWidth={2.25} />
            <span>Copy JSON</span>
          </button>
          <button
            type="button"
            onclick={saveJsonToFile}
            class="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-[11px] text-foreground transition-colors hover:bg-accent dark:bg-transparent"
          >
            <Download size={11} strokeWidth={2.25} />
            <span>Save to file</span>
          </button>
        </div>
        {#if !isBuiltin}
          <div class="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onclick={resetJsonDraft}
              disabled={!jsonDirty}
              class={cn(
                "flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-[11px] transition-colors dark:bg-transparent",
                jsonDirty
                  ? "text-foreground hover:bg-accent"
                  : "cursor-not-allowed text-muted-foreground opacity-60",
              )}
            >
              <RotateCcw size={11} strokeWidth={2.25} />
              <span>Discard edits</span>
            </button>
            <button
              type="button"
              onclick={applyJsonChanges}
              disabled={!jsonDirty}
              class={cn(
                "rounded-md border border-border px-3 py-1 text-[11px] font-medium transition-colors",
                jsonDirty
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "cursor-not-allowed bg-card text-muted-foreground opacity-60 dark:bg-transparent",
              )}
            >
              Apply changes
            </button>
          </div>
        {/if}
      </div>
      {#if jsonNotice}
        <div class="text-[11px] text-muted-foreground">{jsonNotice}</div>
      {/if}
    </div>
  </section>
</div>
