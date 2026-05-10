/**
 * SQLite bridge for user themes.
 *
 * Built-in light and dark themes stay code-pinned (in `stores/themes.ts`)
 * and are never inserted here; the `themes.id` CHECK constraint blocks the
 * shadow at the SQL level too.
 *
 * Tokens live as one row per (theme_id, kind, key) in `theme_tokens`:
 *   kind='source'   keys are bare names (canvas, ink, primary, ...)
 *   kind='app'      keys are app CSS custom property names
 *   kind='calendar' keys are calendar CSS custom property names
 *
 * Reads and writes follow `THEME_TOKEN_ROW_ORDER` so raw rows stay aligned
 * with the editor's section order without adding a persisted sort column.
 *
 * `theme_seed_tokens` mirrors the same shape; per-row reset and
 * "Reset all" copy from seed back to live.
 *
 * Note on atomicity: durable theme writes go through Rust commands backed
 * by sqlx. Multi-row mutations use one transaction.
 */

import { invoke } from "@tauri-apps/api/core";
import { THEME_TOKEN_ROW_ORDER } from "$lib/stores/themes";
import { dbUrl, getDb } from "./db";

export type TokenKind = "source" | "app" | "calendar";

export interface TokenRow {
  theme_id: string;
  kind: TokenKind;
  key: string;
  value: string;
  isolated: number;
}

export interface PaletteRow {
  theme_id: string;
  slot: number;
  value: string;
}

export interface ThemeRow {
  id: string;
  display_name: string;
  blend_canvas: string;
  seed_blend_canvas: string;
  derivation_engine_version: number;
  calendar_default_mode: string;
  calendar_default_custom: string;
  seed_calendar_default_mode: string;
  seed_calendar_default_custom: string;
  /**
   * Decorative sun/moon tag for the theme list and editor icon. Nullable
   * because rows created before migration v5 do not carry it; the hydrate
   * path backfills NULLs from canvas luminance.
   */
  icon_label: "light" | "dark" | null;
  seed_icon_label: "light" | "dark" | null;
  created_at: number;
  updated_at: number;
}

export interface DismissalRow {
  theme_id: string;
  engine_version: number;
  dismissed_at: number;
}

/**
 * Snapshot a user theme as raw row groups suitable for an `insertTheme`
 * call. The store builds one of these from the in-memory `UserTheme`
 * before writing; keeping the DB layer in this shape lets the store
 * stay framework-agnostic.
 */
export interface UserThemeWrite {
  id: string;
  displayName: string;
  iconLabel: "light" | "dark";
  seedIconLabel: "light" | "dark";
  blendCanvas: string;
  seedBlendCanvas: string;
  derivationEngineVersion: number;
  calendarDefaultMode: string;
  calendarDefaultCustom: string;
  seedCalendarDefaultMode: string;
  seedCalendarDefaultCustom: string;
  tokens: ReadonlyArray<{
    kind: TokenKind;
    key: string;
    value: string;
    isolated: boolean;
  }>;
  palette: ReadonlyArray<{ slot: number; value: string }>;
  seedTokens: ReadonlyArray<{
    kind: TokenKind;
    key: string;
    value: string;
    isolated: boolean;
  }>;
  seedPalette: ReadonlyArray<{ slot: number; value: string }>;
}

/**
 * Materialized view of a theme's rows after `loadAllUserThemes`. Caller
 * is responsible for shaping these into the in-memory `UserTheme`.
 */
export interface UserThemeRead {
  theme: ThemeRow;
  tokens: TokenRow[];
  palette: PaletteRow[];
  seedTokens: TokenRow[];
  seedPalette: PaletteRow[];
}

const TOKEN_ORDER_INDEX: ReadonlyMap<string, number> = new Map(
  THEME_TOKEN_ROW_ORDER.map((entry, index) => [`${entry.kind}:${entry.key}`, index] as const),
);

async function activeDbUrl(): Promise<string> {
  await getDb();
  return dbUrl();
}

function compareTokenRows(a: TokenRow, b: TokenRow): number {
  const aOrder = TOKEN_ORDER_INDEX.get(`${a.kind}:${a.key}`) ?? THEME_TOKEN_ROW_ORDER.length;
  const bOrder = TOKEN_ORDER_INDEX.get(`${b.kind}:${b.key}`) ?? THEME_TOKEN_ROW_ORDER.length;
  return a.theme_id.localeCompare(b.theme_id)
    || aOrder - bOrder
    || a.kind.localeCompare(b.kind)
    || a.key.localeCompare(b.key);
}

function comparePaletteRows(a: PaletteRow, b: PaletteRow): number {
  return a.theme_id.localeCompare(b.theme_id) || a.slot - b.slot;
}

export async function loadAllUserThemes(): Promise<UserThemeRead[]> {
  const rows = await invoke<UserThemeRead[]>("theme_load_all", {
    dbUrl: await activeDbUrl(),
  });
  return rows.map((read) => ({
    theme: read.theme,
    tokens: [...read.tokens].sort(compareTokenRows),
    palette: [...read.palette].sort(comparePaletteRows),
    seedTokens: [...read.seedTokens].sort(compareTokenRows),
    seedPalette: [...read.seedPalette].sort(comparePaletteRows),
  }));
}

export async function insertTheme(write: UserThemeWrite): Promise<void> {
  await invoke<void>("theme_insert", { dbUrl: await activeDbUrl(), write });
}

export async function deleteTheme(id: string): Promise<void> {
  await invoke<void>("theme_delete", { dbUrl: await activeDbUrl(), id });
}

/**
 * Replace a theme's full content (every token, palette slot, seed mirror,
 * and blend_canvas) without touching the parent themes row's identity or
 * the `theme_upgrade_dismissals` rows that point at it. Used by the editor
 * commit path so a single Save flushes the in-memory buffer to disk in
 * one shot, and by the JSON-paste replace path.
 *
 * Children rows are wiped and re-inserted because the buffer can shift
 * any row's value or isolated flag arbitrarily; reconciling row-by-row
 * would not be cheaper. The parent themes row is updated in place so
 * created_at survives and dismissals are not cascaded.
 */
export async function replaceThemeContent(write: UserThemeWrite): Promise<void> {
  await invoke<void>("theme_replace_content", {
    dbUrl: await activeDbUrl(),
    write,
  });
}

export async function renameTheme(
  id: string,
  displayName: string,
): Promise<void> {
  await invoke<void>("theme_rename", {
    dbUrl: await activeDbUrl(),
    id,
    displayName,
  });
}

export async function updateTokenValue(
  id: string,
  kind: TokenKind,
  key: string,
  value: string,
): Promise<void> {
  await invoke<void>("theme_update_token_value", {
    dbUrl: await activeDbUrl(),
    id,
    kind,
    key,
    value,
  });
}

export async function updateTokenIsolated(
  id: string,
  kind: TokenKind,
  key: string,
  isolated: boolean,
): Promise<void> {
  await invoke<void>("theme_update_token_isolated", {
    dbUrl: await activeDbUrl(),
    id,
    kind,
    key,
    isolated,
  });
}

/**
 * Update both value AND isolated for a single token. Used by the
 * "relink" path: write the freshly-derived value AND flip isolated to 0.
 */
export async function updateTokenValueAndIsolated(
  id: string,
  kind: TokenKind,
  key: string,
  value: string,
  isolated: boolean,
): Promise<void> {
  await invoke<void>("theme_update_token_value_and_isolated", {
    dbUrl: await activeDbUrl(),
    id,
    kind,
    key,
    value,
    isolated,
  });
}

/**
 * Edit a source value and cascade the resulting derivation through every
 * non-isolated app/calendar token. Caller computes the derived maps in
 * memory (the DB layer stays color-math-agnostic) and passes them in.
 *
 * If `nextBlendCanvas` is provided it is written to themes.blend_canvas
 * in the same transaction. Callers omit it when blend_canvas should
 * stay pinned.
 */
export async function updateSourceCascade(
  id: string,
  sourceKey: string,
  value: string,
  derivedApp: Readonly<Record<string, string>>,
  derivedCal: Readonly<Record<string, string>>,
  nextBlendCanvas?: string,
): Promise<void> {
  await invoke<void>("theme_update_source_cascade", {
    dbUrl: await activeDbUrl(),
    write: {
      id,
      sourceKey,
      value,
      derivedApp,
      derivedCal,
      nextBlendCanvas: nextBlendCanvas ?? null,
    },
  });
}

export async function updatePaletteSlot(
  id: string,
  slot: number,
  value: string,
): Promise<void> {
  await invoke<void>("theme_update_palette_slot", {
    dbUrl: await activeDbUrl(),
    id,
    slot,
    value,
  });
}

export async function updateBlendCanvas(
  id: string,
  value: string,
): Promise<void> {
  await invoke<void>("theme_update_blend_canvas", {
    dbUrl: await activeDbUrl(),
    id,
    value,
  });
}

/**
 * Re-derive every non-isolated app/calendar token from the current
 * sources and stamp the new engine version. Pinned tokens keep their
 * value and stay isolated.
 */
export async function rebakeNonIsolated(
  id: string,
  derivedApp: Readonly<Record<string, string>>,
  derivedCal: Readonly<Record<string, string>>,
  newEngineVersion: number,
  nextBlendCanvas?: string,
): Promise<void> {
  await invoke<void>("theme_rebake_non_isolated", {
    dbUrl: await activeDbUrl(),
    id,
    derivedApp,
    derivedCal,
    newEngineVersion,
    nextBlendCanvas: nextBlendCanvas ?? null,
  });
}

/**
 * Reset a single token to its seed value and seed isolated flag. Used by
 * the per-row reset icon in the editor.
 */
export async function resetTokenToSeed(
  id: string,
  kind: TokenKind,
  key: string,
): Promise<void> {
  await invoke<void>("theme_reset_token_to_seed", {
    dbUrl: await activeDbUrl(),
    id,
    kind,
    key,
  });
}

/**
 * Reset a single palette slot to its seed value.
 */
export async function resetPaletteSlotToSeed(
  id: string,
  slot: number,
): Promise<void> {
  await invoke<void>("theme_reset_palette_slot_to_seed", {
    dbUrl: await activeDbUrl(),
    id,
    slot,
  });
}

/**
 * Restore every token, palette slot, and blend_canvas to its seed value.
 * Used by the editor footer's "Reset all" button.
 */
export async function resetThemeToSeed(id: string): Promise<void> {
  await invoke<void>("theme_reset_to_seed", { dbUrl: await activeDbUrl(), id });
}

/**
 * Backfill a NULL icon_label/seed_icon_label on a legacy row created before
 * migration v5. Called once per affected theme during hydrate; subsequent
 * writes go through `replaceThemeContent` which always supplies a value.
 */
export async function backfillIconLabel(
  id: string,
  iconLabel: "light" | "dark",
): Promise<void> {
  await invoke<void>("theme_backfill_icon_label", {
    dbUrl: await activeDbUrl(),
    id,
    iconLabel,
  });
}

export async function recordDismissal(
  id: string,
  engineVersion: number,
): Promise<void> {
  await invoke<void>("theme_record_dismissal", {
    dbUrl: await activeDbUrl(),
    id,
    engineVersion,
  });
}

export async function loadDismissals(): Promise<DismissalRow[]> {
  return invoke<DismissalRow[]>("theme_load_dismissals", {
    dbUrl: await activeDbUrl(),
  });
}
