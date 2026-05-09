/**
 * SQLite bridge for user themes.
 *
 * Built-in light and dark themes stay code-pinned (in `stores/themes.ts`)
 * and are never inserted here; the `themes.id` CHECK constraint blocks the
 * shadow at the SQL level too.
 *
 * Tokens live as one row per (theme_id, kind, key) in `theme_tokens`:
 *   kind='source'   keys are bare names (canvas, ink, primary, ...)
 *   kind='app'      keys are `--prefixed` CSS custom property names
 *   kind='calendar' keys are `--prefixed` calendar token names
 *
 * Reads and writes follow `THEME_TOKEN_ROW_ORDER` so raw rows stay aligned
 * with the editor's section order without adding a persisted sort column.
 *
 * `theme_seed_tokens` mirrors the same shape; per-row reset and
 * "Reset all" copy from seed back to live.
 *
 * Note on atomicity: tauri-plugin-sql exposes only `execute(sql, args)`
 * over a sqlx connection pool, so raw `BEGIN`/`COMMIT` payloads do not
 * compose into a real transaction (each statement may run on a different
 * connection). Multi-statement mutators below run as a sequence of
 * auto-committed statements; `insertTheme` cleans up after itself on
 * failure (DELETE cascades children) so a half-inserted theme cannot
 * survive. Update mutators are inherently recoverable: a partially
 * applied source cascade can be retried by the user.
 */

import { execute, select } from "./db";
import { THEME_TOKEN_ROW_ORDER } from "$lib/stores/themes";

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

const TOKEN_ORDER_CASE = [
  "CASE",
  ...THEME_TOKEN_ROW_ORDER.map(
    (entry, index) =>
      `WHEN kind = '${entry.kind}' AND key = '${entry.key}' THEN ${index}`,
  ),
  `ELSE ${THEME_TOKEN_ROW_ORDER.length}`,
  "END",
].join(" ");

const TOKEN_ORDER_BY = `theme_id ASC, ${TOKEN_ORDER_CASE}, kind ASC, key ASC`;
const PALETTE_ORDER_BY = "theme_id ASC, slot ASC";

export async function loadAllUserThemes(): Promise<UserThemeRead[]> {
  const themes = await select<ThemeRow>(
    "SELECT * FROM themes ORDER BY created_at ASC",
  );
  if (themes.length === 0) return [];
  const tokens = await select<TokenRow>(
    `SELECT theme_id, kind, key, value, isolated FROM theme_tokens ORDER BY ${TOKEN_ORDER_BY}`,
  );
  const palette = await select<PaletteRow>(
    `SELECT theme_id, slot, value FROM theme_event_palette ORDER BY ${PALETTE_ORDER_BY}`,
  );
  const seedTokens = await select<TokenRow>(
    `SELECT theme_id, kind, key, value, isolated FROM theme_seed_tokens ORDER BY ${TOKEN_ORDER_BY}`,
  );
  const seedPalette = await select<PaletteRow>(
    `SELECT theme_id, slot, value FROM theme_seed_event_palette ORDER BY ${PALETTE_ORDER_BY}`,
  );
  const tokensByTheme = groupBy(tokens, (r) => r.theme_id);
  const paletteByTheme = groupBy(palette, (r) => r.theme_id);
  const seedTokensByTheme = groupBy(seedTokens, (r) => r.theme_id);
  const seedPaletteByTheme = groupBy(seedPalette, (r) => r.theme_id);
  return themes.map((theme) => ({
    theme,
    tokens: tokensByTheme.get(theme.id) ?? [],
    palette: paletteByTheme.get(theme.id) ?? [],
    seedTokens: seedTokensByTheme.get(theme.id) ?? [],
    seedPalette: seedPaletteByTheme.get(theme.id) ?? [],
  }));
}

export async function insertTheme(write: UserThemeWrite): Promise<void> {
  const now = Date.now();
  try {
    await execute(
      `INSERT INTO themes
        (id, display_name, icon_label, seed_icon_label, blend_canvas,
         seed_blend_canvas, derivation_engine_version, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
      [
        write.id,
        write.displayName,
        write.iconLabel,
        write.seedIconLabel,
        write.blendCanvas,
        write.seedBlendCanvas,
        write.derivationEngineVersion,
        now,
      ],
    );
    for (const t of write.tokens) {
      await execute(
        "INSERT INTO theme_tokens (theme_id, kind, key, value, isolated) VALUES ($1, $2, $3, $4, $5)",
        [write.id, t.kind, t.key, t.value, t.isolated ? 1 : 0],
      );
    }
    for (const p of write.palette) {
      await execute(
        "INSERT INTO theme_event_palette (theme_id, slot, value) VALUES ($1, $2, $3)",
        [write.id, p.slot, p.value],
      );
    }
    for (const t of write.seedTokens) {
      await execute(
        "INSERT INTO theme_seed_tokens (theme_id, kind, key, value, isolated) VALUES ($1, $2, $3, $4, $5)",
        [write.id, t.kind, t.key, t.value, t.isolated ? 1 : 0],
      );
    }
    for (const p of write.seedPalette) {
      await execute(
        "INSERT INTO theme_seed_event_palette (theme_id, slot, value) VALUES ($1, $2, $3)",
        [write.id, p.slot, p.value],
      );
    }
  } catch (err) {
    try {
      await execute("DELETE FROM themes WHERE id = $1", [write.id]);
    } catch {
      // best-effort cleanup; if the parent row never inserted there is
      // nothing to clean up, and if it did the cascade above clears
      // every child row.
    }
    throw err;
  }
}

export async function deleteTheme(id: string): Promise<void> {
  await execute("DELETE FROM themes WHERE id = $1", [id]);
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
  const now = Date.now();
  await execute(
    `UPDATE themes
        SET display_name = $1,
            icon_label = $2,
            seed_icon_label = $3,
            blend_canvas = $4,
            seed_blend_canvas = $5,
            derivation_engine_version = $6,
            updated_at = $7
      WHERE id = $8`,
    [
      write.displayName,
      write.iconLabel,
      write.seedIconLabel,
      write.blendCanvas,
      write.seedBlendCanvas,
      write.derivationEngineVersion,
      now,
      write.id,
    ],
  );
  await execute("DELETE FROM theme_tokens WHERE theme_id = $1", [write.id]);
  await execute("DELETE FROM theme_event_palette WHERE theme_id = $1", [
    write.id,
  ]);
  await execute("DELETE FROM theme_seed_tokens WHERE theme_id = $1", [
    write.id,
  ]);
  await execute(
    "DELETE FROM theme_seed_event_palette WHERE theme_id = $1",
    [write.id],
  );
  for (const t of write.tokens) {
    await execute(
      "INSERT INTO theme_tokens (theme_id, kind, key, value, isolated) VALUES ($1, $2, $3, $4, $5)",
      [write.id, t.kind, t.key, t.value, t.isolated ? 1 : 0],
    );
  }
  for (const p of write.palette) {
    await execute(
      "INSERT INTO theme_event_palette (theme_id, slot, value) VALUES ($1, $2, $3)",
      [write.id, p.slot, p.value],
    );
  }
  for (const t of write.seedTokens) {
    await execute(
      "INSERT INTO theme_seed_tokens (theme_id, kind, key, value, isolated) VALUES ($1, $2, $3, $4, $5)",
      [write.id, t.kind, t.key, t.value, t.isolated ? 1 : 0],
    );
  }
  for (const p of write.seedPalette) {
    await execute(
      "INSERT INTO theme_seed_event_palette (theme_id, slot, value) VALUES ($1, $2, $3)",
      [write.id, p.slot, p.value],
    );
  }
}

export async function renameTheme(
  id: string,
  displayName: string,
): Promise<void> {
  await execute(
    "UPDATE themes SET display_name = $1, updated_at = $2 WHERE id = $3",
    [displayName, Date.now(), id],
  );
}

export async function updateTokenValue(
  id: string,
  kind: TokenKind,
  key: string,
  value: string,
): Promise<void> {
  await execute(
    "UPDATE theme_tokens SET value = $1 WHERE theme_id = $2 AND kind = $3 AND key = $4",
    [value, id, kind, key],
  );
  await execute("UPDATE themes SET updated_at = $1 WHERE id = $2", [
    Date.now(),
    id,
  ]);
}

export async function updateTokenIsolated(
  id: string,
  kind: TokenKind,
  key: string,
  isolated: boolean,
): Promise<void> {
  await execute(
    "UPDATE theme_tokens SET isolated = $1 WHERE theme_id = $2 AND kind = $3 AND key = $4",
    [isolated ? 1 : 0, id, kind, key],
  );
  await execute("UPDATE themes SET updated_at = $1 WHERE id = $2", [
    Date.now(),
    id,
  ]);
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
  await execute(
    "UPDATE theme_tokens SET value = $1, isolated = $2 WHERE theme_id = $3 AND kind = $4 AND key = $5",
    [value, isolated ? 1 : 0, id, kind, key],
  );
  await execute("UPDATE themes SET updated_at = $1 WHERE id = $2", [
    Date.now(),
    id,
  ]);
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
  const now = Date.now();
  await execute(
    "UPDATE theme_tokens SET value = $1 WHERE theme_id = $2 AND kind = 'source' AND key = $3",
    [value, id, sourceKey],
  );
  for (const [k, v] of Object.entries(derivedApp)) {
    await execute(
      "UPDATE theme_tokens SET value = $1 WHERE theme_id = $2 AND kind = 'app' AND key = $3 AND isolated = 0",
      [v, id, k],
    );
  }
  for (const [k, v] of Object.entries(derivedCal)) {
    await execute(
      "UPDATE theme_tokens SET value = $1 WHERE theme_id = $2 AND kind = 'calendar' AND key = $3 AND isolated = 0",
      [v, id, k],
    );
  }
  if (nextBlendCanvas !== undefined) {
    await execute(
      "UPDATE themes SET blend_canvas = $1, updated_at = $2 WHERE id = $3",
      [nextBlendCanvas, now, id],
    );
  } else {
    await execute("UPDATE themes SET updated_at = $1 WHERE id = $2", [
      now,
      id,
    ]);
  }
}

export async function updatePaletteSlot(
  id: string,
  slot: number,
  value: string,
): Promise<void> {
  await execute(
    "UPDATE theme_event_palette SET value = $1 WHERE theme_id = $2 AND slot = $3",
    [value, id, slot],
  );
  await execute("UPDATE themes SET updated_at = $1 WHERE id = $2", [
    Date.now(),
    id,
  ]);
}

export async function updateBlendCanvas(
  id: string,
  value: string,
): Promise<void> {
  await execute(
    "UPDATE themes SET blend_canvas = $1, updated_at = $2 WHERE id = $3",
    [value, Date.now(), id],
  );
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
  const now = Date.now();
  for (const [k, v] of Object.entries(derivedApp)) {
    await execute(
      "UPDATE theme_tokens SET value = $1 WHERE theme_id = $2 AND kind = 'app' AND key = $3 AND isolated = 0",
      [v, id, k],
    );
  }
  for (const [k, v] of Object.entries(derivedCal)) {
    await execute(
      "UPDATE theme_tokens SET value = $1 WHERE theme_id = $2 AND kind = 'calendar' AND key = $3 AND isolated = 0",
      [v, id, k],
    );
  }
  if (nextBlendCanvas !== undefined) {
    await execute(
      "UPDATE themes SET blend_canvas = $1, derivation_engine_version = $2, updated_at = $3 WHERE id = $4",
      [nextBlendCanvas, newEngineVersion, now, id],
    );
  } else {
    await execute(
      "UPDATE themes SET derivation_engine_version = $1, updated_at = $2 WHERE id = $3",
      [newEngineVersion, now, id],
    );
  }
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
  await execute(
    `UPDATE theme_tokens
       SET value = (SELECT value FROM theme_seed_tokens
                    WHERE theme_id = $1 AND kind = $2 AND key = $3),
           isolated = (SELECT isolated FROM theme_seed_tokens
                       WHERE theme_id = $1 AND kind = $2 AND key = $3)
     WHERE theme_id = $1 AND kind = $2 AND key = $3`,
    [id, kind, key],
  );
  await execute("UPDATE themes SET updated_at = $1 WHERE id = $2", [
    Date.now(),
    id,
  ]);
}

/**
 * Reset a single palette slot to its seed value.
 */
export async function resetPaletteSlotToSeed(
  id: string,
  slot: number,
): Promise<void> {
  await execute(
    `UPDATE theme_event_palette
       SET value = (SELECT value FROM theme_seed_event_palette
                    WHERE theme_id = $1 AND slot = $2)
     WHERE theme_id = $1 AND slot = $2`,
    [id, slot],
  );
  await execute("UPDATE themes SET updated_at = $1 WHERE id = $2", [
    Date.now(),
    id,
  ]);
}

/**
 * Restore every token, palette slot, and blend_canvas to its seed value.
 * Used by the editor footer's "Reset all" button.
 */
export async function resetThemeToSeed(id: string): Promise<void> {
  await execute(
    `UPDATE theme_tokens AS t
       SET value = (SELECT value FROM theme_seed_tokens AS s
                    WHERE s.theme_id = t.theme_id AND s.kind = t.kind AND s.key = t.key),
           isolated = (SELECT isolated FROM theme_seed_tokens AS s
                       WHERE s.theme_id = t.theme_id AND s.kind = t.kind AND s.key = t.key)
     WHERE t.theme_id = $1`,
    [id],
  );
  await execute(
    `UPDATE theme_event_palette AS p
       SET value = (SELECT value FROM theme_seed_event_palette AS s
                    WHERE s.theme_id = p.theme_id AND s.slot = p.slot)
     WHERE p.theme_id = $1`,
    [id],
  );
  await execute(
    `UPDATE themes
       SET blend_canvas = seed_blend_canvas, updated_at = $1
     WHERE id = $2`,
    [Date.now(), id],
  );
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
  await execute(
    "UPDATE themes SET icon_label = $1, seed_icon_label = $1 WHERE id = $2",
    [iconLabel, id],
  );
}

export async function recordDismissal(
  id: string,
  engineVersion: number,
): Promise<void> {
  await execute(
    `INSERT OR REPLACE INTO theme_upgrade_dismissals
       (theme_id, engine_version, dismissed_at)
     VALUES ($1, $2, $3)`,
    [id, engineVersion, Date.now()],
  );
}

export async function loadDismissals(): Promise<DismissalRow[]> {
  return select<DismissalRow>(
    "SELECT theme_id, engine_version, dismissed_at FROM theme_upgrade_dismissals",
  );
}

function groupBy<T, K>(rows: readonly T[], key: (row: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = out.get(k);
    if (list) list.push(row);
    else out.set(k, [row]);
  }
  return out;
}
