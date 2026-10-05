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
import { ensureDbUrl } from "$lib/api/db";

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
  /** Decorative sun/moon tag for the theme list and editor icon. */
  icon_label: "light" | "dark";
  seed_icon_label: "light" | "dark";
  created_at_ms: number;
  updated_at_ms: number;
}

export interface DismissalRow {
  theme_id: string;
  engine_version: number;
  dismissed_at_ms: number;
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
  return ensureDbUrl();
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
 * created_at_ms survives and dismissals are not cascaded.
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
 * Restore every token, palette slot, and blend_canvas to its seed value.
 * Used by the editor footer's "Reset all" button.
 */
export async function resetThemeToSeed(id: string): Promise<void> {
  await invoke<void>("theme_reset_to_seed", { dbUrl: await activeDbUrl(), id });
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
