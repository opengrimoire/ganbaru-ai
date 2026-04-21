<script lang="ts">
  import { untrack } from "svelte";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import ChevronUp from "@lucide/svelte/icons/chevron-up";
  import Copy from "@lucide/svelte/icons/copy";
  import Download from "@lucide/svelte/icons/download";
  import Link2 from "@lucide/svelte/icons/link-2";
  import Moon from "@lucide/svelte/icons/moon";
  import Pencil from "@lucide/svelte/icons/pencil";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import Sun from "@lucide/svelte/icons/sun";
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
    deriveAppTokens,
    deriveCalendarTokens,
    resolveAppTokens,
    resolveCalendarTokens,
    type Theme,
    type ThemeSources,
  } from "$lib/stores/themes";
  import { getTheme } from "$lib/stores/theme.svelte";
  import ColorField from "$lib/components/ui/ColorField.svelte";

  type TokenInfo = { title: string; description: string };

  const APP_TOKEN_INFO: Record<string, TokenInfo> = {
    "--background": {
      title: "App canvas",
      description:
        "Visible in Settings and between panels. Most views paint their own surface over it.",
    },
    "--foreground": {
      title: "Text color",
      description: "Applied to text across the app.",
    },
    "--card": {
      title: "Card",
      description: "Background of grouped panels, dialogs, and tinted cards.",
    },
    "--primary": {
      title: "Primary action",
      description: "Main accent color for highlighted buttons and links.",
    },
    "--primary-foreground": {
      title: "Button text",
      description: "Text on primary buttons.",
    },
    "--destructive": {
      title: "Destructive",
      description: "Color used for delete actions and warnings.",
    },
    "--ring": {
      title: "Focus ring",
      description: "Outline shown around focused inputs and buttons.",
    },
    "--event-panel-bg": {
      title: "Event panel surface",
      description:
        "Background of the event creation/edit panel opened from the calendar.",
    },
    "--event-panel-contrast": {
      title: "Event panel section header",
      description:
        "Background strip behind section rows (location, recurrence, pomodoro, etc.).",
    },
    "--event-panel-edge": {
      title: "Event panel edge",
      description: "Outer border tint around the event panel. Accepts alpha.",
    },
    "--event-panel-shadow": {
      title: "Event panel shadow",
      description: "Drop shadow beneath the event panel. Accepts alpha.",
    },
    "--event-panel-divider": {
      title: "Event panel divider",
      description: "Thin separator line under the title input.",
    },
    "--event-panel-input-text": {
      title: "Event panel input text",
      description: "Text color inside numeric and text inputs within the panel.",
    },
    "--event-panel-placeholder": {
      title: "Event panel placeholder",
      description: "Placeholder text color in the title and other inputs.",
    },
    "--event-panel-text": {
      title: "Event panel body text",
      description:
        "Default text color used across the event panel surface. Overrides --foreground inside the panel.",
    },
    "--event-panel-muted-text": {
      title: "Event panel muted text",
      description:
        "Secondary text color inside the panel (captions, hints, inactive rows).",
    },
    "--form-indicator": {
      title: "Form indicator",
      description:
        "Filled dot inside radio/checkbox pills in calendar sub-sections (recurrence, notifications, pomodoro).",
    },
    "--action-confirm": {
      title: "Confirm action",
      description:
        "Background of the Save button and the active scope selector pill in the event panel.",
    },
    "--action-confirm-foreground": {
      title: "Confirm action text",
      description: "Text color on the Save button and active scope pill.",
    },
    "--action-danger-armed": {
      title: "Armed delete",
      description:
        "Background of the delete button once it has been armed (click-again-to-confirm state).",
    },
    "--status-accepted": {
      title: "Accepted attendee",
      description: "Status tile color for accepted attendees on a calendar event.",
    },
    "--status-tentative": {
      title: "Tentative attendee",
      description: "Status tile color for tentative attendees on a calendar event.",
    },
    "--status-declined": {
      title: "Declined attendee",
      description: "Status tile color for declined attendees on a calendar event.",
    },
    "--priority-easy": {
      title: "Easy priority",
      description:
        "Kanban badge color for easy-difficulty tasks. Applied as a tint for background and solid for text.",
    },
    "--priority-medium": {
      title: "Medium priority",
      description:
        "Kanban badge color for medium-difficulty tasks. Applied as a tint for background and solid for text.",
    },
    "--priority-hard": {
      title: "Hard priority",
      description:
        "Kanban badge color for hard-difficulty tasks. Applied as a tint for background and solid for text.",
    },
    "--priority-epic": {
      title: "Epic priority",
      description:
        "Kanban badge color for epic-difficulty tasks. Applied as a tint for background and solid for text.",
    },
    "--pomodoro-idle-text": {
      title: "Pomodoro idle caption",
      description:
        "Caption text shown over the dark idle overlay during a paused focus session.",
    },
    "--cal-color-picker-outline": {
      title: "Event color outline",
      description:
        "Outline drawn around the selected swatch inside the event color picker.",
    },
    "--cal-description-editor-bg": {
      title: "Description editor tint",
      description:
        "Background wash on the event description editor while in edit mode. Accepts alpha.",
    },
    "--cal-drag-preview-border": {
      title: "All-day drag preview border",
      description:
        "Border around the ghost tile shown while dragging an all-day event on the calendar. Accepts alpha.",
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

  type GroupSingleRow = { kind: "single"; key: string; scope: "app" | "cal" };
  type GroupPairRow = {
    kind: "pair";
    bg: string;
    fg: string;
    title: string;
    description: string;
    scope: "app" | "cal";
  };
  type GroupRow = GroupSingleRow | GroupPairRow;
  type SourceGroup = {
    sourceKey: keyof ThemeSources | null;
    title: string;
    description: string;
    rows: GroupRow[];
  };

  // Three-tier layout the user edits top-to-bottom:
  //
  //   Tier 1 (App foundation): the four shell sources every surface reads
  //   from, ordered canvas then ink then primary then destructive.
  //
  //   Tier 2 (Semantic signals): positive and cautionary accents that
  //   communicate intent across buttons and status tiles.
  //
  //   Tier 3 (Per-feature): colors scoped to a single feature (calendar,
  //   event panel, kanban). Calendar canvas and its semantic details live
  //   adjacent so all calendar editing happens in one place.
  //
  // Collapse button is gated on (sourceKey != null && rows.length > 1):
  // only source-driven multi-row groups benefit from the accordion, since
  // the header's ColorField is the "change everything together" affordance.
  // Sourceless groups show all rows inline; source-driven single-row groups
  // render the row as a peer of the source via groupHeaderStyleRow.
  const SOURCE_GROUPS: SourceGroup[] = [
    // Tier 1: App foundation
    {
      sourceKey: "canvas",
      title: "App canvas",
      description:
        "Dominant background color. Most surfaces tint automatically from it.",
      rows: [
        { kind: "single", key: "--background", scope: "app" },
        { kind: "single", key: "--card", scope: "app" },
        {
          kind: "pair",
          bg: "--popover",
          fg: "--popover-foreground",
          title: "Popover",
          description: "Dropdowns, menus, and floating panels.",
          scope: "app",
        },
        {
          kind: "pair",
          bg: "--secondary",
          fg: "--secondary-foreground",
          title: "Secondary surface",
          description: "Less emphasized buttons.",
          scope: "app",
        },
        {
          kind: "pair",
          bg: "--muted",
          fg: "--muted-foreground",
          title: "Muted surface",
          description: "Subtle wells and the default hint-text color.",
          scope: "app",
        },
        {
          kind: "pair",
          bg: "--accent",
          fg: "--accent-foreground",
          title: "Hover highlight",
          description: "Soft tint shown when hovering rows and buttons.",
          scope: "app",
        },
        { kind: "single", key: "--ring", scope: "app" },
        {
          kind: "pair",
          bg: "--sidebar",
          fg: "--sidebar-foreground",
          title: "Title bar",
          description: "Top frame of the app window.",
          scope: "app",
        },
        {
          kind: "pair",
          bg: "--sidebar-accent",
          fg: "--sidebar-accent-foreground",
          title: "Title bar hover",
          description: "Tint shown when hovering title bar buttons.",
          scope: "app",
        },
      ],
    },
    {
      sourceKey: "ink",
      title: "Ink",
      description:
        "Base text color. Drives body text, form indicators, and secondary captions.",
      rows: [
        { kind: "single", key: "--foreground", scope: "app" },
        { kind: "single", key: "--form-indicator", scope: "app" },
        { kind: "single", key: "--pomodoro-idle-text", scope: "app" },
      ],
    },
    {
      sourceKey: "primary",
      title: "Primary action",
      description: "Accent for highlighted buttons and links.",
      rows: [{ kind: "single", key: "--primary-foreground", scope: "app" }],
    },
    {
      sourceKey: "destructive",
      title: "Destructive",
      description:
        "Danger signal. Drives delete buttons, the armed-delete state, and the declined attendance tile.",
      rows: [
        { kind: "single", key: "--destructive", scope: "app" },
        { kind: "single", key: "--action-danger-armed", scope: "app" },
        { kind: "single", key: "--status-declined", scope: "app" },
      ],
    },
    // Tier 2: Semantic signals
    {
      sourceKey: "confirm",
      title: "Confirm",
      description:
        "Positive signal. Drives the save button, the active scope pill, and the accepted attendance tile.",
      rows: [
        {
          kind: "pair",
          bg: "--action-confirm",
          fg: "--action-confirm-foreground",
          title: "Confirm action button",
          description:
            "Save button and the active scope pill on the event panel.",
          scope: "app",
        },
        { kind: "single", key: "--status-accepted", scope: "app" },
      ],
    },
    {
      sourceKey: "warning",
      title: "Warning",
      description:
        "Caution signal. Drives the tentative attendance tile; reserved for future notification warnings and deadlines.",
      rows: [{ kind: "single", key: "--status-tentative", scope: "app" }],
    },
    // Tier 3: Per-feature
    {
      sourceKey: "calCanvas",
      title: "Calendar canvas",
      description:
        "Background of the calendar grid. Gridlines and time labels tint from it.",
      rows: [
        { kind: "single", key: "--cal-bg", scope: "cal" },
        { kind: "single", key: "--cal-header-bg", scope: "cal" },
        { kind: "single", key: "--cal-gridline", scope: "cal" },
        { kind: "single", key: "--cal-time-label", scope: "cal" },
        { kind: "single", key: "--cal-timeline-rail", scope: "cal" },
      ],
    },
    {
      sourceKey: null,
      title: "Calendar details",
      description:
        "Semantic markers and accents on the calendar grid. Each edits independently.",
      rows: [
        {
          kind: "pair",
          bg: "--cal-today-circle",
          fg: "--cal-today-circle-text",
          title: "Today marker",
          description:
            "Filled circle around today's date and the number inside.",
          scope: "cal",
        },
        { kind: "single", key: "--cal-current-time", scope: "cal" },
        { kind: "single", key: "--cal-timeline-break", scope: "cal" },
        { kind: "single", key: "--cal-timeline-focus", scope: "cal" },
        { kind: "single", key: "--cal-color-picker-outline", scope: "app" },
        { kind: "single", key: "--cal-description-editor-bg", scope: "app" },
        { kind: "single", key: "--cal-drag-preview-border", scope: "app" },
      ],
    },
    {
      sourceKey: null,
      title: "Event panel",
      description:
        "Surfaces on the event creation and edit panel opened from the calendar.",
      rows: [
        { kind: "single", key: "--event-panel-bg", scope: "app" },
        { kind: "single", key: "--event-panel-contrast", scope: "app" },
        { kind: "single", key: "--event-panel-edge", scope: "app" },
        { kind: "single", key: "--event-panel-shadow", scope: "app" },
        { kind: "single", key: "--event-panel-divider", scope: "app" },
        { kind: "single", key: "--event-panel-input-text", scope: "app" },
        { kind: "single", key: "--event-panel-placeholder", scope: "app" },
        { kind: "single", key: "--event-panel-text", scope: "app" },
        { kind: "single", key: "--event-panel-muted-text", scope: "app" },
      ],
    },
    {
      sourceKey: null,
      title: "Task priority",
      description:
        "Kanban badge colors per difficulty tier. Each token tints the badge background and colors the label text.",
      rows: [
        { kind: "single", key: "--priority-easy", scope: "app" },
        { kind: "single", key: "--priority-medium", scope: "app" },
        { kind: "single", key: "--priority-hard", scope: "app" },
        { kind: "single", key: "--priority-epic", scope: "app" },
      ],
    },
  ];

  // Calendar tokens the derivation engine can compute from sources.
  // Semantic tokens (today marker, current time, rail break/focus) are not
  // in this set and fall through to overrides or base CSS.
  const CAL_DERIVED_KEYS: ReadonlySet<string> = new Set([
    "--cal-bg",
    "--cal-header-bg",
    "--cal-gridline",
    "--cal-time-label",
    "--cal-timeline-rail",
  ]);

  let { theme }: { theme: Theme } = $props();

  const themeStore = getTheme();
  const THEME_FILE_FILTER = [{ name: "Theme JSON", extensions: ["json"] }];

  const isBuiltin = $derived(themeStore.isBuiltin(theme.id));
  const BaseIcon = $derived(theme.base === "dark" ? Moon : Sun);

  // Input seeds drive per-token reset. They are captured on every modern
  // clone, so seedSources existing is the signal that the theme was cloned
  // after the seed feature shipped and can be reset at the row level.
  const hasSeeds = $derived(theme.seedSources !== undefined);

  // Collapse state is ephemeral (not persisted across sessions). Only
  // source-driven multi-row groups are collapsible: the source color at the
  // header is the "change everything together" affordance that gives the
  // accordion a purpose. Sourceless groups show every row inline, and
  // single-row source groups render the row as a peer of the header.
  let collapsed = $state<Record<string, boolean>>(
    untrack(() =>
      Object.fromEntries(
        SOURCE_GROUPS.filter(
          (g) => g.sourceKey !== null && g.rows.length > 1,
        ).map((g) => [g.title, true]),
      ),
    ),
  );

  function toggleGroup(title: string) {
    collapsed[title] = !collapsed[title];
  }

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
    return resolveCalendarTokens(t)["--cal-bg"];
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

  function setSource(key: keyof ThemeSources, hex: string) {
    if (!theme.sources) return;
    const nextSources: ThemeSources = { ...theme.sources, [key]: hex };
    const updates: Partial<Omit<Theme, "id">> = { sources: nextSources };
    // Past event variants blend against the calendar canvas; when that canvas
    // is derived from sources.calCanvas, the blend reference has to follow.
    if (key === "calCanvas" && !theme.calendarTokenOverrides?.["--cal-bg"]) {
      updates.blendCanvas = hex;
    }
    themeStore.updateTheme(theme.id, updates);
  }

  // Sample the seven source values from the theme's currently resolved
  // tokens so turning Quick colors on does not visually change anything up
  // front; the user sees the same palette with a new relationship attached.
  // Confirm and warning sample the tokens they identity-drive so built-in
  // clones keep their accepted/tentative colors intact.
  function enableSources() {
    if (theme.sources) return;
    const resolvedApp = resolveAppTokens(theme);
    const resolvedCal = resolveCalendarTokens(theme);
    const sources: ThemeSources = {
      canvas: resolvedApp["--background"],
      ink: resolvedApp["--foreground"],
      primary: resolvedApp["--primary"],
      destructive: resolvedApp["--destructive"],
      confirm: resolvedApp["--action-confirm"],
      warning: resolvedApp["--status-tentative"],
      calCanvas: resolvedCal["--cal-bg"],
    };
    themeStore.updateTheme(theme.id, { sources });
  }

  // Auto value for a token: what it resolves to when no override is set.
  // Matches the three-layer resolver's bottom two layers (derived or
  // default), skipping the override layer the caller is comparing against.
  function autoValueApp(key: string): string {
    if (theme.sources) {
      const derived = deriveAppTokens(theme.sources, theme.base);
      if (derived[key] !== undefined) return derived[key];
    }
    return BASE_APP_TOKENS[theme.base][key];
  }

  function autoValueCal(key: string): string {
    if (theme.sources) {
      const derived = deriveCalendarTokens(theme.sources, theme.base);
      if (derived[key] !== undefined) return derived[key];
    }
    return BASE_CALENDAR_TOKENS[theme.base][key];
  }

  // Isolating a token captures the current auto value as an explicit override
  // so the user can edit it independently of the source. Visually the row
  // swaps its readonly swatch + Isolated-edit button for a ColorField + Link-back.
  function isolateAppToken(key: string) {
    setAppToken(key, autoValueApp(key));
  }

  function isolateCalToken(key: string) {
    setCalToken(key, autoValueCal(key));
  }

  function relinkAppToken(key: string) {
    const next = { ...(theme.appTokenOverrides ?? {}) };
    delete next[key];
    themeStore.updateTheme(theme.id, { appTokenOverrides: next });
  }

  function relinkCalToken(key: string) {
    const next = { ...(theme.calendarTokenOverrides ?? {}) };
    delete next[key];
    const updates: Partial<Theme> = { calendarTokenOverrides: next };
    // Relinking cal-bg means the derived calCanvas drives it; keep blendCanvas
    // aligned so past event variants blend correctly.
    if (key === "--cal-bg" && theme.sources) {
      const derived = deriveCalendarTokens(theme.sources, theme.base);
      updates.blendCanvas = derived["--cal-bg"] ?? theme.blendCanvas;
    }
    themeStore.updateTheme(theme.id, updates);
  }

  // Per-token reset restores a single control back to the value it had when
  // the theme was cloned. A source channel is reset to its seed value; an
  // app/cal token is either reset to its seed override or relinked when the
  // seed had no override for it. Gating on hasSeeds keeps legacy themes
  // (cloned before the seed feature) without reset affordances.
  function canResetSource(key: keyof ThemeSources): boolean {
    if (!theme.sources || !theme.seedSources) return false;
    return theme.sources[key] !== theme.seedSources[key];
  }

  function resetSource(key: keyof ThemeSources) {
    if (!theme.sources || !theme.seedSources) return;
    const seedValue = theme.seedSources[key];
    const nextSources: ThemeSources = { ...theme.sources, [key]: seedValue };
    const updates: Partial<Omit<Theme, "id">> = { sources: nextSources };
    if (key === "calCanvas" && !theme.calendarTokenOverrides?.["--cal-bg"]) {
      updates.blendCanvas = seedValue;
    }
    themeStore.updateTheme(theme.id, updates);
  }

  function canResetAppToken(key: string): boolean {
    if (!hasSeeds) return false;
    const current = theme.appTokenOverrides?.[key];
    const seed = theme.seedAppTokenOverrides?.[key];
    return current !== seed;
  }

  function resetAppToken(key: string) {
    const seed = theme.seedAppTokenOverrides?.[key];
    if (seed === undefined) relinkAppToken(key);
    else setAppToken(key, seed);
  }

  function canResetCalToken(key: string): boolean {
    if (!hasSeeds) return false;
    const current = theme.calendarTokenOverrides?.[key];
    const seed = theme.seedCalendarTokenOverrides?.[key];
    return current !== seed;
  }

  function resetCalToken(key: string) {
    const seed = theme.seedCalendarTokenOverrides?.[key];
    if (seed === undefined) relinkCalToken(key);
    else setCalToken(key, seed);
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
  // ships with, otherwise the empty list of all app tokens would dwarf the
  // meaningful content.
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

  function tokenInfo(row: GroupSingleRow): TokenInfo {
    const lookup =
      row.scope === "app" ? APP_TOKEN_INFO : CALENDAR_TOKEN_INFO;
    return lookup[row.key] ?? { title: humanize(row.key), description: "" };
  }
</script>

<div class="flex flex-col gap-6">
  <!-- Header -->
  <section class="flex flex-col gap-2">
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
            class="min-w-0 flex-1 rounded-md border border-border bg-card px-3 py-1.5 text-[14px] font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        {/if}
      </div>
    </div>
  </section>

  {#snippet resetIconButton(
    onClick: () => void,
    label: string,
    canReset: boolean,
  )}
    <button
      type="button"
      onclick={onClick}
      disabled={!canReset}
      aria-label="Reset {label} to its original value"
      title={canReset ? "Restore original value" : "Already at original value"}
      class={cn(
        "flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors",
        canReset
          ? "hover:border-foreground/30 hover:bg-accent hover:text-foreground"
          : "cursor-not-allowed opacity-40",
      )}
    >
      <RotateCcw size={11} strokeWidth={2.25} />
    </button>
  {/snippet}

  {#snippet tokenEditor(
    key: string,
    scope: "app" | "cal",
    ariaLabel: string,
  )}
    {@const overrideMap =
      scope === "app" ? theme.appTokenOverrides : theme.calendarTokenOverrides}
    {@const pinnedVal = overrideMap?.[key]}
    {@const isLinked = pinnedVal === undefined}
    {@const displayVal = isLinked
      ? scope === "app"
        ? autoValueApp(key)
        : autoValueCal(key)
      : pinnedVal}
    {@const canResetRow =
      scope === "app" ? canResetAppToken(key) : canResetCalToken(key)}
    <div class="flex items-center gap-1.5">
      <ColorField
        value={displayVal}
        onChange={(hex) => {
          if (isLinked) return;
          if (scope === "app") setAppToken(key, hex);
          else setCalToken(key, hex);
        }}
        readOnly={isLinked}
        label={ariaLabel}
      />
      {@render resetIconButton(
        () => {
          if (scope === "app") resetAppToken(key);
          else resetCalToken(key);
        },
        ariaLabel,
        canResetRow,
      )}
      {#if isLinked}
        <button
          type="button"
          onclick={() => {
            if (scope === "app") isolateAppToken(key);
            else isolateCalToken(key);
          }}
          aria-label="Isolated edit {ariaLabel}"
          title="Edit this color independently of its source"
          class="flex min-w-[108px] shrink-0 items-center justify-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-accent hover:text-foreground"
        >
          <Pencil size={10} strokeWidth={2.25} />
          <span>Isolated edit</span>
        </button>
      {:else}
        <button
          type="button"
          onclick={() => {
            if (scope === "app") relinkAppToken(key);
            else relinkCalToken(key);
          }}
          aria-label="Link back {ariaLabel} to its source"
          title="Re-link this color to its source"
          class="flex min-w-[108px] shrink-0 items-center justify-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-accent hover:text-foreground"
        >
          <Link2 size={10} strokeWidth={2.25} />
          <span>Link back</span>
        </button>
      {/if}
    </div>
  {/snippet}

  {#snippet groupSingleRow(row: GroupSingleRow)}
    {@const info = tokenInfo(row)}
    <div class="flex items-center justify-between gap-3 px-4 py-2.5">
      <div class="min-w-0 flex-1">
        <div class="text-[12px] text-foreground">{info.title}</div>
        <div class="text-[11px] text-muted-foreground">{info.description}</div>
      </div>
      {@render tokenEditor(row.key, row.scope, info.title)}
    </div>
  {/snippet}

  <!-- Peer-styled sub-row for single-row groups (Ink, Primary action).
       Mirrors the source header layout so the driven token reads as a peer
       of the source it tints. Always editable: writing to it creates or
       updates the override; reset falls back through the seed per the
       shared per-row reset semantics. -->
  {#snippet groupHeaderStyleRow(row: GroupSingleRow)}
    {@const info = tokenInfo(row)}
    {@const overrideMap =
      row.scope === "app" ? theme.appTokenOverrides : theme.calendarTokenOverrides}
    {@const pinnedVal = overrideMap?.[row.key]}
    {@const isLinked = pinnedVal === undefined}
    {@const displayVal = isLinked
      ? row.scope === "app"
        ? autoValueApp(row.key)
        : autoValueCal(row.key)
      : pinnedVal}
    {@const canResetRow =
      row.scope === "app"
        ? canResetAppToken(row.key)
        : canResetCalToken(row.key)}
    <div class="flex items-center justify-between gap-3 px-4 py-2.5">
      <div class="min-w-0 flex-1">
        <div class="text-[13px] font-semibold text-foreground">{info.title}</div>
        <div class="text-[11px] text-muted-foreground">{info.description}</div>
      </div>
      <div class="flex shrink-0 items-center gap-1.5">
        <ColorField
          value={displayVal}
          onChange={(hex) => {
            if (row.scope === "app") setAppToken(row.key, hex);
            else setCalToken(row.key, hex);
          }}
          label={info.title}
        />
        {@render resetIconButton(
          () => {
            if (row.scope === "app") resetAppToken(row.key);
            else resetCalToken(row.key);
          },
          info.title,
          canResetRow,
        )}
        <div class="min-w-[108px] shrink-0" aria-hidden="true"></div>
      </div>
    </div>
  {/snippet}

  {#snippet groupPairRow(row: GroupPairRow)}
    <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5">
      <div class="min-w-0 flex-1">
        <div class="text-[12px] text-foreground">{row.title}</div>
        <div class="text-[11px] text-muted-foreground">{row.description}</div>
      </div>
      <div class="flex shrink-0 flex-col items-end gap-2">
        <div class="flex items-center gap-1.5">
          <span
            class="w-[34px] text-right text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
          >
            Bg
          </span>
          {@render tokenEditor(row.bg, row.scope, `${row.title} background`)}
        </div>
        <div class="flex items-center gap-1.5">
          <span
            class="w-[34px] text-right text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
          >
            Text
          </span>
          {@render tokenEditor(row.fg, row.scope, `${row.title} text`)}
        </div>
      </div>
    </div>
  {/snippet}

  {#snippet groupCard(group: SourceGroup)}
    {@const isCollapsible = group.sourceKey !== null && group.rows.length > 1}
    {@const isCollapsed = isCollapsible && collapsed[group.title] === true}
    {@const showRows = group.rows.length > 0 && (!isCollapsible || !isCollapsed)}
    <section
      class="overflow-hidden rounded-lg ring-1 ring-border bg-card dark:bg-background"
    >
      <header class="flex items-center justify-between gap-3 px-4 py-2.5">
        <div class="min-w-0 flex-1">
          <div class="text-[13px] font-semibold text-foreground">
            {group.title}
          </div>
          <div class="text-[11px] text-muted-foreground">
            {group.description}
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-1.5">
          {#if group.sourceKey !== null && theme.sources}
            {@const sourceKey = group.sourceKey}
            <ColorField
              value={theme.sources[sourceKey]}
              onChange={(hex) => setSource(sourceKey, hex)}
              label="{group.title} source"
            />
            {@render resetIconButton(
              () => resetSource(sourceKey),
              group.title,
              canResetSource(sourceKey),
            )}
          {/if}
          {#if isCollapsible}
            <button
              type="button"
              onclick={() => toggleGroup(group.title)}
              aria-expanded={!isCollapsed}
              aria-label="{isCollapsed
                ? 'Expand'
                : 'Collapse'} {group.title} options"
              class="flex min-w-[108px] shrink-0 items-center justify-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-accent hover:text-foreground"
            >
              {#if isCollapsed}
                <ChevronDown size={11} strokeWidth={2.25} />
                <span>EXPAND</span>
                <ChevronDown size={11} strokeWidth={2.25} />
              {:else}
                <ChevronUp size={11} strokeWidth={2.25} />
                <span>COLLAPSE</span>
                <ChevronUp size={11} strokeWidth={2.25} />
              {/if}
            </button>
          {:else}
            <div class="min-w-[108px] shrink-0" aria-hidden="true"></div>
          {/if}
        </div>
      </header>
      {#if showRows}
        <div class="divide-y divide-border border-t border-border">
          {#if group.sourceKey !== null && group.rows.length === 1 && group.rows[0].kind === "single"}
            {@render groupHeaderStyleRow(group.rows[0])}
          {:else}
            {#each group.rows as row (row.kind === "single" ? row.key : row.bg)}
              {#if row.kind === "single"}
                {@render groupSingleRow(row)}
              {:else}
                {@render groupPairRow(row)}
              {/if}
            {/each}
          {/if}
        </div>
      {/if}
    </section>
  {/snippet}

  {#snippet appBuiltinSwatch(key: string)}
    {@const value = theme.appTokenOverrides?.[key] ?? ""}
    {@const info =
      APP_TOKEN_INFO[key] ?? { title: humanize(key), description: "" }}
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

  {#snippet calBuiltinSwatch(key: string)}
    {@const value = theme.calendarTokenOverrides?.[key] ?? ""}
    {@const info =
      CALENDAR_TOKEN_INFO[key] ?? { title: humanize(key), description: "" }}
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

  <!-- Body: built-in swatches, grouped editor for source-bearing user themes,
       or a Set up Quick colors CTA for legacy source-less user themes. -->
  {#if isBuiltin}
    {#if populatedAppTokens.length > 0}
      <section class="flex flex-col gap-2">
        <div class="flex items-center justify-between gap-3 px-1">
          <h2 class="text-[13px] font-semibold text-foreground">
            App shell overrides
          </h2>
        </div>
        <div
          class="flex flex-col divide-y divide-border overflow-hidden rounded-lg bg-card dark:bg-background"
        >
          {#each populatedAppTokens as key}
            {@render appBuiltinSwatch(key)}
          {/each}
        </div>
      </section>
    {/if}
    {#if populatedCalTokens.length > 0}
      <section class="flex flex-col gap-2">
        <div class="flex items-center justify-between gap-3 px-1">
          <h2 class="text-[13px] font-semibold text-foreground">
            Calendar overrides
          </h2>
        </div>
        <div
          class="flex flex-col divide-y divide-border overflow-hidden rounded-lg bg-card dark:bg-background"
        >
          {#each populatedCalTokens as key}
            {@render calBuiltinSwatch(key)}
          {/each}
        </div>
      </section>
    {/if}
  {:else if theme.sources}
    {#each SOURCE_GROUPS as group (group.title)}
      {@render groupCard(group)}
    {/each}
  {:else}
    <section class="flex flex-col gap-2">
      <div
        class="flex items-center justify-between gap-3 rounded-lg bg-card px-4 py-3 dark:bg-background"
      >
        <div class="min-w-0 flex-1 text-[11px] text-muted-foreground">
          This theme has no Quick colors set up. Enable them to use the color
          editor, or edit the JSON directly below.
        </div>
        <button
          type="button"
          onclick={enableSources}
          class="shrink-0 rounded-md border border-border bg-card px-3 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-accent"
        >
          Set up Quick colors
        </button>
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
            class="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-[11px] text-foreground transition-colors hover:bg-accent"
          >
            <Copy size={11} strokeWidth={2.25} />
            <span>Copy JSON</span>
          </button>
          <button
            type="button"
            onclick={saveJsonToFile}
            class="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-[11px] text-foreground transition-colors hover:bg-accent"
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
                "flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-[11px] transition-colors",
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
                  : "cursor-not-allowed bg-card text-muted-foreground opacity-60",
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
