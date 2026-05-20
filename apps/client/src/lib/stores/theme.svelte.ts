import { PALETTE_SIZE } from "$lib/components/calendar/types";
import {
  type Theme,
  type ThemeId,
  type ThemeSources,
  type UserTheme,
  BUILTIN_THEME_REGISTRY,
  DEFAULT_THEME_ID,
  DERIVATION_ENGINE_VERSION,
  computeThemeTokenOps,
  defaultIconLabelFromCanvas,
  deriveAppTokens,
  getThemeById,
  isBuiltinThemeId,
  isSemanticSignalAppToken,
  isThemeDark,
  pickQuickToggleTarget,
  generateThemeId,
  normalizeSemanticSignalAppIsolated,
  serializeTheme,
  syncSemanticSignalAppTokens,
  validateThemeJson,
  darkTheme,
  lightTheme,
  APP_TOKEN_KEYS,
  CALENDAR_TOKEN_KEYS,
  THEME_TOKEN_ROW_ORDER,
  BASE_APP_TOKENS,
  BASE_CALENDAR_TOKENS,
  DEFAULT_CALENDAR_DEFAULT_CUSTOM,
  deriveCalendarColorDefaultBundle,
  type CalendarColorDefaultMode,
} from "./themes";
import {
  canResetTokenToSeed,
  cloneTheme,
  mergeThemePatch,
  nextUniqueDisplayName,
  normalizeDisplayName,
  themeIdCollisionError,
  toUserThemeSnapshot,
} from "./themeOperations";
import { flushConfig, getConfigKey, setConfigKey } from "../vault/config";
import {
  backfillIconLabel,
  deleteTheme as dbDeleteTheme,
  insertTheme as dbInsertTheme,
  loadAllUserThemes,
  loadDismissals,
  recordDismissal,
  replaceThemeContent,
  type TokenKind,
  type UserThemeRead,
  type UserThemeWrite,
} from "../api/themes";

const ACTIVE_KEY = "theme.activeId";
const QUICK_TOGGLE_LIGHT_KEY = "theme.quickToggleLightId";
const QUICK_TOGGLE_DARK_KEY = "theme.quickToggleDarkId";
const LEGACY_CUSTOM_KEY = "themes.user";

let customThemes = $state<Record<ThemeId, UserTheme>>({});
let dismissals = $state<Record<ThemeId, number>>({});
let activeId = $state<ThemeId>(DEFAULT_THEME_ID);
let quickToggleLightId = $state<ThemeId>(lightTheme.id);
let quickToggleDarkId = $state<ThemeId>(darkTheme.id);
let appliedTokenKeys = new Set<string>();
let hydrated = false;

/**
 * Themes that exist in memory but have not been written to SQLite yet.
 * `duplicateTheme` adds the new id here; `persistThemeToDb` removes it after
 * a successful INSERT. The buffer model means the editor runs on this
 * in-memory state until the user clicks Save, at which point `persistThemeToDb`
 * flushes the entire snapshot in one shot. Cancel just deletes the entry
 * without ever touching the DB.
 */
const freshThemes = new Set<ThemeId>();

/**
 * Dismissals queued during an editor session for a fresh theme. The
 * `theme_upgrade_dismissals` table FKs back to `themes.id`, so we cannot
 * call `recordDismissal` until the parent row exists. `persistThemeToDb`
 * drains this map after the INSERT lands. For non-fresh themes the
 * dismissal goes straight to disk and never enters this map.
 */
const pendingDismissals = new Map<ThemeId, number>();

function combinedRegistry(): Readonly<Record<ThemeId, Theme>> {
  return { ...BUILTIN_THEME_REGISTRY, ...customThemes };
}

function loadActiveIdFromConfig(): ThemeId {
  const saved = getConfigKey<string | undefined>(ACTIVE_KEY, undefined);
  if (saved && getThemeById(saved, combinedRegistry())) return saved;
  return DEFAULT_THEME_ID;
}

function validThemeId(id: ThemeId, fallback: ThemeId): ThemeId {
  return getThemeById(id, combinedRegistry()) ? id : fallback;
}

function loadQuickToggleIdFromConfig(key: string, fallback: ThemeId): ThemeId {
  const saved = getConfigKey<string | undefined>(key, undefined);
  if (saved && getThemeById(saved, combinedRegistry())) return saved;
  return fallback;
}

function resolveActive(): Theme {
  return getThemeById(activeId, combinedRegistry()) ?? darkTheme;
}

function applyThemeToDom(): void {
  if (typeof document === "undefined") return;
  const theme = resolveActive();
  const root = document.documentElement;
  root.classList.toggle("dark", isThemeDark(theme));
  const { toSet, toClear, applied } = computeThemeTokenOps(
    theme,
    appliedTokenKeys,
  );
  for (const [key, value] of toSet) root.style.setProperty(key, value);
  for (const key of toClear) root.style.removeProperty(key);
  appliedTokenKeys = applied;
}

/**
 * Boot-time hydration: load user themes from SQLite, run the one-time vault
 * migration if a legacy `themes.user` blob is present, resolve the active
 * theme from config, and paint the first frame.
 *
 * Idempotent. main.ts awaits this between `ensureConfigLoaded` and the App
 * import so first paint matches what the user has on disk (no FOUC).
 */
export async function hydrateUserThemes(): Promise<void> {
  if (hydrated) return;
  await migrateVaultThemesIfPresent();
  const reads = await loadAllUserThemes();
  for (const read of reads) {
    const theme = userThemeFromRead(read);
    customThemes[theme.id] = theme;
    // One-time backfill: rows created before migration v5 carry NULL
    // icon_label/seed_icon_label. `userThemeFromRead` derived a value from
    // canvas luminance; persist it so subsequent reads do not need to derive.
    if (
      read.theme.icon_label === null ||
      read.theme.seed_icon_label === null
    ) {
      try {
        await backfillIconLabel(theme.id, theme.iconLabel);
      } catch (err) {
        console.error("icon_label backfill failed for", theme.id, err);
      }
    }
  }
  const dismissalRows = await loadDismissals();
  for (const row of dismissalRows) {
    const prev = dismissals[row.theme_id] ?? 0;
    if (row.engine_version > prev) dismissals[row.theme_id] = row.engine_version;
  }
  activeId = loadActiveIdFromConfig();
  quickToggleLightId = loadQuickToggleIdFromConfig(
    QUICK_TOGGLE_LIGHT_KEY,
    lightTheme.id,
  );
  quickToggleDarkId = loadQuickToggleIdFromConfig(
    QUICK_TOGGLE_DARK_KEY,
    darkTheme.id,
  );
  hydrated = true;
  applyThemeToDom();
}

/**
 * One-time migration: read the legacy `themes.user` JSON blob from
 * vault/config.json, walk each entry through `validateThemeJson` (legacy
 * branch), insert into SQLite, then delete the key from config and flush.
 * Idempotent because a second pass sees no `themes.user` and returns early.
 */
async function migrateVaultThemesIfPresent(): Promise<void> {
  const saved = getConfigKey<Record<string, unknown> | undefined>(
    LEGACY_CUSTOM_KEY,
    undefined,
  );
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return;
  const ids = Object.keys(saved);
  if (ids.length === 0) {
    setConfigKey(LEGACY_CUSTOM_KEY, undefined);
    await flushConfig();
    return;
  }
  for (const key of ids) {
    if (!Object.hasOwn(saved, key)) continue;
    if (isBuiltinThemeId(key)) continue;
    const value = saved[key];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const result = validateThemeJson({
      ...(value as Record<string, unknown>),
      id: key,
    });
    if (!result.ok) {
      console.error("vault theme migration: skipped invalid theme", key, result.errors);
      continue;
    }
    try {
      await dbInsertTheme(userThemeToWrite(result.theme));
    } catch (err) {
      console.error("vault theme migration: insert failed for", key, err);
    }
  }
  setConfigKey(LEGACY_CUSTOM_KEY, undefined);
  await flushConfig();
}

type TokenWrite = UserThemeWrite["tokens"][number];

function orderedTokenRows(
  sources: ThemeSources,
  appTokens: Readonly<Record<string, string>>,
  calendarTokens: Readonly<Record<string, string>>,
  appIsolated: ReadonlySet<string>,
  calendarIsolated: ReadonlySet<string>,
): TokenWrite[] {
  const rows: TokenWrite[] = [];
  for (const entry of THEME_TOKEN_ROW_ORDER) {
    if (entry.kind === "source") {
      rows.push({
        kind: "source",
        key: entry.key,
        value: sources[entry.key],
        isolated: false,
      });
      continue;
    }
    if (entry.kind === "app") {
      rows.push({
        kind: "app",
        key: entry.key,
        value: appTokens[entry.key],
        isolated: appIsolated.has(entry.key),
      });
      continue;
    }
    rows.push({
      kind: "calendar",
      key: entry.key,
      value: calendarTokens[entry.key],
      isolated: calendarIsolated.has(entry.key),
    });
  }
  return rows;
}

/**
 * Shape a {@link UserTheme} into the row groups the DB layer expects.
 */
function userThemeToWrite(theme: UserTheme): UserThemeWrite {
  const appTokens = syncSemanticSignalAppTokens(theme.sources, theme.appTokens);
  const seedAppTokens = syncSemanticSignalAppTokens(
    theme.seedSources,
    theme.seedAppTokens,
  );
  const tokens = orderedTokenRows(
    theme.sources,
    appTokens,
    theme.calendarTokens,
    normalizeSemanticSignalAppIsolated(theme.appIsolated),
    theme.calendarIsolated,
  );
  const palette = theme.eventPalette.map((value, slot) => ({ slot, value }));
  const seedTokens = orderedTokenRows(
    theme.seedSources,
    seedAppTokens,
    theme.seedCalendarTokens,
    normalizeSemanticSignalAppIsolated(theme.seedAppIsolated),
    theme.seedCalendarIsolated,
  );
  const seedPalette = theme.seedEventPalette.map((value, slot) => ({
    slot,
    value,
  }));
  return {
    id: theme.id,
    displayName: theme.displayName,
    iconLabel: theme.iconLabel,
    seedIconLabel: theme.seedIconLabel,
    blendCanvas: theme.blendCanvas,
    seedBlendCanvas: theme.seedBlendCanvas,
    derivationEngineVersion: theme.derivationEngineVersion,
    calendarDefaultMode: theme.calendarDefaultMode,
    calendarDefaultCustom: theme.calendarDefaultCustom,
    seedCalendarDefaultMode: theme.seedCalendarDefaultMode,
    seedCalendarDefaultCustom: theme.seedCalendarDefaultCustom,
    tokens,
    palette,
    seedTokens,
    seedPalette,
  };
}

/**
 * Build a {@link UserTheme} from row groups returned by `loadAllUserThemes`.
 * Missing tokens are backfilled from BASE so a partial DB write or a
 * mid-migration race never crashes the UI. The fallback BASE table is
 * picked from the canvas-row luminance, so a user theme recovers consistent
 * defaults regardless of which built-in family it originally came from.
 */
function userThemeFromRead(read: UserThemeRead): UserTheme {
  const tokenSourceRows = read.tokens.filter((t) => t.kind === "source");
  const tokenAppRows = read.tokens.filter((t) => t.kind === "app");
  const seedSourceRows = read.seedTokens.filter((t) => t.kind === "source");
  const seedAppRows = read.seedTokens.filter((t) => t.kind === "app");
  const sources = sourcesFromRows(
    tokenSourceRows,
    tokenAppRows,
  );
  const seedSources = sourcesFromRows(
    seedSourceRows,
    seedAppRows,
  );
  const fallbackBase = defaultIconLabelFromCanvas(sources.canvas);
  const seedFallbackBase = defaultIconLabelFromCanvas(seedSources.canvas);
  const appTokens = syncSemanticSignalAppTokens(
    sources,
    snapshotFromRows(
      tokenAppRows,
      APP_TOKEN_KEYS,
      BASE_APP_TOKENS[fallbackBase],
    ),
  );
  const calendarTokens = snapshotFromRows(
    read.tokens.filter((t) => t.kind === "calendar"),
    CALENDAR_TOKEN_KEYS,
    BASE_CALENDAR_TOKENS[fallbackBase],
  );
  const seedAppTokens = syncSemanticSignalAppTokens(
    seedSources,
    snapshotFromRows(
      seedAppRows,
      APP_TOKEN_KEYS,
      BASE_APP_TOKENS[seedFallbackBase],
    ),
  );
  const seedCalendarTokens = snapshotFromRows(
    read.seedTokens.filter((t) => t.kind === "calendar"),
    CALENDAR_TOKEN_KEYS,
    BASE_CALENDAR_TOKENS[seedFallbackBase],
  );
  const appIsolated = normalizeSemanticSignalAppIsolated(
    isolatedFromRows(tokenAppRows),
  );
  const calendarIsolated = isolatedFromRows(
    read.tokens.filter((t) => t.kind === "calendar"),
  );
  const seedAppIsolated = normalizeSemanticSignalAppIsolated(
    isolatedFromRows(seedAppRows),
  );
  const seedCalendarIsolated = isolatedFromRows(
    read.seedTokens.filter((t) => t.kind === "calendar"),
  );
  const eventPalette = paletteFromRows(read.palette, fallbackBase);
  const seedEventPalette = paletteFromRows(read.seedPalette, seedFallbackBase);
  // Rows created before migration v5 carry NULL for icon_label/
  // seed_icon_label. Default both from canvas luminance so the icon picks
  // the same value the editor used to render before this field existed.
  const iconLabel: "light" | "dark" =
    read.theme.icon_label === "light" || read.theme.icon_label === "dark"
      ? read.theme.icon_label
      : fallbackBase;
  const seedIconLabel: "light" | "dark" =
    read.theme.seed_icon_label === "light" ||
    read.theme.seed_icon_label === "dark"
      ? read.theme.seed_icon_label
      : seedFallbackBase;
  const calendarDefaultMode = calendarDefaultModeFromRow(
    read.theme.calendar_default_mode,
  );
  const seedCalendarDefaultMode = calendarDefaultModeFromRow(
    read.theme.seed_calendar_default_mode,
  );
  const calendarDefaultCustom = calendarDefaultCustomFromRow(
    read.theme.calendar_default_custom,
    sources.canvas,
  );
  const seedCalendarDefaultCustom = calendarDefaultCustomFromRow(
    read.theme.seed_calendar_default_custom,
    seedSources.canvas,
  );
  return {
    kind: "user",
    id: read.theme.id,
    displayName: read.theme.display_name,
    iconLabel,
    blendCanvas: read.theme.blend_canvas,
    eventPalette,
    derivationEngineVersion: read.theme.derivation_engine_version,
    calendarDefaultMode,
    calendarDefaultCustom,
    sources,
    appTokens,
    calendarTokens,
    appIsolated,
    calendarIsolated,
    seedSources,
    seedAppTokens,
    seedCalendarTokens,
    seedAppIsolated,
    seedCalendarIsolated,
    seedEventPalette,
    seedBlendCanvas: read.theme.seed_blend_canvas,
    seedCalendarDefaultMode,
    seedCalendarDefaultCustom,
    seedIconLabel,
  };
}

function sourcesFromRows(
  rows: ReadonlyArray<{ key: string; value: string }>,
  appRows: ReadonlyArray<{ key: string; value: string }> = [],
): ThemeSources {
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const appMap = new Map(appRows.map((r) => [r.key, r.value]));
  // If the canvas row is missing entirely, fall back to the dark BASE
  // canvas; otherwise pick a fallback table from the canvas luminance.
  const canvas = map.get("canvas") ?? BASE_APP_TOKENS.dark["--background"];
  const fallback = defaultIconLabelFromCanvas(canvas);
  return {
    canvas,
    ink: map.get("ink") ?? BASE_APP_TOKENS[fallback]["--foreground"],
    primary: map.get("primary") ?? BASE_APP_TOKENS[fallback]["--primary"],
    destructive:
      map.get("destructive") ?? BASE_APP_TOKENS[fallback]["--destructive"],
    destructiveText:
      map.get("destructiveText") ??
      appMap.get("--destructive-foreground") ??
      BASE_APP_TOKENS[fallback]["--destructive-foreground"],
    confirm: map.get("confirm") ?? BASE_APP_TOKENS[fallback]["--action-confirm"],
    confirmText:
      map.get("confirmText") ??
      appMap.get("--action-confirm-foreground") ??
      BASE_APP_TOKENS[fallback]["--action-confirm-foreground"],
    warning:
      map.get("warning") ?? BASE_APP_TOKENS[fallback]["--status-tentative"],
    warningText:
      map.get("warningText") ??
      appMap.get("--status-tentative-foreground") ??
      BASE_APP_TOKENS[fallback]["--status-tentative-foreground"],
  };
}

function snapshotFromRows(
  rows: ReadonlyArray<{ key: string; value: string }>,
  order: readonly string[],
  fallback: Readonly<Record<string, string>>,
): Record<string, string> {
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const out: Record<string, string> = {};
  for (const key of order) out[key] = map.get(key) ?? fallback[key];
  return out;
}

function isolatedFromRows(
  rows: ReadonlyArray<{ key: string; isolated: number }>,
): Set<string> {
  const out = new Set<string>();
  for (const r of rows) if (r.isolated) out.add(r.key);
  return out;
}

function paletteFromRows(
  rows: ReadonlyArray<{ slot: number; value: string }>,
  fallbackBase: "light" | "dark",
): string[] {
  const fallbackPalette = fallbackBase === "dark"
    ? darkTheme.eventPalette
    : lightTheme.eventPalette;
  const out: string[] = [...fallbackPalette];
  for (const r of rows) {
    if (r.slot >= 0 && r.slot < PALETTE_SIZE) out[r.slot] = r.value;
  }
  return out;
}

function calendarDefaultModeFromRow(value: string): CalendarColorDefaultMode {
  if (
    value === "light" ||
    value === "dark" ||
    value === "app-canvas" ||
    value === "custom"
  ) {
    return value;
  }
  return "app-canvas";
}

function calendarDefaultCustomFromRow(value: string, fallback: string): string {
  if (/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)) return value;
  if (/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(fallback)) return fallback;
  return DEFAULT_CALENDAR_DEFAULT_CUSTOM;
}

function setTheme(id: ThemeId): void {
  if (!getThemeById(id, combinedRegistry())) return;
  activeId = id;
  applyThemeToDom();
  setConfigKey(ACTIVE_KEY, id);
}

function setQuickToggleTheme(slot: "light" | "dark", id: ThemeId): boolean {
  if (!getThemeById(id, combinedRegistry())) return false;
  if (slot === "light") {
    quickToggleLightId = id;
    setConfigKey(QUICK_TOGGLE_LIGHT_KEY, id);
  } else {
    quickToggleDarkId = id;
    setConfigKey(QUICK_TOGGLE_DARK_KEY, id);
  }
  return true;
}

function resetQuickToggleThemeReference(id: ThemeId): void {
  if (quickToggleLightId === id) {
    quickToggleLightId = lightTheme.id;
    setConfigKey(QUICK_TOGGLE_LIGHT_KEY, quickToggleLightId);
  }
  if (quickToggleDarkId === id) {
    quickToggleDarkId = darkTheme.id;
    setConfigKey(QUICK_TOGGLE_DARK_KEY, quickToggleDarkId);
  }
}

function existingDisplayNames(): string[] {
  return Object.values(combinedRegistry()).map((t) => t.displayName);
}

/**
 * Flush the in-memory state of a theme to SQLite. Called by the editor's
 * Save path. Fresh themes go through `dbInsertTheme`; existing themes
 * use `replaceThemeContent` so dismissal rows survive. Pending dismissals
 * for the theme are recorded after the INSERT lands.
 */
async function persistThemeToDb(id: ThemeId): Promise<void> {
  const current = customThemes[id];
  if (!current) return;
  const write = userThemeToWrite(current);
  if (freshThemes.has(id)) {
    await dbInsertTheme(write);
    freshThemes.delete(id);
    const pending = pendingDismissals.get(id);
    if (pending !== undefined) {
      await recordDismissal(id, pending);
      pendingDismissals.delete(id);
    }
  } else {
    await replaceThemeContent(write);
  }
}

/**
 * Drop a freshly-created theme that the user backed out of without saving.
 * The theme was never inserted into SQLite, so the cleanup is purely
 * in-memory: registry entry, fresh-theme flag, queued dismissal, and the
 * active-id pointer if it was pointing here.
 */
function discardFreshTheme(id: ThemeId): void {
  if (!freshThemes.has(id)) return;
  delete customThemes[id];
  delete dismissals[id];
  freshThemes.delete(id);
  pendingDismissals.delete(id);
  resetQuickToggleThemeReference(id);
  if (id === activeId) {
    activeId = DEFAULT_THEME_ID;
    applyThemeToDom();
    setConfigKey(ACTIVE_KEY, activeId);
  }
}

/**
 * Restore an existing user theme to a JSON snapshot taken at editor-open.
 * Used by the Cancel path to revert in-memory edits without touching the
 * DB (which never received them in the buffer model). The id is locked
 * to the existing slot so the snapshot cannot accidentally fork a new
 * theme.
 */
function restoreThemeFromSnapshot(id: ThemeId, json: string): boolean {
  if (isBuiltinThemeId(id)) return false;
  if (!Object.hasOwn(customThemes, id)) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return false;
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    (parsed as Record<string, unknown>).id = id;
  }
  const result = validateThemeJson(parsed);
  if (!result.ok) return false;
  customThemes[id] = { ...result.theme, id };
  if (id === activeId) applyThemeToDom();
  return true;
}

/**
 * Duplicate an existing theme (built-in or user) into a new in-memory
 * user theme. The row is not in SQLite until the editor commits.
 */
function duplicateTheme(sourceId: ThemeId): ThemeId | undefined {
  const registry = combinedRegistry();
  const source = registry[sourceId];
  if (!source) return undefined;
  const id = generateThemeId(registry);
  const displayName = nextUniqueDisplayName(
    `${source.displayName} copy`,
    existingDisplayNames(),
  );
  const clone = cloneTheme(source, id, displayName);
  customThemes[id] = clone;
  freshThemes.add(id);
  return id;
}

function renameTheme(id: ThemeId, displayName: string): boolean {
  if (isBuiltinThemeId(id)) return false;
  const current = customThemes[id];
  if (!current) return false;
  const normalized = normalizeDisplayName(displayName);
  if (normalized === undefined) return false;
  customThemes[id] = mergeThemePatch(current, { displayName: normalized });
  return true;
}

async function deleteTheme(id: ThemeId): Promise<boolean> {
  if (isBuiltinThemeId(id)) return false;
  if (!Object.hasOwn(customThemes, id)) return false;
  if (!freshThemes.has(id)) {
    await dbDeleteTheme(id);
  }
  freshThemes.delete(id);
  pendingDismissals.delete(id);
  delete customThemes[id];
  delete dismissals[id];
  resetQuickToggleThemeReference(id);
  if (id === activeId) {
    activeId = DEFAULT_THEME_ID;
    applyThemeToDom();
    setConfigKey(ACTIVE_KEY, activeId);
  }
  return true;
}

/**
 * Edit a single source value and cascade derivation through every
 * non-isolated app/calendar token. Pure in-memory: the editor buffer
 * persists only when the user clicks Save, so a streaming drag stays at
 * 60fps without a single SQLite write per pointer move.
 */
function updateSourceValue(
  id: ThemeId,
  sourceKey: keyof ThemeSources,
  value: string,
): boolean {
  const current = customThemes[id];
  if (!current) return false;
  const nextSources: ThemeSources = { ...current.sources, [sourceKey]: value };
  const derivedApp = deriveAppTokens(nextSources);
  const calendarBundle = deriveCalendarColorDefaultBundle(
    nextSources,
    current.calendarDefaultMode,
    current.calendarDefaultCustom,
  );
  const derivedCal = calendarBundle.calendarTokens;
  const nextAppIsolated = normalizeSemanticSignalAppIsolated(
    current.appIsolated,
  );
  const calBgIsolated = current.calendarIsolated.has("--cal-bg");
  const nextBlendCanvas =
    !calBgIsolated && derivedCal["--cal-bg"]
      ? derivedCal["--cal-bg"]
      : undefined;
  const nextAppTokens: Record<string, string> = { ...current.appTokens };
  for (const key of APP_TOKEN_KEYS) {
    if (nextAppIsolated.has(key) && !isSemanticSignalAppToken(key)) continue;
    if (derivedApp[key] !== undefined) nextAppTokens[key] = derivedApp[key];
  }
  const nextCalTokens: Record<string, string> = { ...current.calendarTokens };
  for (const key of CALENDAR_TOKEN_KEYS) {
    if (current.calendarIsolated.has(key)) continue;
    if (derivedCal[key] !== undefined) nextCalTokens[key] = derivedCal[key];
  }
  customThemes[id] = {
    ...current,
    sources: nextSources,
    appTokens: syncSemanticSignalAppTokens(nextSources, nextAppTokens),
    calendarTokens: nextCalTokens,
    appIsolated: nextAppIsolated,
    blendCanvas: nextBlendCanvas ?? current.blendCanvas,
  };
  if (id === activeId) applyThemeToDom();
  return true;
}

/**
 * Pin a token against future derivations. The stored hex stays unchanged
 * (it already equals the current derived value); only the flag flips.
 */
function isolateToken(
  id: ThemeId,
  kind: "app" | "calendar",
  key: string,
): boolean {
  const current = customThemes[id];
  if (!current) return false;
  const set = kind === "app" ? current.appIsolated : current.calendarIsolated;
  if (set.has(key)) return false;
  const nextSet = new Set(set);
  nextSet.add(key);
  customThemes[id] = {
    ...current,
    appIsolated: kind === "app" ? nextSet : current.appIsolated,
    calendarIsolated:
      kind === "calendar" ? nextSet : current.calendarIsolated,
  };
  return true;
}

/**
 * Re-run the current derivation for a token, write the result back, and
 * flip `isolated` to 0. Used by the "Link back" affordance.
 */
function relinkToken(
  id: ThemeId,
  kind: "app" | "calendar",
  key: string,
): boolean {
  const current = customThemes[id];
  if (!current) return false;
  const set = kind === "app" ? current.appIsolated : current.calendarIsolated;
  if (!set.has(key)) return false;
  const derived =
    kind === "app"
      ? deriveAppTokens(current.sources)
      : deriveCalendarColorDefaultBundle(
          current.sources,
          current.calendarDefaultMode,
          current.calendarDefaultCustom,
        ).calendarTokens;
  const fallbackBase = defaultIconLabelFromCanvas(current.sources.canvas);
  const baseTokens =
    kind === "app" ? BASE_APP_TOKENS[fallbackBase] : BASE_CALENDAR_TOKENS[fallbackBase];
  const derivedTokens = derived as Readonly<Record<string, string>>;
  const nextValue =
    derivedTokens[key] ?? (baseTokens as Readonly<Record<string, string>>)[key];
  const nextSet = new Set(set);
  nextSet.delete(key);
  const nextSnapshot =
    kind === "app"
      ? { ...current.appTokens, [key]: nextValue }
      : { ...current.calendarTokens, [key]: nextValue };
  const nextBlendCanvas =
    kind === "calendar" && key === "--cal-bg" ? nextValue : current.blendCanvas;
  customThemes[id] = {
    ...current,
    appTokens: kind === "app" ? nextSnapshot : current.appTokens,
    calendarTokens:
      kind === "calendar" ? nextSnapshot : current.calendarTokens,
    appIsolated: kind === "app" ? nextSet : current.appIsolated,
    calendarIsolated:
      kind === "calendar" ? nextSet : current.calendarIsolated,
    blendCanvas: nextBlendCanvas,
  };
  if (id === activeId) applyThemeToDom();
  return true;
}

/**
 * Write a new hex to a token without changing its isolated flag. The
 * editor only enables direct hex input on isolated rows, so this in
 * practice always writes onto a pinned token. When the token is
 * `--cal-bg`, also update `blendCanvas` so dimmed past-event variants
 * keep blending against the current calendar surface.
 */
function setTokenValue(
  id: ThemeId,
  kind: "app" | "calendar",
  key: string,
  value: string,
): boolean {
  const current = customThemes[id];
  if (!current) return false;
  const nextBlendCanvas =
    kind === "calendar" && key === "--cal-bg" ? value : current.blendCanvas;
  const nextSnapshot =
    kind === "app"
      ? { ...current.appTokens, [key]: value }
      : { ...current.calendarTokens, [key]: value };
  customThemes[id] = {
    ...current,
    appTokens: kind === "app" ? nextSnapshot : current.appTokens,
    calendarTokens:
      kind === "calendar" ? nextSnapshot : current.calendarTokens,
    blendCanvas: nextBlendCanvas,
  };
  if (id === activeId) applyThemeToDom();
  return true;
}

/**
 * Reset a single token to its seed value AND seed isolated flag.
 * Source resets re-run the current derivation through `updateSourceValue`
 * so non-pinned dependents follow the seed canvas/ink/etc.
 */
function resetTokenToSeed(
  id: ThemeId,
  kind: TokenKind,
  key: string,
): boolean {
  const current = customThemes[id];
  if (!current) return false;
  if (!canResetTokenToSeed(current, kind, key)) return false;
  if (kind === "source") {
    const seedValue = current.seedSources[key as keyof ThemeSources];
    if (seedValue === undefined) return true;
    updateSourceValue(id, key as keyof ThemeSources, seedValue);
    return true;
  }
  const seedSnapshot =
    kind === "app" ? current.seedAppTokens : current.seedCalendarTokens;
  const seedIsolatedSet =
    kind === "app" ? current.seedAppIsolated : current.seedCalendarIsolated;
  const nextValue = seedSnapshot[key];
  if (nextValue === undefined) return true;
  const nextIsolatedFlag = seedIsolatedSet.has(key);
  if (!nextIsolatedFlag) return relinkToken(id, kind, key);
  const liveSnapshot =
    kind === "app"
      ? { ...current.appTokens, [key]: nextValue }
      : { ...current.calendarTokens, [key]: nextValue };
  const liveIsolatedSet =
    kind === "app"
      ? new Set(current.appIsolated)
      : new Set(current.calendarIsolated);
  if (nextIsolatedFlag) liveIsolatedSet.add(key);
  else liveIsolatedSet.delete(key);
  const nextBlendCanvas =
    kind === "calendar" && key === "--cal-bg" ? nextValue : current.blendCanvas;
  customThemes[id] = {
    ...current,
    appTokens: kind === "app" ? liveSnapshot : current.appTokens,
    calendarTokens:
      kind === "calendar" ? liveSnapshot : current.calendarTokens,
    appIsolated: kind === "app" ? liveIsolatedSet : current.appIsolated,
    calendarIsolated:
      kind === "calendar" ? liveIsolatedSet : current.calendarIsolated,
    blendCanvas: nextBlendCanvas,
  };
  if (id === activeId) applyThemeToDom();
  return true;
}

function resetPaletteSlot(id: ThemeId, slot: number): boolean {
  const current = customThemes[id];
  if (!current) return false;
  if (slot < 0 || slot >= current.seedEventPalette.length) return false;
  const nextPalette = [...current.eventPalette];
  nextPalette[slot] = current.seedEventPalette[slot];
  customThemes[id] = { ...current, eventPalette: nextPalette };
  if (id === activeId) applyThemeToDom();
  return true;
}

function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function canResetThemeToSeed(id: ThemeId): boolean {
  const current = customThemes[id];
  if (!current) return false;
  for (const key of Object.keys(current.seedSources) as Array<keyof ThemeSources>) {
    if (current.sources[key] !== current.seedSources[key]) return true;
  }
  for (const key of Object.keys(current.seedAppTokens)) {
    if (current.appTokens[key] !== current.seedAppTokens[key]) return true;
  }
  for (const key of Object.keys(current.seedCalendarTokens)) {
    if (current.calendarTokens[key] !== current.seedCalendarTokens[key]) {
      return true;
    }
  }
  if (
    !setsEqual(current.appIsolated, current.seedAppIsolated) ||
    !setsEqual(current.calendarIsolated, current.seedCalendarIsolated)
  ) {
    return true;
  }
  if (current.eventPalette.length !== current.seedEventPalette.length) {
    return true;
  }
  for (let i = 0; i < current.eventPalette.length; i++) {
    if (current.eventPalette[i] !== current.seedEventPalette[i]) return true;
  }
  if (current.blendCanvas !== current.seedBlendCanvas) return true;
  if (current.calendarDefaultMode !== current.seedCalendarDefaultMode) return true;
  if (current.calendarDefaultCustom !== current.seedCalendarDefaultCustom) {
    return true;
  }
  if (current.iconLabel !== current.seedIconLabel) return true;
  return false;
}

/**
 * Restore every token, palette slot, and blend canvas to their seed
 * values.
 */
function resetThemeToSeed(id: ThemeId): boolean {
  const current = customThemes[id];
  if (!current) return false;
  customThemes[id] = {
    ...current,
    sources: { ...current.seedSources },
    appTokens: syncSemanticSignalAppTokens(
      current.seedSources,
      current.seedAppTokens,
    ),
    calendarTokens: { ...current.seedCalendarTokens },
    appIsolated: normalizeSemanticSignalAppIsolated(current.seedAppIsolated),
    calendarIsolated: new Set(current.seedCalendarIsolated),
    eventPalette: [...current.seedEventPalette],
    blendCanvas: current.seedBlendCanvas,
    calendarDefaultMode: current.seedCalendarDefaultMode,
    calendarDefaultCustom: current.seedCalendarDefaultCustom,
    iconLabel: current.seedIconLabel,
  };
  if (id === activeId) applyThemeToDom();
  return true;
}

/**
 * Flip the decorative iconLabel tag on a user theme. Pure in-memory
 * mutator (the buffer flushes on commit). Built-in themes have a
 * code-pinned iconLabel and reject this call.
 */
function setThemeIconLabel(id: ThemeId, iconLabel: "light" | "dark"): boolean {
  if (isBuiltinThemeId(id)) return false;
  const current = customThemes[id];
  if (!current) return false;
  if (current.iconLabel === iconLabel) return false;
  customThemes[id] = { ...current, iconLabel };
  return true;
}

function applyCalendarDefault(
  id: ThemeId,
  mode: CalendarColorDefaultMode,
  customBasis?: string,
): boolean {
  const current = customThemes[id];
  if (!current) return false;
  const nextCustomBasis = customBasis ?? current.calendarDefaultCustom;
  const bundle = deriveCalendarColorDefaultBundle(
    current.sources,
    mode,
    nextCustomBasis,
  );
  const nextCalendarIsolated = new Set(current.calendarIsolated);
  for (const key of CALENDAR_TOKEN_KEYS) nextCalendarIsolated.delete(key);
  customThemes[id] = {
    ...current,
    calendarDefaultMode: mode,
    calendarDefaultCustom: nextCustomBasis,
    calendarTokens: { ...current.calendarTokens, ...bundle.calendarTokens },
    calendarIsolated: nextCalendarIsolated,
    eventPalette: [...bundle.eventPalette],
    blendCanvas: bundle.blendCanvas,
  };
  if (id === activeId) applyThemeToDom();
  return true;
}

function canResetCalendarDefault(id: ThemeId): boolean {
  const current = customThemes[id];
  if (!current) return false;
  return (
    current.calendarDefaultMode !== current.seedCalendarDefaultMode ||
    current.calendarDefaultCustom !== current.seedCalendarDefaultCustom
  );
}

function resetCalendarDefaultToSeed(id: ThemeId): boolean {
  const current = customThemes[id];
  if (!current) return false;
  return applyCalendarDefault(
    id,
    current.seedCalendarDefaultMode,
    current.seedCalendarDefaultCustom,
  );
}

function setPaletteSlot(id: ThemeId, slot: number, value: string): boolean {
  const current = customThemes[id];
  if (!current) return false;
  if (slot < 0 || slot >= current.eventPalette.length) return false;
  const nextPalette = [...current.eventPalette];
  nextPalette[slot] = value;
  customThemes[id] = { ...current, eventPalette: nextPalette };
  if (id === activeId) applyThemeToDom();
  return true;
}

/**
 * Pin the blend canvas, decoupling it from `--cal-bg`. Used when the user
 * explicitly types a different value for the dimmed-event reference.
 */
function setBlendCanvas(id: ThemeId, value: string): boolean {
  const current = customThemes[id];
  if (!current) return false;
  customThemes[id] = { ...current, blendCanvas: value };
  if (id === activeId) applyThemeToDom();
  return true;
}

/**
 * Re-run the current derivation engine on every non-isolated token and
 * stamp the new engine version. Pinned tokens keep their hex and stay
 * isolated.
 */
function rebakeTheme(id: ThemeId): boolean {
  const current = customThemes[id];
  if (!current) return false;
  const derivedApp = deriveAppTokens(current.sources);
  const derivedCal = deriveCalendarColorDefaultBundle(
    current.sources,
    current.calendarDefaultMode,
    current.calendarDefaultCustom,
  ).calendarTokens;
  const nextAppIsolated = normalizeSemanticSignalAppIsolated(
    current.appIsolated,
  );
  const calBgIsolated = current.calendarIsolated.has("--cal-bg");
  const nextBlendCanvas =
    !calBgIsolated && derivedCal["--cal-bg"]
      ? derivedCal["--cal-bg"]
      : undefined;
  const nextApp: Record<string, string> = { ...current.appTokens };
  for (const key of APP_TOKEN_KEYS) {
    if (nextAppIsolated.has(key) && !isSemanticSignalAppToken(key)) continue;
    if (derivedApp[key] !== undefined) nextApp[key] = derivedApp[key];
  }
  const nextCal: Record<string, string> = { ...current.calendarTokens };
  for (const key of CALENDAR_TOKEN_KEYS) {
    if (current.calendarIsolated.has(key)) continue;
    if (derivedCal[key] !== undefined) nextCal[key] = derivedCal[key];
  }
  customThemes[id] = {
    ...current,
    appTokens: syncSemanticSignalAppTokens(current.sources, nextApp),
    appIsolated: nextAppIsolated,
    calendarTokens: nextCal,
    blendCanvas: nextBlendCanvas ?? current.blendCanvas,
    derivationEngineVersion: DERIVATION_ENGINE_VERSION,
  };
  if (id === activeId) applyThemeToDom();
  return true;
}

/**
 * Mark a (theme, engine_version) pair as dismissed. The in-memory state
 * updates immediately so the banner hides. For non-fresh themes the row
 * is recorded straight away. Fresh themes defer the write until the
 * editor commit lands the parent themes row, since the dismissal table
 * has a foreign key to it.
 */
async function dismissUpgrade(id: ThemeId): Promise<boolean> {
  const current = customThemes[id];
  if (!current) return false;
  dismissals[id] = DERIVATION_ENGINE_VERSION;
  if (freshThemes.has(id)) {
    pendingDismissals.set(id, DERIVATION_ENGINE_VERSION);
  } else {
    await recordDismissal(id, DERIVATION_ENGINE_VERSION);
  }
  return true;
}

export type ImportThemeResult =
  | { ok: true; id: ThemeId }
  | { ok: false; errors: string[] };

async function importTheme(json: string): Promise<ImportThemeResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    return {
      ok: false,
      errors: [`could not parse JSON: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
  const result = validateThemeJson(parsed);
  if (!result.ok) return result;
  const registry = combinedRegistry();
  const incomingId = result.theme.id;
  const collisionError = themeIdCollisionError(incomingId, registry);
  if (collisionError) return { ok: false, errors: [collisionError] };
  try {
    await dbInsertTheme(userThemeToWrite(result.theme));
  } catch (err) {
    return {
      ok: false,
      errors: [err instanceof Error ? err.message : String(err)],
    };
  }
  customThemes[incomingId] = result.theme;
  return { ok: true, id: incomingId };
}

function exportTheme(id: ThemeId): string | undefined {
  const theme = combinedRegistry()[id];
  if (!theme) return undefined;
  return serializeTheme(toUserThemeSnapshot(theme));
}

export type ReplaceThemeResult =
  | { ok: true }
  | { ok: false; errors: string[] };

/**
 * Replace a user theme in place from raw JSON. The id is locked to the
 * existing slot so the editor's "Apply changes" path cannot accidentally
 * fork into a new theme. Built-in ids and unknown ids are rejected.
 */
async function replaceTheme(
  id: ThemeId,
  json: string,
): Promise<ReplaceThemeResult> {
  if (isBuiltinThemeId(id)) {
    return { ok: false, errors: ["built-in themes cannot be edited"] };
  }
  if (!Object.hasOwn(customThemes, id)) {
    return { ok: false, errors: ["theme not found"] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    return {
      ok: false,
      errors: [
        `could not parse JSON: ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }
  // Force the validator to evaluate against the locked id so callers cannot
  // sneak through a rename by editing the id field in the textarea.
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    (parsed as Record<string, unknown>).id = id;
  }
  const result = validateThemeJson(parsed);
  if (!result.ok) return result;
  const next: UserTheme = { ...result.theme, id };
  customThemes[id] = next;
  if (id === activeId) applyThemeToDom();
  await persistThemeToDb(id);
  return { ok: true };
}

/**
 * Returns true when the current engine version differs from the theme's
 * stamp AND the user has not dismissed an upgrade prompt for that pair.
 */
function shouldOfferRebake(theme: UserTheme): boolean {
  if (theme.derivationEngineVersion >= DERIVATION_ENGINE_VERSION) return false;
  const dismissed = dismissals[theme.id] ?? 0;
  return dismissed < DERIVATION_ENGINE_VERSION;
}

/**
 * Access the active theme and mutators. Returns an object of getters so
 * Svelte's reactivity tracks reads and re-runs derived values when the
 * active theme changes.
 */
export function getTheme() {
  return {
    get current(): Theme {
      return resolveActive();
    },
    get id(): ThemeId {
      return activeId;
    },
    get quickToggleLightId(): ThemeId {
      return validThemeId(quickToggleLightId, lightTheme.id);
    },
    get quickToggleDarkId(): ThemeId {
      return validThemeId(quickToggleDarkId, darkTheme.id);
    },
    get isDark(): boolean {
      return isThemeDark(resolveActive());
    },
    /** Combined registry of built-in and user themes. */
    get registry(): Readonly<Record<ThemeId, Theme>> {
      return combinedRegistry();
    },
    /** Snapshot of just the user-authored themes. */
    get customThemes(): Readonly<Record<ThemeId, UserTheme>> {
      return customThemes;
    },
    isBuiltin(id: ThemeId): boolean {
      return isBuiltinThemeId(id);
    },
    shouldOfferRebake,
    setTheme,
    setQuickToggleTheme,
    duplicateTheme,
    renameTheme,
    deleteTheme,
    importTheme,
    exportTheme,
    replaceTheme,
    updateSourceValue,
    isolateToken,
    relinkToken,
    setTokenValue,
    resetTokenToSeed,
    resetPaletteSlot,
    canResetThemeToSeed,
    resetThemeToSeed,
    setThemeIconLabel,
    applyCalendarDefault,
    canResetCalendarDefault,
    resetCalendarDefaultToSeed,
    setPaletteSlot,
    setBlendCanvas,
    rebakeTheme,
    dismissUpgrade,
    persistThemeToDb,
    discardFreshTheme,
    restoreThemeFromSnapshot,
    toggle() {
      const nextId = pickQuickToggleTarget({
        activeId,
        activeIsDark: isThemeDark(resolveActive()),
        lightId: validThemeId(quickToggleLightId, lightTheme.id),
        darkId: validThemeId(quickToggleDarkId, darkTheme.id),
      });
      setTheme(nextId);
    },
  };
}
