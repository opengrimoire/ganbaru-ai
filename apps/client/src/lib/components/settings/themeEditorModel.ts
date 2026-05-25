import type {
  CalendarColorDefaultMode,
  ThemeSources,
} from "$lib/stores/themes";

export type TokenInfo = { title: string; description: string };

export type GroupSingleRow = {
  kind: "single";
  key: string;
  scope: "app" | "cal";
};

export type GroupPairRow = {
  kind: "pair";
  bg: string;
  fg: string;
  title: string;
  description: string;
  scope: "app" | "cal";
  target?: number;
};

export type GroupSourcePairRow = {
  kind: "source-pair";
  bg: string;
  fg: string;
  bgSource: keyof ThemeSources;
  fgSource: keyof ThemeSources;
  title: string;
  description: string;
  scope: "app";
  target?: number;
};

export type GroupContrastRow = GroupPairRow | GroupSourcePairRow;
export type GroupRow = GroupSingleRow | GroupPairRow | GroupSourcePairRow;
export type ThemeNavTarget =
  | "general"
  | "calendar"
  | "signals"
  | "json";
export type SourceGroupId =
  | "app-canvas"
  | "calendar-surface"
  | "calendar-details"
  | "event-panel"
  | "ink"
  | "primary-action"
  | "destructive"
  | "confirm"
  | "warning";

export type SourceGroup = {
  id: SourceGroupId;
  sourceKey: keyof ThemeSources | null;
  title: string;
  description: string;
  navTarget?: Exclude<ThemeNavTarget, "json">;
  rows: GroupRow[];
};

export const APP_TOKEN_INFO: Record<string, TokenInfo> = {
  "--background": {
    title: "App canvas",
    description: "Most views paint their own surface over it",
  },
  "--cal-header-bg": {
    title: "Calendar header",
    description: "Calendar toolbar and day/time headers",
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
};

export const CALENDAR_TOKEN_INFO: Record<string, TokenInfo> = {
  "--cal-bg": {
    title: "Calendar background",
    description: "Background of the calendar grid",
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
    title: "Empty rail",
    description: "Color of empty parts of the pomodoro session rail",
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

export const SOURCE_GROUPS: SourceGroup[] = [
  {
    id: "app-canvas",
    sourceKey: "canvas",
    title: "App canvas",
    description:
      "Dominant background color, most surfaces tint automatically from it",
    navTarget: "general",
    rows: [
      { kind: "single", key: "--background", scope: "app" },
      { kind: "single", key: "--cal-header-bg", scope: "app" },
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
    id: "calendar-surface",
    sourceKey: null,
    title: "Calendar surface",
    description: "Calendar background, gridlines, and time labels",
    rows: [
      { kind: "single", key: "--cal-bg", scope: "cal" },
      { kind: "single", key: "--cal-gridline", scope: "cal" },
      { kind: "single", key: "--cal-time-label", scope: "cal" },
    ],
  },
  {
    id: "calendar-details",
    sourceKey: null,
    title: "Calendar details",
    description: "Rail states and accents on the calendar grid",
    rows: [
      { kind: "single", key: "--cal-current-time", scope: "cal" },
      { kind: "single", key: "--cal-timeline-rail", scope: "cal" },
      { kind: "single", key: "--cal-timeline-break", scope: "cal" },
      { kind: "single", key: "--cal-timeline-focus", scope: "cal" },
    ],
  },
  {
    id: "event-panel",
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
  {
    id: "ink",
    sourceKey: "ink",
    title: "Ink",
    description: "Base text color",
    navTarget: "signals",
    rows: [{ kind: "single", key: "--foreground", scope: "app" }],
  },
  {
    id: "primary-action",
    sourceKey: "primary",
    title: "Primary action",
    description: "Accent for highlighted buttons and links",
    rows: [{ kind: "single", key: "--primary-foreground", scope: "app" }],
  },
  {
    id: "destructive",
    sourceKey: null,
    title: "Destructive",
    description: "Danger signal",
    rows: [
      {
        kind: "source-pair",
        bg: "--destructive",
        fg: "--destructive-foreground",
        bgSource: "destructive",
        fgSource: "destructiveText",
        title: "Destructive",
        description: "Delete actions, armed delete, and declined status",
        scope: "app",
        target: 3,
      },
    ],
  },
  {
    id: "confirm",
    sourceKey: null,
    title: "Confirm",
    description: "Positive signal",
    rows: [
      {
        kind: "source-pair",
        bg: "--action-confirm",
        fg: "--action-confirm-foreground",
        bgSource: "confirm",
        fgSource: "confirmText",
        title: "Confirm",
        description: "Save actions, active pills, and accepted status",
        scope: "app",
        target: 3,
      },
    ],
  },
  {
    id: "warning",
    sourceKey: null,
    title: "Warning",
    description: "Caution signal",
    rows: [
      {
        kind: "source-pair",
        bg: "--status-tentative",
        fg: "--status-tentative-foreground",
        bgSource: "warning",
        fgSource: "warningText",
        title: "Warning",
        description: "Tentative status and caution surfaces",
        scope: "app",
        target: 3,
      },
    ],
  },
];

export const THEME_NAV_ITEMS: ReadonlyArray<{
  label: string;
  target: ThemeNavTarget;
}> = [
  { label: "General", target: "general" },
  { label: "Calendar", target: "calendar" },
  { label: "Text and actions", target: "signals" },
  { label: "JSON", target: "json" },
];

export const THEME_SECTION_LABELS: Record<ThemeNavTarget, string> = {
  general: "General",
  calendar: "Calendar",
  signals: "Text and actions",
  json: "JSON",
};

export const CALENDAR_DEFAULT_OPTIONS: ReadonlyArray<{
  mode: CalendarColorDefaultMode;
  label: string;
}> = [
  { mode: "light", label: "Light-based" },
  { mode: "dark", label: "Dark-based" },
  { mode: "app-canvas", label: "App canvas-based" },
  { mode: "custom", label: "Custom-based" },
];

const TEXT_ACTION_GROUP_IDS = new Set<SourceGroupId>([
  "ink",
  "primary-action",
  "destructive",
  "confirm",
  "warning",
]);

export const TEXT_ACTION_GROUPS = SOURCE_GROUPS.filter((group) =>
  TEXT_ACTION_GROUP_IDS.has(group.id),
);

const CALENDAR_GROUP_IDS = new Set<SourceGroupId>([
  "calendar-surface",
  "calendar-details",
  "event-panel",
]);

export const CALENDAR_GROUPS = SOURCE_GROUPS.filter((group) =>
  CALENDAR_GROUP_IDS.has(group.id),
);

export function isTextActionGroup(group: SourceGroup): boolean {
  return TEXT_ACTION_GROUP_IDS.has(group.id);
}

export function isCalendarGroup(group: SourceGroup): boolean {
  return CALENDAR_GROUP_IDS.has(group.id);
}

export function humanizeToken(token: string): string {
  const stripped = token.replace(/^--/, "").replace(/^cal-/, "");
  const spaced = stripped.replace(/-/g, " ");
  if (spaced.length === 0) return spaced;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function tokenInfo(row: GroupSingleRow): TokenInfo {
  const lookup = row.scope === "app" ? APP_TOKEN_INFO : CALENDAR_TOKEN_INFO;
  return lookup[row.key] ?? { title: humanizeToken(row.key), description: "" };
}
