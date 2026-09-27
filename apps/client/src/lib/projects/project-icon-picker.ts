import {
  PALETTE_SIZE,
  type EventColor,
} from "$lib/components/calendar/types";
import {
  parseProjectIcon,
  projectIconRecentValue,
  serializeProjectIcon,
  type ProjectIconValue,
} from "$lib/projects/project-icons";
import type {
  ProjectEmojiCategoryId,
  ProjectEmojiEntry,
} from "$lib/projects/project-emoji-catalog";
import {
  PROJECT_EMOJI_CATEGORIES,
  PROJECT_EMOJI_SKIN_TONE_BASES,
  PROJECT_EMOJI_SKIN_TONE_VARIANTS,
} from "$lib/projects/project-emoji-catalog";
import type {
  ProjectLucideCategory,
  ProjectLucideIconEntry,
} from "$lib/projects/project-lucide-catalog.generated";
import type { ProjectCustomEmoji } from "$lib/projects/types";

export const PROJECT_ICON_RECENT_LIMIT = 12;
export const PROJECT_EMOJI_SKIN_TONES = [
  "default",
  "light",
  "medium-light",
  "medium",
  "medium-dark",
  "dark",
] as const;

export type ProjectEmojiSkinTone = (typeof PROJECT_EMOJI_SKIN_TONES)[number];
export type ProjectIconPickerColor = EventColor | "default";

export const PROJECT_ICON_PICKER_SKIN_TONE_OPTIONS: readonly { value: ProjectEmojiSkinTone }[] = [
  { value: "default" },
  { value: "light" },
  { value: "medium-light" },
  { value: "medium" },
  { value: "medium-dark" },
  { value: "dark" },
];

export const PROJECT_ICON_PICKER_VISIBLE_EMOJI_CATEGORY_IDS: readonly ProjectEmojiCategoryId[] = [
  "smileys",
  "people",
  "nature",
  "food",
  "activity",
  "travel",
  "objects",
  "symbols",
];

export const PROJECT_ICON_PICKER_LUCIDE_CATEGORY_ICON_SLUGS: Partial<Record<ProjectLucideCategory, string>> = {
  Accessibility: "accessibility",
  "Accounts and access": "user-round",
  Animals: "paw-print",
  Arrows: "arrow-up-right",
  Buildings: "building-2",
  Charts: "chart-no-axes-column-increasing",
  Communication: "message-circle",
  Connectivity: "wifi",
  Cursors: "mouse-pointer-2",
  Design: "paintbrush",
  "Coding and development": "code-xml",
  Devices: "monitor",
  Emoji: "laugh",
  "File icons": "file",
  Finance: "badge-dollar-sign",
  "Food and beverage": "utensils",
  Gaming: "gamepad-2",
  Home: "house",
  Layout: "layout-grid",
  Mail: "mail",
  Mathematics: "sigma",
  Medical: "cross",
  Multimedia: "video",
  Nature: "leaf",
  "Navigation and places": "plane",
  Notification: "bell",
  People: "users",
  Photography: "camera",
  Science: "flask-conical",
  Seasons: "snowflake",
  Security: "shield",
  Shapes: "shapes",
  Shopping: "shopping-cart",
  Social: "share-2",
  Sports: "dumbbell",
  Sustainability: "recycle",
  "Text formatting": "type",
  "Time and calendar": "calendar",
  Tools: "wrench",
  Transportation: "car",
  Travel: "luggage",
  Weather: "cloud-sun",
};

export const PROJECT_ICON_PICKER_PRIMARY_LUCIDE_CATEGORIES: readonly ProjectLucideCategory[] = [
  "File icons",
  "Tools",
  "Coding and development",
  "Design",
  "Charts",
  "Communication",
  "Time and calendar",
  "Navigation and places",
];

const PROJECT_EMOJI_SKIN_TONE_MODIFIERS: Record<ProjectEmojiSkinTone, string> = {
  default: "",
  light: "🏻",
  "medium-light": "🏼",
  medium: "🏽",
  "medium-dark": "🏾",
  dark: "🏿",
};

const PROJECT_EMOJI_SKIN_TONE_PATTERN = /[\u{1f3fb}-\u{1f3ff}]/gu;
const PROJECT_EMOJI_SKIN_TONE_SUPPORTED = new Set<string>(PROJECT_EMOJI_SKIN_TONE_BASES);
const PROJECT_ICON_PICKER_VISIBLE_EMOJI_CATEGORY_ID_SET = new Set<ProjectEmojiCategoryId>(
  PROJECT_ICON_PICKER_VISIBLE_EMOJI_CATEGORY_IDS,
);
const PROJECT_ICON_PICKER_PRIMARY_LUCIDE_CATEGORY_SET = new Set<ProjectLucideCategory>(
  PROJECT_ICON_PICKER_PRIMARY_LUCIDE_CATEGORIES,
);
type ProjectEmojiVariantSkinTone = Exclude<ProjectEmojiSkinTone, "default">;

export interface ProjectIconVirtualWindow {
  startIndex: number;
  endIndex: number;
  beforeHeight: number;
  afterHeight: number;
}

export interface ProjectIconPickerRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

export interface ProjectIconPickerPanelPlacement {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ProjectIconPickerAnchoredPanelPlacement {
  left: number;
  top: number;
  maxHeight: number;
}

export interface ProjectIconPickerPointPlacement {
  left: number;
  top: number;
}

export interface ProjectIconPickerVirtualGroup<TCategory extends string, TEntry> {
  category: TCategory;
  entries: readonly TEntry[];
  beforeRowsHeight: number;
  afterRowsHeight: number;
}

export interface ProjectIconPickerGroupVirtualWindow<TCategory extends string, TEntry> {
  groups: readonly ProjectIconPickerVirtualGroup<TCategory, TEntry>[];
  beforeHeight: number;
  afterHeight: number;
}

export interface ProjectIconPickerVirtualGroupInput<TCategory extends string, TEntry> {
  category: TCategory;
  entries: readonly TEntry[];
}

export interface ProjectIconPickerVisibleEmojiCategory {
  id: ProjectEmojiCategoryId;
  label: string;
}

export interface ProjectIconPickerLucideCategoryOption {
  category: ProjectLucideCategory;
  icon: ProjectLucideIconEntry | undefined;
}

interface ProjectIconPickerPanelPlacementInput {
  triggerRect: ProjectIconPickerRect;
  boundaryRect: ProjectIconPickerRect;
  preferredWidth: number;
  preferredHeight: number;
  align?: "start" | "end";
  gap?: number;
  inset?: number;
}

interface ProjectIconPickerAnchoredPanelPlacementInput {
  anchorRect: ProjectIconPickerRect;
  viewportRect: ProjectIconPickerRect;
  panelWidth: number;
  preferredHeight: number;
  minimumUsefulHeight?: number;
  gap?: number;
  margin?: number;
}

interface ProjectIconPickerMenuPlacementInput {
  anchorRect: ProjectIconPickerRect;
  viewportRect: ProjectIconPickerRect;
  menuWidth: number;
  menuMaxHeight: number;
  minimumUsefulHeight?: number;
  gap?: number;
  margin?: number;
}

interface ProjectIconPickerPointPlacementInput {
  anchorRect: ProjectIconPickerRect;
  viewportRect: ProjectIconPickerRect;
  panelWidth: number;
  panelHeight: number;
  gap?: number;
  margin?: number;
}

interface ProjectIconPickerGroupVirtualWindowInput<TCategory extends string, TEntry> {
  groups: readonly ProjectIconPickerVirtualGroupInput<TCategory, TEntry>[];
  columnCount: number;
  viewportHeight: number;
  scrollTop: number;
  rowHeight: number;
  groupHeaderHeight: number;
  groupGapHeight: number;
  overscanRows?: number;
}

interface ProjectIconPickerLucideRecentPreviewInput {
  rawValue: string;
  iconColor: ProjectIconPickerColor;
}

interface ProjectIconPickerRandomLucideInput {
  iconColor: ProjectIconPickerColor;
  random?: () => number;
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function readProjectIconAskEveryTime(value: unknown): boolean {
  return value === true;
}

export function readProjectIconDefaultColor(value: unknown): ProjectIconPickerColor {
  if (value === "default") return value;
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= 0
    && value < PALETTE_SIZE
    ? value
    : "default";
}

export function stripProjectEmojiSkinTone(emoji: string): string {
  return emoji.replace(PROJECT_EMOJI_SKIN_TONE_PATTERN, "");
}

export function projectEmojiSkinToneFromEmoji(emoji: string): ProjectEmojiSkinTone {
  for (const skinTone of PROJECT_EMOJI_SKIN_TONES) {
    if (skinTone !== "default" && emoji.includes(PROJECT_EMOJI_SKIN_TONE_MODIFIERS[skinTone])) {
      return skinTone;
    }
  }
  return "default";
}

export function applyProjectEmojiSkinTone(
  emoji: string,
  skinTone: ProjectEmojiSkinTone,
): string {
  const baseEmoji = stripProjectEmojiSkinTone(emoji);
  if (skinTone === "default" || !PROJECT_EMOJI_SKIN_TONE_SUPPORTED.has(baseEmoji)) {
    return baseEmoji;
  }
  return PROJECT_EMOJI_SKIN_TONE_VARIANTS[baseEmoji]?.[skinTone as ProjectEmojiVariantSkinTone] ?? baseEmoji;
}

function normalizedQuery(query: string): string {
  return query.trim().toLowerCase();
}

function matchesQuery(terms: string, query: string): boolean {
  const normalized = normalizedQuery(query);
  return !normalized || terms.toLowerCase().includes(normalized);
}

export function filterProjectEmojiEntries(
  entries: readonly ProjectEmojiEntry[],
  query: string,
  category: ProjectEmojiCategoryId | "all",
): ProjectEmojiEntry[] {
  return entries.filter((entry) =>
    (category === "all"
      || entry.category === category
      || (category === "symbols" && entry.category === "flags"))
    && matchesQuery(entry.terms, query)
  );
}

export function filterProjectLucideIcons(
  entries: readonly ProjectLucideIconEntry[],
  query: string,
  category: ProjectLucideCategory | "all",
): ProjectLucideIconEntry[] {
  return entries.filter((entry) =>
    (category === "all" || entry.category === category)
    && matchesQuery(entry.terms, query)
  );
}

export function projectIconPickerVisibleEmojiCategories(
  symbolsAndFlagsLabel: string,
): ProjectIconPickerVisibleEmojiCategory[] {
  return PROJECT_EMOJI_CATEGORIES
    .filter((category) => PROJECT_ICON_PICKER_VISIBLE_EMOJI_CATEGORY_ID_SET.has(category.id))
    .map((category) => ({
      id: category.id,
      label: category.id === "symbols" ? symbolsAndFlagsLabel : category.label,
    }));
}

export function projectIconPickerLucideCategoryIcon(
  category: ProjectLucideCategory,
  entries: readonly ProjectLucideIconEntry[],
): ProjectLucideIconEntry | undefined {
  const preferredSlug = PROJECT_ICON_PICKER_LUCIDE_CATEGORY_ICON_SLUGS[category];
  return entries.find((entry) => entry.slug === preferredSlug)
    ?? entries.find((entry) => entry.category === category);
}

export function projectIconPickerLucideCategoryOptions(
  categories: readonly ProjectLucideCategory[],
  entries: readonly ProjectLucideIconEntry[],
): ProjectIconPickerLucideCategoryOption[] {
  return categories.map((category) => ({
    category,
    icon: projectIconPickerLucideCategoryIcon(category, entries),
  }));
}

export function projectIconPickerPrimaryLucideCategoryOptions(
  options: readonly ProjectIconPickerLucideCategoryOption[],
): ProjectIconPickerLucideCategoryOption[] {
  return PROJECT_ICON_PICKER_PRIMARY_LUCIDE_CATEGORIES
    .map((category) => options.find((option) => option.category === category))
    .filter((option): option is ProjectIconPickerLucideCategoryOption => option !== undefined);
}

export function projectIconPickerIsPrimaryLucideCategory(category: ProjectLucideCategory): boolean {
  return PROJECT_ICON_PICKER_PRIMARY_LUCIDE_CATEGORY_SET.has(category);
}

export function readProjectIconRecentValues(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

export function projectIconEmojiRecentValues(values: readonly string[]): string[] {
  return values.filter((rawValue) => {
    const icon = parseProjectIcon(rawValue);
    return icon.kind === "emoji" || icon.kind === "custom-emoji";
  });
}

export function projectIconLucideRecentValues(values: readonly string[]): string[] {
  return values.filter((rawValue) => parseProjectIcon(rawValue).kind === "lucide");
}

export function projectIconPickerVisibleCustomEmojis(
  customEmojis: readonly ProjectCustomEmoji[],
  query: string,
): readonly ProjectCustomEmoji[] {
  const normalized = normalizedQuery(query);
  if (!normalized) return customEmojis;
  return customEmojis.filter((emoji) => emoji.name.toLowerCase().includes(normalized));
}

export function projectIconPickerLucideGroups(
  entries: readonly ProjectLucideIconEntry[],
  categories: readonly ProjectLucideCategory[],
): ProjectIconPickerVirtualGroupInput<ProjectLucideCategory, ProjectLucideIconEntry>[] {
  const groups = new Map<ProjectLucideCategory, ProjectLucideIconEntry[]>();
  for (const category of categories) {
    groups.set(category, []);
  }
  for (const entry of entries) {
    groups.get(entry.category)?.push(entry);
  }
  return categories
    .map((category) => ({
      category,
      entries: groups.get(category) ?? [],
    }))
    .filter((group) => group.entries.length > 0);
}

export function projectIconPickerLucideRecentPreviewValue({
  rawValue,
  iconColor,
}: ProjectIconPickerLucideRecentPreviewInput): string {
  const icon = parseProjectIcon(rawValue);
  return icon.kind === "lucide"
    ? serializeProjectIcon({ ...icon, color: iconColor })
    : rawValue;
}

function projectIconPickerRandomEntry<TEntry>(
  entries: readonly TEntry[],
  random: () => number,
): TEntry | undefined {
  const firstEntry = entries[0];
  if (firstEntry === undefined) return undefined;
  const sample = random();
  const scaledSample = Number.isFinite(sample) ? sample * entries.length : 0;
  const index = clamp(Math.floor(scaledSample), 0, entries.length - 1);
  return entries[index] ?? firstEntry;
}

export function projectIconPickerRandomEmojiIcon(
  entries: readonly ProjectEmojiEntry[],
  skinTone: ProjectEmojiSkinTone,
  random: () => number = Math.random,
): ProjectIconValue | null {
  const entry = projectIconPickerRandomEntry(entries, random);
  return entry
    ? { kind: "emoji", emoji: applyProjectEmojiSkinTone(entry.emoji, skinTone) }
    : null;
}

export function projectIconPickerRandomLucideIcon(
  entries: readonly ProjectLucideIconEntry[],
  { iconColor, random = Math.random }: ProjectIconPickerRandomLucideInput,
): ProjectIconValue | null {
  const entry = projectIconPickerRandomEntry(entries, random);
  return entry
    ? { kind: "lucide", slug: entry.slug, color: iconColor }
    : null;
}

export function cleanupProjectIconRecentValues(
  values: readonly string[],
  customEmojiIds: ReadonlySet<string>,
  limit = PROJECT_ICON_RECENT_LIMIT,
): string[] {
  const recent: string[] = [];
  const seen = new Set<string>();
  for (const rawValue of values) {
    const value = parseProjectIcon(rawValue);
    if (value.kind === "none") continue;
    if (value.kind === "custom-emoji" && !customEmojiIds.has(value.id)) continue;
    const serialized = serializeProjectIcon(value);
    if (seen.has(serialized)) continue;
    seen.add(serialized);
    recent.push(serialized);
    if (recent.length >= limit) break;
  }
  return recent;
}

export function prependProjectIconRecentValue(
  values: readonly string[],
  value: ProjectIconValue,
  customEmojiIds: ReadonlySet<string>,
  limit = PROJECT_ICON_RECENT_LIMIT,
): string[] {
  const recentValue = projectIconRecentValue(value);
  if (!recentValue) {
    return cleanupProjectIconRecentValues(values, customEmojiIds, limit);
  }
  return cleanupProjectIconRecentValues([recentValue, ...values], customEmojiIds, limit);
}

export function projectIconVirtualWindow(
  itemCount: number,
  columnCount: number,
  rowHeight: number,
  viewportHeight: number,
  scrollTop: number,
  overscanRows = 2,
): ProjectIconVirtualWindow {
  const safeColumnCount = Math.max(1, Math.floor(columnCount));
  const safeRowHeight = Math.max(1, rowHeight);
  const rowCount = Math.ceil(itemCount / safeColumnCount);
  const firstVisibleRow = Math.floor(Math.max(0, scrollTop) / safeRowHeight);
  const visibleRowCount = Math.ceil(Math.max(0, viewportHeight) / safeRowHeight);
  const startRow = Math.max(0, firstVisibleRow - overscanRows);
  const endRow = Math.min(rowCount, firstVisibleRow + visibleRowCount + overscanRows + 1);
  const startIndex = Math.min(itemCount, startRow * safeColumnCount);
  const endIndex = Math.min(itemCount, endRow * safeColumnCount);
  return {
    startIndex,
    endIndex,
    beforeHeight: startRow * safeRowHeight,
    afterHeight: Math.max(0, (rowCount - endRow) * safeRowHeight),
  };
}

export function projectIconPickerPanelPlacement({
  triggerRect,
  boundaryRect,
  preferredWidth,
  preferredHeight,
  align = "end",
  gap = 4,
  inset = 8,
}: ProjectIconPickerPanelPlacementInput): ProjectIconPickerPanelPlacement {
  const safeGap = finiteOrZero(gap);
  const safeInset = finiteOrZero(inset);
  const leftBound = boundaryRect.left + safeInset;
  const rightBound = boundaryRect.right - safeInset;
  const topBound = boundaryRect.top + safeInset;
  const bottomBound = boundaryRect.bottom - safeInset;
  const maxWidth = finiteOrZero(rightBound - leftBound);
  const width = Math.min(finiteOrZero(preferredWidth), maxWidth);
  const preferredLeft = align === "start" ? triggerRect.left : triggerRect.right - width;
  const left = clamp(preferredLeft, leftBound, rightBound - width);
  const preferredTop = triggerRect.bottom + safeGap;
  const top = Math.max(topBound, preferredTop);
  const height = Math.min(
    finiteOrZero(preferredHeight),
    finiteOrZero(bottomBound - top),
  );

  return {
    left,
    top,
    width,
    height,
  };
}

export function projectIconPickerAnchoredPanelPlacement({
  anchorRect,
  viewportRect,
  panelWidth,
  preferredHeight,
  minimumUsefulHeight = 180,
  gap = 4,
  margin = 8,
}: ProjectIconPickerAnchoredPanelPlacementInput): ProjectIconPickerAnchoredPanelPlacement {
  const safeGap = finiteOrZero(gap);
  const safeMargin = finiteOrZero(margin);
  const safePanelWidth = finiteOrZero(panelWidth);
  const safePreferredHeight = finiteOrZero(preferredHeight);
  const safeMinimumHeight = finiteOrZero(minimumUsefulHeight);
  const availableAbove = Math.max(0, anchorRect.top - viewportRect.top - safeMargin - safeGap);
  const availableBelow = Math.max(0, viewportRect.bottom - anchorRect.bottom - safeMargin - safeGap);
  const maxViewportHeight = Math.max(1, viewportRect.height - safeMargin * 2);
  const openAbove = availableAbove >= Math.min(safePreferredHeight, safeMinimumHeight)
    || availableAbove >= availableBelow;
  const height = Math.min(
    safePreferredHeight,
    maxViewportHeight,
    Math.max(safeMinimumHeight, openAbove ? availableAbove : availableBelow),
  );
  const leftBound = viewportRect.left + safeMargin;
  const rightBound = viewportRect.right - safePanelWidth - safeMargin;
  const topBound = viewportRect.top + safeMargin;
  const bottomBound = viewportRect.bottom - height - safeMargin;

  return {
    left: clamp(anchorRect.right - safePanelWidth, leftBound, Math.max(leftBound, rightBound)),
    top: openAbove
      ? Math.max(topBound, anchorRect.top - height - safeGap)
      : clamp(anchorRect.bottom + safeGap, topBound, Math.max(topBound, bottomBound)),
    maxHeight: height,
  };
}

export function projectIconPickerMenuPlacement({
  anchorRect,
  viewportRect,
  menuWidth,
  menuMaxHeight,
  minimumUsefulHeight = 180,
  gap = 4,
  margin = 8,
}: ProjectIconPickerMenuPlacementInput): ProjectIconPickerAnchoredPanelPlacement {
  const safeGap = finiteOrZero(gap);
  const safeMargin = finiteOrZero(margin);
  const safeMenuWidth = finiteOrZero(menuWidth);
  const maxHeight = Math.min(finiteOrZero(menuMaxHeight), Math.max(0, viewportRect.height - safeMargin * 2));
  const below = viewportRect.bottom - anchorRect.bottom - safeMargin;
  const above = anchorRect.top - viewportRect.top - safeMargin;
  const leftBound = viewportRect.left + safeMargin;
  const rightBound = viewportRect.right - safeMenuWidth - safeMargin;

  return {
    left: clamp(anchorRect.right - safeMenuWidth, leftBound, Math.max(leftBound, rightBound)),
    top: below >= Math.min(maxHeight, finiteOrZero(minimumUsefulHeight)) || below >= above
      ? anchorRect.bottom + safeGap
      : Math.max(viewportRect.top + safeMargin, anchorRect.top - maxHeight - safeGap),
    maxHeight,
  };
}

export function projectIconPickerPointPlacement({
  anchorRect,
  viewportRect,
  panelWidth,
  panelHeight,
  gap = 4,
  margin = 8,
}: ProjectIconPickerPointPlacementInput): ProjectIconPickerPointPlacement {
  const safeGap = finiteOrZero(gap);
  const safeMargin = finiteOrZero(margin);
  const safePanelWidth = finiteOrZero(panelWidth);
  const safePanelHeight = finiteOrZero(panelHeight);
  const below = viewportRect.bottom - anchorRect.bottom - safeMargin;
  const above = anchorRect.top - viewportRect.top - safeMargin;
  const leftBound = viewportRect.left + safeMargin;
  const rightBound = viewportRect.right - safePanelWidth - safeMargin;

  return {
    left: clamp(
      anchorRect.left + anchorRect.width / 2 - safePanelWidth / 2,
      leftBound,
      Math.max(leftBound, rightBound),
    ),
    top: below >= safePanelHeight || below >= above
      ? Math.min(anchorRect.bottom + safeGap, viewportRect.bottom - safePanelHeight - safeMargin)
      : Math.max(viewportRect.top + safeMargin, anchorRect.top - safePanelHeight - safeGap),
  };
}

export function projectIconPickerGroupVirtualWindow<TCategory extends string, TEntry>({
  groups,
  columnCount,
  viewportHeight,
  scrollTop,
  rowHeight,
  groupHeaderHeight,
  groupGapHeight,
  overscanRows = 2,
}: ProjectIconPickerGroupVirtualWindowInput<TCategory, TEntry>): ProjectIconPickerGroupVirtualWindow<TCategory, TEntry> {
  const safeColumnCount = Math.max(1, Math.floor(columnCount));
  const safeRowHeight = Math.max(1, rowHeight);
  const safeHeaderHeight = Math.max(0, groupHeaderHeight);
  const safeGapHeight = Math.max(0, groupGapHeight);
  const overscanHeight = Math.max(0, overscanRows) * safeRowHeight;
  const viewportStart = Math.max(0, scrollTop - overscanHeight);
  const viewportEnd = Math.max(0, scrollTop) + Math.max(0, viewportHeight) + overscanHeight;
  const visibleGroups: ProjectIconPickerVirtualGroup<TCategory, TEntry>[] = [];
  let offset = 0;
  let beforeHeight = 0;
  let afterHeight = 0;

  for (const group of groups) {
    const rowCount = Math.ceil(group.entries.length / safeColumnCount);
    const rowsHeight = rowCount * safeRowHeight;
    const groupHeight = safeHeaderHeight + rowsHeight + safeGapHeight;
    const groupStart = offset;
    const groupEnd = groupStart + groupHeight;
    offset = groupEnd;

    if (groupEnd < viewportStart) {
      beforeHeight += groupHeight;
      continue;
    }

    if (groupStart > viewportEnd) {
      afterHeight += groupHeight;
      continue;
    }

    const localStart = Math.max(0, viewportStart - groupStart - safeHeaderHeight);
    const localEnd = Math.min(rowsHeight, viewportEnd - groupStart - safeHeaderHeight);
    const startRow = Math.max(0, Math.floor(localStart / safeRowHeight));
    const endRow = Math.min(
      rowCount,
      Math.max(startRow + 1, Math.ceil(Math.max(0, localEnd) / safeRowHeight)),
    );
    const startIndex = Math.min(group.entries.length, startRow * safeColumnCount);
    const endIndex = Math.min(group.entries.length, endRow * safeColumnCount);
    visibleGroups.push({
      category: group.category,
      entries: group.entries.slice(startIndex, endIndex),
      beforeRowsHeight: startRow * safeRowHeight,
      afterRowsHeight: Math.max(0, (rowCount - endRow) * safeRowHeight),
    });
  }

  return {
    groups: visibleGroups,
    beforeHeight,
    afterHeight,
  };
}
