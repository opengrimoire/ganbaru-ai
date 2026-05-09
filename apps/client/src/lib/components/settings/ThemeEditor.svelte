<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import AlertTriangle from "@lucide/svelte/icons/alert-triangle";
  import ArrowDown from "@lucide/svelte/icons/arrow-down";
  import Check from "@lucide/svelte/icons/check";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import ChevronUp from "@lucide/svelte/icons/chevron-up";
  import Copy from "@lucide/svelte/icons/copy";
  import Download from "@lucide/svelte/icons/download";
  import Link2 from "@lucide/svelte/icons/link-2";
  import Moon from "@lucide/svelte/icons/moon";
  import Pencil from "@lucide/svelte/icons/pencil";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import Sun from "@lucide/svelte/icons/sun";
  import Wand2 from "@lucide/svelte/icons/wand-2";
  import { invoke } from "@tauri-apps/api/core";
  import { save as saveDialog } from "@tauri-apps/plugin-dialog";
  import { cn } from "$lib/utils";
  import { PALETTE_SIZE } from "$lib/components/calendar/types";
  import { blendHex } from "$lib/components/calendar/utils";
  import {
    contrastRatio,
    pickReadableForeground,
  } from "$lib/components/ui/colorMath";
  import {
    DERIVATION_ENGINE_VERSION,
    isThemeCalendarDark,
    resolveAppTokens,
    resolveCalendarTokens,
    type Theme,
    type ThemeSources,
    type UserTheme,
  } from "$lib/stores/themes";
  import { getTheme } from "$lib/stores/theme.svelte";
  import ColorField from "$lib/components/ui/ColorField.svelte";

  type TokenInfo = { title: string; description: string };

  const APP_TOKEN_INFO: Record<string, TokenInfo> = {
    "--background": {
      title: "App canvas",
      description: "Most views paint their own surface over it",
    },
    "--foreground": {
      title: "Text color",
      description: "Applied to text across the app",
    },
    "--card": {
      title: "Card",
      description: "Background of grouped panels, dialogs, and tinted cards",
    },
    "--primary": {
      title: "Primary action",
      description: "Main accent color for highlighted buttons and links",
    },
    "--primary-foreground": {
      title: "Button text",
      description: "Text on primary buttons",
    },
    "--destructive": {
      title: "Destructive",
      description: "Color used for delete actions and warnings",
    },
    "--destructive-foreground": {
      title: "Destructive text",
      description: "Text color on destructive buttons and the title bar close hover",
    },
    "--ring": {
      title: "Focus ring",
      description: "Outline shown around focused inputs and buttons",
    },
    "--event-panel-bg": {
      title: "Event panel surface",
      description: "Background of the event creation/edit panel",
    },
    "--event-panel-contrast": {
      title: "Event panel section header",
      description: "Background strip behind section rows",
    },
    "--event-panel-text": {
      title: "Event panel body text",
      description: "Overrides --foreground inside the panel",
    },
    "--event-panel-muted-text": {
      title: "Event panel muted text",
      description: "Secondary text color inside the panel",
    },
    "--action-confirm": {
      title: "Confirm action",
      description:
        "Background of the Save button and the active scope selector pill in the event panel",
    },
    "--action-confirm-foreground": {
      title: "Confirm action text",
      description: "Text color on the Save button and active scope pill",
    },
    "--action-danger-armed": {
      title: "Armed delete",
      description:
        "Background of the delete button once it has been armed (click-again-to-confirm state)",
    },
    "--action-danger-armed-foreground": {
      title: "Armed delete text",
      description: "Text color on the delete button in its armed state",
    },
    "--status-accepted": {
      title: "Accepted attendee",
      description: "Status tile color for accepted attendees on a calendar event",
    },
    "--status-accepted-foreground": {
      title: "Accepted attendee text",
      description: "Text color on the accepted attendance tile",
    },
    "--status-tentative": {
      title: "Tentative attendee",
      description: "Status tile color for tentative attendees on a calendar event",
    },
    "--status-tentative-foreground": {
      title: "Tentative attendee text",
      description: "Text color on the tentative attendance tile",
    },
    "--status-declined": {
      title: "Declined attendee",
      description: "Status tile color for declined attendees on a calendar event",
    },
    "--status-declined-foreground": {
      title: "Declined attendee text",
      description: "Text color on the declined attendance tile",
    },
    "--priority-easy": {
      title: "Easy priority",
      description: "Applied as a tint for background and solid for text",
    },
    "--priority-medium": {
      title: "Medium priority",
      description: "Applied as a tint for background and solid for text",
    },
    "--priority-hard": {
      title: "Hard priority",
      description: "Applied as a tint for background and solid for text",
    },
    "--priority-epic": {
      title: "Epic priority",
      description: "Applied as a tint for background and solid for text",
    },
  };

  const CALENDAR_TOKEN_INFO: Record<string, TokenInfo> = {
    "--cal-bg": {
      title: "Calendar background",
      description: "Background of the calendar grid",
    },
    "--cal-header-bg": {
      title: "Calendar header",
      description: "Background of the day and time headers",
    },
    "--cal-gridline": {
      title: "Grid lines",
      description: "Color of the hour and day separator lines",
    },
    "--cal-time-label": {
      title: "Time labels",
      description: "Hour numbers down the side of the calendar",
    },
    "--cal-current-time": {
      title: "Now line",
      description: "Horizontal line marking the current time",
    },
    "--cal-timeline-rail": {
      title: "Session rail track",
      description: "Background strip beside an event during a pomodoro",
    },
    "--cal-timeline-break": {
      title: "Break marker",
      description: "Color of break segments on the session rail",
    },
    "--cal-timeline-focus": {
      title: "Focus marker",
      description: "Color of focus segments on the session rail",
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
    // WCAG contrast target for this pair's fg-against-bg check. Omit for
    // body text (4.5:1). Set to 3 for intentionally-recessed pairs like
    // the muted surface, whose foreground is designed to sit at AA-large
    // so captions recede without the warning panel flagging the design
    // intent as a bug.
    target?: number;
  };
  type GroupRow = GroupSingleRow | GroupPairRow;
  type ThemeNavTarget = "general" | "calendar" | "signals" | "todo" | "json";
  type SourceGroup = {
    sourceKey: keyof ThemeSources | null;
    title: string;
    description: string;
    navTarget?: Exclude<ThemeNavTarget, "json">;
    rows: GroupRow[];
  };

  // Three-tier layout the user edits top-to-bottom:
  //
  //   Tier 1 (app and calendar foundation): app canvas first, then
  //   calendar surface, event palette, calendar details, and event panel.
  //
  //   Tier 2 (feature surfaces): colors scoped to kanban badges.
  //
  //   Tier 3 (semantic signals): ink and accents that communicate intent
  //   across buttons, text, and status tiles.
  //
  // Collapse button is gated on rows.length > 1. Multi-row groups start
  // collapsed so the editor opens as a scannable page. Sourceless groups
  // keep the same collapse affordance, just without a source ColorField to
  // the left of the button. Source-driven single-row groups render the row
  // as a peer of the source via groupHeaderStyleRow.
  const SOURCE_GROUPS: SourceGroup[] = [
    // Tier 1: app and calendar foundation
    {
      sourceKey: "canvas",
      title: "App canvas",
      description:
        "Dominant background color, most surfaces tint automatically from it",
      navTarget: "general",
      rows: [
        { kind: "single", key: "--background", scope: "app" },
        { kind: "single", key: "--card", scope: "app" },
        {
          kind: "pair",
          bg: "--popover",
          fg: "--popover-foreground",
          title: "Popover",
          description: "Dropdowns, menus, and floating panels",
          scope: "app",
        },
        {
          kind: "pair",
          bg: "--secondary",
          fg: "--secondary-foreground",
          title: "Secondary surface",
          description: "Less emphasized buttons",
          scope: "app",
        },
        {
          kind: "pair",
          bg: "--muted",
          fg: "--muted-foreground",
          title: "Muted surface",
          description: "Subtle wells and the default hint-text color",
          scope: "app",
          target: 3,
        },
        {
          kind: "pair",
          bg: "--accent",
          fg: "--accent-foreground",
          title: "Hover highlight",
          description: "Soft tint shown when hovering rows and buttons",
          scope: "app",
        },
        { kind: "single", key: "--ring", scope: "app" },
        {
          kind: "pair",
          bg: "--sidebar",
          fg: "--sidebar-foreground",
          title: "Title bar",
          description: "Top frame of the app window",
          scope: "app",
        },
        {
          kind: "pair",
          bg: "--sidebar-accent",
          fg: "--sidebar-accent-foreground",
          title: "Title bar hover",
          description: "Tint shown when hovering title bar buttons",
          scope: "app",
        },
      ],
    },
    {
      sourceKey: null,
      title: "Calendar surface",
      description: "Calendar background, header, gridlines, and timeline",
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
      description: "Semantic markers and accents on the calendar grid",
      rows: [
        {
          kind: "pair",
          bg: "--cal-today-circle",
          fg: "--cal-today-circle-text",
          title: "Today marker",
          description:
            "Filled circle around today's date and the number inside",
          scope: "cal",
        },
        { kind: "single", key: "--cal-current-time", scope: "cal" },
        { kind: "single", key: "--cal-timeline-break", scope: "cal" },
        { kind: "single", key: "--cal-timeline-focus", scope: "cal" },
      ],
    },
    {
      sourceKey: null,
      title: "Event panel",
      description:
        "Surfaces on the event creation and edit panel opened from the calendar",
      rows: [
        { kind: "single", key: "--event-panel-bg", scope: "app" },
        { kind: "single", key: "--event-panel-contrast", scope: "app" },
        { kind: "single", key: "--event-panel-text", scope: "app" },
        { kind: "single", key: "--event-panel-muted-text", scope: "app" },
      ],
    },
    // Tier 2: feature surfaces
    {
      sourceKey: null,
      title: "Task priority",
      description: "Kanban badge colors per difficulty tier",
      navTarget: "todo",
      rows: [
        { kind: "single", key: "--priority-easy", scope: "app" },
        { kind: "single", key: "--priority-medium", scope: "app" },
        { kind: "single", key: "--priority-hard", scope: "app" },
        { kind: "single", key: "--priority-epic", scope: "app" },
      ],
    },
    // Tier 3: semantic signals
    {
      sourceKey: "ink",
      title: "Ink",
      description: "Base text color",
      navTarget: "signals",
      rows: [
        { kind: "single", key: "--foreground", scope: "app" },
      ],
    },
    {
      sourceKey: "primary",
      title: "Primary action",
      description: "Accent for highlighted buttons and links",
      rows: [{ kind: "single", key: "--primary-foreground", scope: "app" }],
    },
    {
      sourceKey: "destructive",
      title: "Destructive",
      description: "Danger signal",
      rows: [
        {
          kind: "pair",
          bg: "--destructive",
          fg: "--destructive-foreground",
          title: "Destructive button",
          description: "Delete actions and the title bar close hover",
          scope: "app",
        },
        {
          kind: "pair",
          bg: "--action-danger-armed",
          fg: "--action-danger-armed-foreground",
          title: "Armed delete",
          description:
            "Background and text of the delete button once armed (click-again-to-confirm state)",
          scope: "app",
        },
        {
          kind: "pair",
          bg: "--status-declined",
          fg: "--status-declined-foreground",
          title: "Declined attendee",
          description: "Status tile for declined attendees on a calendar event",
          scope: "app",
        },
      ],
    },
    {
      sourceKey: "confirm",
      title: "Confirm",
      description: "Positive signal",
      rows: [
        {
          kind: "pair",
          bg: "--action-confirm",
          fg: "--action-confirm-foreground",
          title: "Confirm action button",
          description:
            "Save button and the active scope pill on the event panel",
          scope: "app",
        },
        {
          kind: "pair",
          bg: "--status-accepted",
          fg: "--status-accepted-foreground",
          title: "Accepted attendee",
          description: "Status tile for accepted attendees on a calendar event",
          scope: "app",
        },
      ],
    },
    {
      sourceKey: "warning",
      title: "Warning",
      description: "Caution signal",
      rows: [
        {
          kind: "pair",
          bg: "--status-tentative",
          fg: "--status-tentative-foreground",
          title: "Tentative attendee",
          description: "Status tile for tentative attendees on a calendar event",
          scope: "app",
        },
      ],
    },
  ];

  const THEME_NAV_ITEMS: ReadonlyArray<{
    label: string;
    target: ThemeNavTarget;
  }> = [
    { label: "General", target: "general" },
    { label: "Calendar", target: "calendar" },
    { label: "To-do", target: "todo" },
    { label: "Text and actions", target: "signals" },
    { label: "JSON", target: "json" },
  ];

  const THEME_SECTION_LABELS: Record<ThemeNavTarget, string> = {
    general: "General",
    calendar: "Calendar",
    todo: "To-do",
    signals: "Text and actions",
    json: "JSON",
  };

  const TEXT_ACTION_GROUP_TITLES = new Set([
    "Ink",
    "Primary action",
    "Destructive",
    "Confirm",
    "Warning",
  ]);
  const TEXT_ACTION_GROUPS = SOURCE_GROUPS.filter((group) =>
    TEXT_ACTION_GROUP_TITLES.has(group.title),
  );
  const CALENDAR_GROUP_TITLES = new Set([
    "Calendar surface",
    "Calendar details",
    "Event panel",
  ]);
  const CALENDAR_GROUPS = SOURCE_GROUPS.filter((group) =>
    CALENDAR_GROUP_TITLES.has(group.title),
  );

  function isTextActionGroup(group: SourceGroup): boolean {
    return TEXT_ACTION_GROUP_TITLES.has(group.title);
  }

  function isCalendarGroup(group: SourceGroup): boolean {
    return CALENDAR_GROUP_TITLES.has(group.title);
  }

  let { theme }: { theme: Theme } = $props();

  const themeStore = getTheme();
  const THEME_FILE_FILTER = [{ name: "Theme JSON", extensions: ["json"] }];

  const isBuiltin = $derived(theme.kind === "builtin");
  const userTheme = $derived(
    theme.kind === "user" ? (theme as UserTheme) : undefined,
  );
  // The iconLabel icon is purely decorative ("was this for me to use on day
  // or night?"). It does not drive the runtime `.dark` class or palette
  // pick. Built-ins peg the icon to their pinned iconLabel; user themes
  // can flip it.
  const BaseIcon = $derived(theme.iconLabel === "dark" ? Moon : Sun);
  // The rebake banner appears when the saved theme's engine version trails
  // the current code constant AND the user hasn't dismissed an upgrade
  // prompt for that pair.
  const offerRebake = $derived(
    userTheme ? themeStore.shouldOfferRebake(userTheme) : false,
  );

  let scrollViewport: HTMLDivElement | undefined;
  let activeThemeSection = $state<ThemeNavTarget>("general");
  let scrollFrame: number | undefined;

  onDestroy(() => {
    if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame);
  });

  // Collapse state is ephemeral (not persisted across sessions). Every
  // multi-row group is collapsible; single-row source groups still render
  // their row as a peer of the header.
  let collapsed = $state<Record<string, boolean>>(
    untrack(() =>
      Object.fromEntries(
        SOURCE_GROUPS.filter((g) => g.rows.length > 1).map((g) => [
          g.title,
          true,
        ]),
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
    void themeStore.renameTheme(theme.id, next);
  }

  function sectionSelector(target: ThemeNavTarget): string {
    return `[data-theme-nav-target="${target}"]`;
  }

  function themeSectionElements(): Array<{
    target: ThemeNavTarget;
    el: HTMLElement;
  }> {
    if (!scrollViewport) return [];
    const out: Array<{ target: ThemeNavTarget; el: HTMLElement }> = [];
    for (const item of THEME_NAV_ITEMS) {
      const el = scrollViewport.querySelector<HTMLElement>(
        sectionSelector(item.target),
      );
      if (el) out.push({ target: item.target, el });
    }
    return out;
  }

  function updateActiveThemeSection() {
    if (!scrollViewport) return;
    const sections = themeSectionElements();
    if (sections.length === 0) return;
    const atBottom =
      scrollViewport.scrollTop + scrollViewport.clientHeight >=
      scrollViewport.scrollHeight - 2;
    if (atBottom) {
      activeThemeSection = sections[sections.length - 1].target;
      return;
    }
    const viewportTop = scrollViewport.getBoundingClientRect().top;
    const threshold = viewportTop + 8;
    let next = sections[0].target;
    for (const section of sections) {
      if (section.el.getBoundingClientRect().top <= threshold) {
        next = section.target;
      } else {
        break;
      }
    }
    activeThemeSection = next;
  }

  function queueActiveThemeSectionUpdate() {
    if (scrollFrame !== undefined) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = undefined;
      updateActiveThemeSection();
    });
  }

  function scrollToThemeSection(target: ThemeNavTarget) {
    const el =
      scrollViewport?.querySelector<HTMLElement>(sectionSelector(target)) ??
      document.querySelector<HTMLElement>(sectionSelector(target));
    if (!el) return;
    activeThemeSection = target;
    if (!scrollViewport) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const rootTop = scrollViewport.getBoundingClientRect().top;
    const targetTop = el.getBoundingClientRect().top;
    scrollViewport.scrollTo({
      top: scrollViewport.scrollTop + targetTop - rootTop,
      behavior: "smooth",
    });
  }

  function effectiveCalBg(t: Theme): string {
    return resolveCalendarTokens(t)["--cal-bg"];
  }

  function setSlot(index: number, hex: string) {
    void themeStore.setPaletteSlot(theme.id, index, hex);
  }

  const paletteIndices = Array.from({ length: PALETTE_SIZE }, (_, i) => i);

  function setAppToken(key: string, hex: string) {
    void themeStore.setTokenValue(theme.id, "app", key, hex);
  }

  function setCalToken(key: string, hex: string) {
    void themeStore.setTokenValue(theme.id, "calendar", key, hex);
  }

  function setSource(key: keyof ThemeSources, hex: string) {
    void themeStore.updateSourceValue(theme.id, key, hex);
  }

  // Isolating a token pins the current snapshot value against future
  // source-edit cascades. Visually the row swaps its readonly swatch +
  // Isolated-edit button for a ColorField + Link-back. The hex itself
  // does not change at the moment of pinning; the snapshot already holds
  // the auto-derived value.
  function isolateAppToken(key: string) {
    void themeStore.isolateToken(theme.id, "app", key);
  }

  function isolateCalToken(key: string) {
    void themeStore.isolateToken(theme.id, "calendar", key);
  }

  function relinkAppToken(key: string) {
    void themeStore.relinkToken(theme.id, "app", key);
  }

  function relinkCalToken(key: string) {
    void themeStore.relinkToken(theme.id, "calendar", key);
  }

  // Per-token reset restores a single control back to the value (and
  // isolated flag) it had when the theme was cloned. Sources/app/cal all
  // round-trip through the same DB mutator since seeds carry both the
  // value and the pinned-state.
  function canResetSource(key: keyof ThemeSources): boolean {
    if (!userTheme) return false;
    return userTheme.sources[key] !== userTheme.seedSources[key];
  }

  function resetSource(key: keyof ThemeSources) {
    if (!userTheme) return;
    void themeStore.resetTokenToSeed(theme.id, "source", key);
  }

  function canResetAppToken(key: string): boolean {
    if (!userTheme) return false;
    if (userTheme.appTokens[key] !== userTheme.seedAppTokens[key]) return true;
    return (
      userTheme.appIsolated.has(key) !== userTheme.seedAppIsolated.has(key)
    );
  }

  function resetAppToken(key: string) {
    void themeStore.resetTokenToSeed(theme.id, "app", key);
  }

  function canResetCalToken(key: string): boolean {
    if (!userTheme) return false;
    if (
      userTheme.calendarTokens[key] !== userTheme.seedCalendarTokens[key]
    ) {
      return true;
    }
    return (
      userTheme.calendarIsolated.has(key) !==
      userTheme.seedCalendarIsolated.has(key)
    );
  }

  function resetCalToken(key: string) {
    void themeStore.resetTokenToSeed(theme.id, "calendar", key);
  }

  function rebake() {
    if (!userTheme) return;
    void themeStore.rebakeTheme(theme.id);
  }

  function dismissRebake() {
    if (!userTheme) return;
    void themeStore.dismissUpgrade(theme.id);
  }

  // WCAG body-text threshold. Default target for rows that don't override
  // it; muted surfaces tag themselves with 3 so the warning panel respects
  // their design intent (captions and past-day numbers are supposed to
  // recede, not pass 4.5:1).
  const AA_BODY_TARGET = 4.5;

  function pairTarget(row: GroupPairRow): number {
    return row.target ?? AA_BODY_TARGET;
  }

  // Resolve a token's rendered value from the theme. For user themes the
  // snapshot is the source of truth; built-ins return BASE. We re-read on
  // every call so the live editor reflects whatever the user just changed
  // without a roundtrip through the DOM.
  const resolvedApp = $derived(resolveAppTokens(theme));
  const resolvedCal = $derived(resolveCalendarTokens(theme));

  function effectiveColor(key: string, scope: "app" | "cal"): string {
    return scope === "app" ? resolvedApp[key] : resolvedCal[key];
  }

  type PairContrast = { ratio: number; passes: boolean; target: number };
  function pairContrast(row: GroupPairRow): PairContrast {
    const bg = effectiveColor(row.bg, row.scope);
    const fg = effectiveColor(row.fg, row.scope);
    const ratio = contrastRatio(fg, bg);
    const target = pairTarget(row);
    return { ratio, passes: ratio >= target, target };
  }

  function autoFixPair(row: GroupPairRow) {
    const bg = effectiveColor(row.bg, row.scope);
    const ink = resolvedApp["--foreground"];
    const canvas = resolvedApp["--background"];
    const next = pickReadableForeground(bg, {
      ink,
      canvas,
      target: pairTarget(row),
    });
    if (row.scope === "app") setAppToken(row.fg, next);
    else setCalToken(row.fg, next);
  }

  // Flat list of every pair row across every source group, used by the
  // floating contrast notice so users don't have to hunt for warnings across
  // collapsed sections.
  type LocatedPair = { row: GroupPairRow; group: SourceGroup };
  const allPairs: LocatedPair[] = (() => {
    const out: LocatedPair[] = [];
    for (const g of SOURCE_GROUPS) {
      for (const r of g.rows) {
        if (r.kind === "pair") out.push({ row: r, group: g });
      }
    }
    return out;
  })();

  const failingPairs = $derived(
    allPairs.filter(({ row }) => !pairContrast(row).passes),
  );

  let nextPairCursor = $state(0);

  function pairKey(row: GroupPairRow): string {
    return `${row.scope}:${row.bg}:${row.fg}`;
  }

  // Jump the viewport to the next failing row, cycling through the list.
  // Expands the row's group if collapsed so the pair is actually visible
  // before scrolling. Without this, clicking Next on a collapsed row would
  // silently do nothing.
  function jumpToNextFailingPair() {
    if (failingPairs.length === 0) return;
    const idx = nextPairCursor % failingPairs.length;
    const target = failingPairs[idx];
    nextPairCursor = idx + 1;
    collapsed = { ...collapsed, [target.group.title]: false };
    queueMicrotask(() => {
      const el = document.querySelector<HTMLElement>(
        `[data-pair-key="${pairKey(target.row)}"]`,
      );
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  function fixAllFailingPairs() {
    for (const { row } of failingPairs) autoFixPair(row);
    nextPairCursor = 0;
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

  async function applyJsonChanges() {
    const result = await themeStore.replaceTheme(theme.id, jsonDraft);
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

  function tokenInfo(row: GroupSingleRow): TokenInfo {
    const lookup =
      row.scope === "app" ? APP_TOKEN_INFO : CALENDAR_TOKEN_INFO;
    return lookup[row.key] ?? { title: humanize(row.key), description: "" };
  }
</script>

<div class="relative flex h-full min-h-0 flex-col">
  <!-- Theme chrome sits above the editor scroll viewport so the scrollbar
       starts with the editable sections. -->
  <section
    class="relative z-20 flex shrink-0 flex-col gap-1.5 border-b border-border bg-sidebar px-3 py-2"
  >
    <div
      class="flex h-9 min-w-0 items-center overflow-hidden rounded-md border border-border bg-card text-[11px] text-muted-foreground dark:bg-background"
    >
      {#if isBuiltin}
        <span
          class="flex h-full w-9 shrink-0 items-center justify-center"
        >
          <BaseIcon
            size={12}
            strokeWidth={1.75}
            aria-label={theme.iconLabel === "dark" ? "Dark theme" : "Light theme"}
          />
        </span>
        <span class="h-5 border-r border-border" aria-hidden="true"></span>
        <span class="min-w-0 flex-1 truncate px-3 font-medium">
          {theme.displayName}
        </span>
      {:else}
        <button
          type="button"
          onclick={() =>
            themeStore.setThemeIconLabel(
              theme.id,
              theme.iconLabel === "dark" ? "light" : "dark",
            )}
          aria-label={`Icon tag: ${theme.iconLabel === "dark" ? "night" : "day"} (decorative, click to flip)`}
          title={`Decorative tag for ${theme.iconLabel === "dark" ? "night" : "day"} use. Click to flip.`}
          class="flex h-full w-9 shrink-0 items-center justify-center transition-colors hover:bg-accent focus:outline-none"
        >
          <BaseIcon size={12} strokeWidth={1.75} />
        </button>
        <span class="h-5 border-r border-border" aria-hidden="true"></span>
        <input
          type="text"
          value={theme.displayName}
          oninput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
          maxlength={60}
          aria-label="Theme name"
          class="h-full min-w-0 flex-1 bg-transparent px-3 font-medium text-muted-foreground focus:outline-none"
        />
      {/if}
    </div>
    {#if userTheme}
      <nav
        class="grid h-9 grid-cols-5 items-center gap-1 rounded-lg border border-border bg-card px-1 text-[11px] dark:bg-background"
        aria-label="Theme editor sections"
      >
        {#each THEME_NAV_ITEMS as item}
          <button
            type="button"
            onclick={() => scrollToThemeSection(item.target)}
            aria-current={activeThemeSection === item.target
              ? "location"
              : undefined}
            class={cn(
              "flex h-7 min-w-0 items-center justify-center rounded-md px-2 text-center font-medium transition-colors hover:bg-accent hover:text-foreground",
              activeThemeSection === item.target
                ? "bg-accent text-foreground"
                : "text-muted-foreground",
            )}
          >
            <span class="min-w-0 truncate">{item.label}</span>
          </button>
        {/each}
      </nav>
    {/if}
  </section>

  {#snippet resetIconButton(
    onClick: () => void,
    label: string,
    canReset: boolean,
  )}
    <button
      type="button"
      onclick={() => {
        if (!canReset) return;
        onClick();
      }}
      aria-disabled={!canReset}
      aria-label="Reset {label} to its original value"
      title={canReset ? "Restore original value" : "Already at original value"}
      class={cn(
        "flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md border border-border bg-card transition-colors",
        canReset
          ? "text-foreground hover:border-foreground/30 hover:bg-accent"
          : "cursor-not-allowed text-muted-foreground",
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
    {@const isolatedSet = userTheme
      ? scope === "app"
        ? userTheme.appIsolated
        : userTheme.calendarIsolated
      : undefined}
    {@const isLinked = !(isolatedSet?.has(key) ?? false)}
    {@const snapshot = userTheme
      ? scope === "app"
        ? userTheme.appTokens
        : userTheme.calendarTokens
      : undefined}
    {@const displayVal = snapshot?.[key] ?? ""}
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
    <div class="flex items-center justify-between gap-3 px-1 py-2.5">
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
    {@const snapshot = userTheme
      ? row.scope === "app"
        ? userTheme.appTokens
        : userTheme.calendarTokens
      : undefined}
    {@const displayVal = snapshot?.[row.key] ?? ""}
    {@const canResetRow =
      row.scope === "app"
        ? canResetAppToken(row.key)
        : canResetCalToken(row.key)}
    <div class="flex items-center justify-between gap-3 px-1 py-2.5">
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
    {@const contrast = pairContrast(row)}
    <div
      data-pair-key={pairKey(row)}
      class="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-1 py-2.5"
    >
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-1.5">
          <span class="text-[12px] text-foreground">{row.title}</span>
          {#if !contrast.passes}
            <button
              type="button"
              onclick={() => autoFixPair(row)}
              aria-label="Auto-fix {row.title} text contrast"
              title="Contrast {contrast.ratio.toFixed(2)}:1. This pair targets {contrast.target}:1{contrast.target >= 4.5
                ? ' (AA body text)'
                : ' (AA large/UI)'}. Click to auto-pick a legible text color."
              class="flex items-center gap-1 rounded px-1 py-0.5 text-[10px] font-medium text-amber-700 transition-colors hover:bg-amber-500/10 dark:text-amber-400"
            >
              <AlertTriangle size={11} strokeWidth={2.25} />
              <span>{contrast.ratio.toFixed(1)}:1</span>
              <Wand2 size={10} strokeWidth={2.25} />
            </button>
          {/if}
        </div>
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

  {#snippet groupSection(group: SourceGroup)}
    {@const isCollapsible = group.rows.length > 1}
    {@const isCollapsed = isCollapsible && collapsed[group.title] === true}
    {@const showRows =
      group.rows.length > 0 && (!isCollapsible || !isCollapsed)}
    <section class="flex flex-col">
      <header class="flex items-center justify-between gap-3 px-1 py-2.5">
        <div class="min-w-0 flex-1">
          <div class="text-[13px] font-semibold text-foreground">
            {group.title}
          </div>
          <div class="text-[11px] text-muted-foreground">
            {group.description}
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-1.5">
          {#if group.sourceKey !== null && userTheme}
            {@const sourceKey = group.sourceKey}
            <ColorField
              value={userTheme.sources[sourceKey]}
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
                <span>Expand</span>
                <ChevronDown size={11} strokeWidth={2.25} />
              {:else}
                <ChevronUp size={11} strokeWidth={2.25} />
                <span>Collapse</span>
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

  {#snippet textActionsSection()}
    <section class="flex flex-col divide-y divide-border">
      {#each TEXT_ACTION_GROUPS as group (group.title)}
        {@render groupSection(group)}
      {/each}
    </section>
  {/snippet}

  {#snippet calendarSection()}
    <section class="flex flex-col divide-y divide-border">
      {#each CALENDAR_GROUPS as group (group.title)}
        {#if group.title === "Calendar details"}
          {@render eventPaletteSection()}
        {/if}
        {@render groupSection(group)}
      {/each}
    </section>
  {/snippet}

  {#snippet sectionHeader(target: ThemeNavTarget, note?: string)}
    <div
      class="flex scroll-mt-4 items-center gap-3 px-1 pt-1"
      data-theme-nav-target={target}
    >
      <h2 class="shrink-0 text-[13px] font-semibold text-foreground">
        {THEME_SECTION_LABELS[target]}
      </h2>
      <div class="h-px min-w-4 flex-1 bg-border" aria-hidden="true"></div>
      {#if note}
        <span class="shrink-0 text-[11px] text-muted-foreground">
          {note}
        </span>
      {/if}
    </div>
  {/snippet}

  {#snippet eventPaletteSection()}
    <section class="flex flex-col gap-2 py-2.5">
      <header class="px-1">
        <h2 class="text-[13px] font-semibold text-foreground">
          Event palette
        </h2>
        <div class="text-[11px] text-muted-foreground">
          24 color slots, each one has a faded variant for past events, blended
          toward Calendar background
        </div>
      </header>
      <div
        class="flex flex-col gap-3 p-3"
        style="background-color: {effectiveCalBg(theme)};"
      >
        <div class="grid grid-cols-4 gap-x-2 gap-y-1.5">
          {#each paletteIndices as index}
            {@const base = theme.eventPalette[index]}
            {@const past = blendHex(
              base,
              effectiveCalBg(theme),
              isThemeCalendarDark(theme) ? 0.5 : 0.3,
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
  {/snippet}

  <div class="relative min-h-0 flex-1">
    <div
      bind:this={scrollViewport}
      class="h-full overflow-y-auto"
      onscroll={queueActiveThemeSectionUpdate}
    >
      <div
        class={cn(
          "flex flex-col gap-6 px-5 pt-6",
          userTheme && failingPairs.length > 0 ? "pb-16" : "pb-4",
        )}
      >
  <!-- Body: grouped editor for user themes, JSON-only readout for built-ins. -->
  {#if userTheme}
    {#if offerRebake}
      <!-- Rebake banner: prompt the user to refresh non-isolated tokens
           through the current derivation engine. Pinned tokens stay
           untouched; the engine version stamp updates on accept. -->
      <section
        class="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-amber-400/60 bg-amber-50 px-3 py-2 text-[12px] dark:bg-amber-950/30"
      >
        <div class="flex min-w-0 flex-1 items-start gap-2 text-amber-800 dark:text-amber-300">
          <AlertTriangle size={13} strokeWidth={2.25} class="mt-[2px] shrink-0" />
          <span class="leading-snug">
            This theme was saved against an older derivation engine
            (v{userTheme.derivationEngineVersion}, current
            v{DERIVATION_ENGINE_VERSION}). Rebake to refresh non-pinned
            colors.
          </span>
        </div>
        <div class="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onclick={dismissRebake}
            class="flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-accent"
          >
            Maybe later
          </button>
          <button
            type="button"
            onclick={rebake}
            class="flex items-center gap-1 rounded-md border border-primary bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Wand2 size={11} strokeWidth={2.25} />
            <span>Rebake</span>
          </button>
        </div>
      </section>
    {/if}

    {#each SOURCE_GROUPS as group (group.title)}
      {#if isCalendarGroup(group)}
        {#if group.title === "Calendar surface"}
          <div class="flex flex-col gap-2">
            {@render sectionHeader("calendar")}
            {@render calendarSection()}
          </div>
        {/if}
      {:else if isTextActionGroup(group)}
        {#if group.title === "Ink"}
          <div class="flex flex-col gap-2">
            {@render sectionHeader("signals")}
            {@render textActionsSection()}
          </div>
        {/if}
      {:else if group.navTarget}
        <div class="flex flex-col gap-2">
          {@render sectionHeader(group.navTarget)}
          {@render groupSection(group)}
        </div>
      {:else}
        {@render groupSection(group)}
      {/if}
    {/each}

  {:else}
    {@render eventPaletteSection()}
  {/if}

  <!-- JSON -->
  <div class="flex flex-col gap-2">
    {@render sectionHeader("json")}
    <section class="flex flex-col">
      <header class="px-1 py-2.5">
        <h2 class="text-[13px] font-semibold text-foreground">Schema</h2>
        <div class="text-[11px] text-muted-foreground">
          {isBuiltin
            ? "Read-only representation of the theme"
            : "Edit directly, apply to commit changes"}
        </div>
      </header>
      <div class="flex flex-col gap-2 border-t border-border pt-2">
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
</div>
</div>
{#if userTheme && failingPairs.length > 0}
  <section
    class="absolute bottom-3 left-1/2 z-30 flex h-10 w-fit max-w-[calc(100%-2.5rem)] -translate-x-1/2 items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 text-[11px] shadow-xl dark:bg-background"
  >
    <div class="flex min-w-0 items-center gap-2 text-foreground">
      <AlertTriangle
        size={13}
        strokeWidth={2.25}
        class="shrink-0 text-amber-500"
      />
      <span class="font-medium">
        {failingPairs.length} contrast {failingPairs.length === 1
          ? "issue"
          : "issues"}
      </span>
    </div>
    <div class="flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        onclick={jumpToNextFailingPair}
        aria-label="Jump to next failing contrast row"
        title="Scroll to the next row below its contrast target (cycles through the list). Muted surfaces target 3:1; everything else targets 4.5:1."
        class="flex h-6 items-center gap-1 rounded-md border border-border bg-card px-2 text-[10px] font-medium text-foreground transition-colors hover:bg-accent"
      >
        <ArrowDown size={11} strokeWidth={2.25} />
        <span>Jump to next</span>
      </button>
      <button
        type="button"
        onclick={fixAllFailingPairs}
        aria-label="Auto-fix every failing contrast row"
        title="Pick a legible text color for every pair below its target"
        class="flex h-6 items-center gap-1 rounded-md border border-primary bg-primary px-2 text-[10px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        <Wand2 size={11} strokeWidth={2.25} />
        <span>Fix all</span>
      </button>
    </div>
  </section>
{/if}
</div>
</div>
