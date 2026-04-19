<script lang="ts">
  import { untrack } from "svelte";
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
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
    BASE_APP_TOKENS,
    BASE_CALENDAR_TOKENS,
    CALENDAR_TOKEN_KEYS,
    type Theme,
  } from "$lib/stores/themes";
  import { getTheme } from "$lib/stores/theme.svelte";
  import ColorField from "$lib/components/ui/ColorField.svelte";

  type TokenInfo = { title: string; description: string };

  const APP_TOKEN_INFO: Record<string, TokenInfo> = {
    "--background": {
      title: "App canvas",
      description: "Visible in Settings and between panels. Most views paint their own surface over it.",
    },
    "--foreground": {
      title: "Text",
      description: "Default text color across the app.",
    },
    "--card": {
      title: "Card",
      description: "Background of grouped panels, dialogs, and tinted cards.",
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
      title: "Hover highlight",
      description: "Soft tint shown when hovering buttons and rows.",
    },
    "--accent-foreground": {
      title: "Hover highlight text",
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
      title: "Title bar",
      description: "Background of the top title bar frame.",
    },
    "--sidebar-foreground": {
      title: "Title bar text",
      description: "Default text in the title bar (tabs, labels).",
    },
    "--sidebar-accent": {
      title: "Title bar hover",
      description: "Tint applied when hovering title bar buttons.",
    },
    "--sidebar-accent-foreground": {
      title: "Title bar hover text",
      description: "Text shown on the title bar hover tint.",
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

  type SingleRow = { kind: "single"; key: string };
  type PairRow = {
    kind: "pair";
    key: string;
    fgKey: string;
    title: string;
    description: string;
  };
  type Row = SingleRow | PairRow;
  interface TokenSection {
    title: string;
    description: string;
    rows: Row[];
  }

  // Sections group tokens by the surface they affect. Paired rows render
  // background + text side-by-side because those tokens are semantically
  // linked: the foreground sibling is always used on top of its background,
  // and editing them together makes the contrast relationship obvious.
  const APP_SECTIONS: TokenSection[] = [
    {
      title: "Surfaces",
      description: "Backgrounds for panels and floating menus.",
      rows: [
        { kind: "single", key: "--background" },
        { kind: "single", key: "--card" },
        {
          kind: "pair",
          key: "--popover",
          fgKey: "--popover-foreground",
          title: "Popover",
          description:
            "Background and text of dropdowns, menus, and floating panels.",
        },
      ],
    },
    {
      title: "Title bar",
      description: "The top frame of the app window.",
      rows: [
        {
          kind: "pair",
          key: "--sidebar",
          fgKey: "--sidebar-foreground",
          title: "Title bar",
          description: "Background and default text of the top title bar frame.",
        },
        {
          kind: "pair",
          key: "--sidebar-accent",
          fgKey: "--sidebar-accent-foreground",
          title: "Title bar hover",
          description:
            "Tint and text shown when hovering buttons in the title bar.",
        },
      ],
    },
    {
      title: "Interactive",
      description: "Buttons, hover states, focus rings, and destructive actions.",
      rows: [
        {
          kind: "pair",
          key: "--primary",
          fgKey: "--primary-foreground",
          title: "Primary action",
          description: "Main accent color for highlighted buttons and links.",
        },
        {
          kind: "pair",
          key: "--secondary",
          fgKey: "--secondary-foreground",
          title: "Secondary surface",
          description: "Background and text of muted, less emphasized buttons.",
        },
        {
          kind: "pair",
          key: "--muted",
          fgKey: "--muted-foreground",
          title: "Muted surface",
          description:
            "Subtle areas like input wells, plus the default color for hint text.",
        },
        {
          kind: "pair",
          key: "--accent",
          fgKey: "--accent-foreground",
          title: "Hover highlight",
          description: "Soft tint and text shown when hovering buttons and rows.",
        },
        { kind: "single", key: "--destructive" },
        { kind: "single", key: "--ring" },
      ],
    },
    {
      title: "Text",
      description: "Default text color across the app.",
      rows: [{ kind: "single", key: "--foreground" }],
    },
  ];

  const CAL_SECTIONS: TokenSection[] = [
    {
      title: "Calendar grid",
      description: "Calendar background, headers, and time markers.",
      rows: [
        { kind: "single", key: "--cal-bg" },
        { kind: "single", key: "--cal-header-bg" },
        { kind: "single", key: "--cal-gridline" },
        {
          kind: "pair",
          key: "--cal-today-circle",
          fgKey: "--cal-today-circle-text",
          title: "Today marker",
          description:
            "Filled circle around today's date and the date number inside it.",
        },
        { kind: "single", key: "--cal-time-label" },
        { kind: "single", key: "--cal-current-time" },
      ],
    },
    {
      title: "Session rail",
      description:
        "The thin track that marks focus and break segments during a pomodoro.",
      rows: [
        { kind: "single", key: "--cal-timeline-rail" },
        { kind: "single", key: "--cal-timeline-break" },
        { kind: "single", key: "--cal-timeline-focus" },
      ],
    },
  ];

  function sectionKeys(section: TokenSection): string[] {
    return section.rows.flatMap((r) =>
      r.kind === "single" ? [r.key] : [r.key, r.fgKey],
    );
  }

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
  const BaseIcon = $derived(theme.base === "dark" ? Moon : Sun);

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

  function effectiveCalBg(t: Theme): string {
    return (
      t.calendarTokenOverrides?.["--cal-bg"] ??
      BASE_CALENDAR_TOKENS[t.base]["--cal-bg"]
    );
  }

  // The base toggle is purely a marker so the user remembers whether they
  // are crafting a light or dark theme. Flipping it MUST NOT touch any
  // colors: that would clobber edits the user already made.
  function setBase(next: "light" | "dark") {
    themeStore.updateTheme(theme.id, { base: next });
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

  function setCalToken(key: string, hex: string) {
    const next = { ...(theme.calendarTokenOverrides ?? {}), [key]: hex };
    const updates: Partial<Theme> = { calendarTokenOverrides: next };
    // Past event variants blend toward --cal-bg, so keep the cached
    // blendCanvas in lockstep with whatever the user picks.
    if (key === "--cal-bg") updates.blendCanvas = hex;
    themeStore.updateTheme(theme.id, updates);
  }

  // Seed helpers: the value a row should restore to on Reset. For themes
  // created via duplicate, the seed snapshot captures the source's resolved
  // tokens at clone time, so reset restores the SOURCE colors, not the
  // built-in defaults. Imported themes that ship without seeds fall back
  // to the base CSS defaults.
  function appSeed(key: string): string {
    return theme.seedAppTokens?.[key] ?? BASE_APP_TOKENS[theme.base][key];
  }

  function calSeed(key: string): string {
    return (
      theme.seedCalendarTokens?.[key] ?? BASE_CALENDAR_TOKENS[theme.base][key]
    );
  }

  function resetAppToken(key: string) {
    setAppToken(key, appSeed(key));
  }

  function resetCalToken(key: string) {
    setCalToken(key, calSeed(key));
  }

  function appCanReset(key: string): boolean {
    const override = theme.appTokenOverrides?.[key];
    if (override === undefined) return false;
    return override.toLowerCase() !== appSeed(key).toLowerCase();
  }

  function calCanReset(key: string): boolean {
    const override = theme.calendarTokenOverrides?.[key];
    if (override === undefined) return false;
    return override.toLowerCase() !== calSeed(key).toLowerCase();
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
      <div class="flex items-center gap-2">
        {#if isBuiltin}
          <BaseIcon
            size={15}
            strokeWidth={1.75}
            aria-label="{theme.base} theme"
            class="shrink-0 text-muted-foreground"
          />
          <span class="truncate text-[14px] font-semibold text-foreground">
            {theme.displayName}
          </span>
        {:else}
          <button
            type="button"
            onclick={() => setBase(theme.base === "dark" ? "light" : "dark")}
            aria-label="Flip scheme marker (currently {theme.base})"
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <BaseIcon size={14} strokeWidth={1.75} />
          </button>
          <input
            type="text"
            value={theme.displayName}
            oninput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
            maxlength={60}
            aria-label="Theme name"
            class="min-w-0 flex-1 rounded-md border border-border bg-card px-3 py-1.5 text-[14px] font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-ring dark:bg-transparent"
          />
        {/if}
      </div>
    </div>
  </section>

  {#snippet appSingleRow(key: string)}
    {@const info = APP_TOKEN_INFO[key] ?? { title: humanize(key), description: "" }}
    <div class="flex items-center justify-between gap-3 px-4 py-2.5">
      <div class="min-w-0 flex-1">
        <div class="text-[12px] text-foreground">{info.title}</div>
        <div class="text-[11px] text-muted-foreground">{info.description}</div>
      </div>
      <ColorField
        value={theme.appTokenOverrides?.[key] ?? appSeed(key)}
        onChange={(hex) => setAppToken(key, hex)}
        onReset={() => resetAppToken(key)}
        canReset={appCanReset(key)}
        label={info.title}
      />
    </div>
  {/snippet}

  {#snippet appPairRow(row: PairRow)}
    <div class="flex items-center justify-between gap-3 px-4 py-2.5">
      <div class="min-w-0 flex-1">
        <div class="text-[12px] text-foreground">{row.title}</div>
        <div class="text-[11px] text-muted-foreground">{row.description}</div>
      </div>
      <div class="flex shrink-0 items-center gap-3">
        <div class="flex items-center gap-1.5">
          <span
            class="text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
          >Bg</span>
          <ColorField
            value={theme.appTokenOverrides?.[row.key] ?? appSeed(row.key)}
            onChange={(hex) => setAppToken(row.key, hex)}
            onReset={() => resetAppToken(row.key)}
            canReset={appCanReset(row.key)}
            label="{row.title} background"
          />
        </div>
        <div class="flex items-center gap-1.5">
          <span
            class="text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
          >Text</span>
          <ColorField
            value={theme.appTokenOverrides?.[row.fgKey] ?? appSeed(row.fgKey)}
            onChange={(hex) => setAppToken(row.fgKey, hex)}
            onReset={() => resetAppToken(row.fgKey)}
            canReset={appCanReset(row.fgKey)}
            label="{row.title} text"
          />
        </div>
      </div>
    </div>
  {/snippet}

  {#snippet appBuiltinSwatch(key: string)}
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
  {/snippet}

  <!-- App shell tokens -->
  {#each APP_SECTIONS as section}
    {@const keys = sectionKeys(section)}
    {@const populated = keys.filter((k) => populatedAppTokens.includes(k))}
    {#if !isBuiltin || populated.length > 0}
      <section class="flex flex-col gap-2">
        <div class="flex items-center justify-between gap-3 px-1">
          <h2 class="text-[13px] font-semibold text-foreground">{section.title}</h2>
          <span class="text-[11px] text-muted-foreground">{section.description}</span>
        </div>
        <div
          class="flex flex-col divide-y divide-border overflow-hidden rounded-lg bg-card dark:bg-background"
        >
          {#if isBuiltin}
            {#each populated as key}
              {@render appBuiltinSwatch(key)}
            {/each}
          {:else}
            {#each section.rows as row}
              {#if row.kind === "single"}
                {@render appSingleRow(row.key)}
              {:else}
                {@render appPairRow(row)}
              {/if}
            {/each}
          {/if}
        </div>
      </section>
    {/if}
  {/each}

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

  {#snippet calSingleRow(key: string)}
    {@const info = CALENDAR_TOKEN_INFO[key] ?? { title: humanize(key), description: "" }}
    <div class="flex items-center justify-between gap-3 px-4 py-2.5">
      <div class="min-w-0 flex-1">
        <div class="text-[12px] text-foreground">{info.title}</div>
        <div class="text-[11px] text-muted-foreground">{info.description}</div>
      </div>
      <ColorField
        value={theme.calendarTokenOverrides?.[key] ?? calSeed(key)}
        onChange={(hex) => setCalToken(key, hex)}
        onReset={() => resetCalToken(key)}
        canReset={calCanReset(key)}
        label={info.title}
      />
    </div>
  {/snippet}

  {#snippet calPairRow(row: PairRow)}
    <div class="flex items-center justify-between gap-3 px-4 py-2.5">
      <div class="min-w-0 flex-1">
        <div class="text-[12px] text-foreground">{row.title}</div>
        <div class="text-[11px] text-muted-foreground">{row.description}</div>
      </div>
      <div class="flex shrink-0 items-center gap-3">
        <div class="flex items-center gap-1.5">
          <span
            class="text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
          >Bg</span>
          <ColorField
            value={theme.calendarTokenOverrides?.[row.key] ?? calSeed(row.key)}
            onChange={(hex) => setCalToken(row.key, hex)}
            onReset={() => resetCalToken(row.key)}
            canReset={calCanReset(row.key)}
            label="{row.title} background"
          />
        </div>
        <div class="flex items-center gap-1.5">
          <span
            class="text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
          >Text</span>
          <ColorField
            value={theme.calendarTokenOverrides?.[row.fgKey] ?? calSeed(row.fgKey)}
            onChange={(hex) => setCalToken(row.fgKey, hex)}
            onReset={() => resetCalToken(row.fgKey)}
            canReset={calCanReset(row.fgKey)}
            label="{row.title} text"
          />
        </div>
      </div>
    </div>
  {/snippet}

  {#snippet calBuiltinSwatch(key: string)}
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
  {/snippet}

  <!-- Calendar tokens -->
  {#each CAL_SECTIONS as section}
    {@const keys = sectionKeys(section)}
    {@const populated = keys.filter((k) => populatedCalTokens.includes(k))}
    {#if !isBuiltin || populated.length > 0}
      <section class="flex flex-col gap-2">
        <div class="flex items-center justify-between gap-3 px-1">
          <h2 class="text-[13px] font-semibold text-foreground">{section.title}</h2>
          <span class="text-[11px] text-muted-foreground">{section.description}</span>
        </div>
        <div
          class="flex flex-col divide-y divide-border overflow-hidden rounded-lg bg-card dark:bg-background"
        >
          {#if isBuiltin}
            {#each populated as key}
              {@render calBuiltinSwatch(key)}
            {/each}
          {:else}
            {#each section.rows as row}
              {#if row.kind === "single"}
                {@render calSingleRow(row.key)}
              {:else}
                {@render calPairRow(row)}
              {/if}
            {/each}
          {/if}
        </div>
      </section>
    {/if}
  {/each}

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
