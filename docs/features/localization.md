# Localization

Ganbaru AI supports a typed app language layer for all normal app chrome and main feature surfaces. English is the canonical catalog and Spanish is the first translated catalog. Unsupported or incomplete translations fall back to English at the individual message key level so the app stays usable while catalogs evolve.

## User preference

The Appearance settings page exposes a Language selector with three values:

- `system`: follow the operating system or browser language list.
- `en`: force English.
- `es`: force Spanish.

The selected value persists in the active Ganbaru AI folder root `config.json` as `preferences.language`. Invalid stored values normalize back to `system` on load and are written back as `system` so stale or hand-edited config does not keep failing every boot.

`system` resolves from `navigator.languages` and then `navigator.language`. Exact supported locale matches win first; otherwise the base language is matched, so `es-MX` resolves to `es`. If no candidate is supported, the app resolves to English.

## Runtime behavior

`main.ts` loads the active config before mounting Svelte and initializes localization from that config. The localization store then exposes:

- `languagePreference`: the persisted selector value.
- `locale`: the resolved app locale.
- `direction`: the resolved text direction.
- `t`: the typed translator.
- `setLanguagePreference`: the persistence-aware setter used by settings.

The translator reads from the resolved catalog first, then English. English is typed as the canonical `MessageCatalog`, and non-English catalogs must satisfy that shape partially. Adding a key to English therefore updates the allowed translation key space for every caller.

The app writes `document.documentElement.lang` and `document.documentElement.dir` whenever the resolved locale changes. Current supported locales are left-to-right, but the direction field is part of locale metadata so right-to-left support has a defined entry point later.

## Formatting rules

User-facing date, time, number, plural, relative-minute, and list formatting should use `lib/i18n/formatters.ts` with the current resolved locale. Do not hardcode `"en"` or `"en-US"` in UI formatting unless the value is an external standard, a stable interchange format, or an intentional parser implementation detail.

Storage and interoperability stay canonical:

- Calendar event start and end values remain UTC ISO 8601 instants.
- All-day values remain floating dates.
- SQLite and config keys stay stable English identifiers.
- iCalendar import and export preserve standards-defined values, not translated UI labels.
- Benchmark markdown copied for `docs/PERFORMANCE.md` stays in the canonical English format so historical rows remain comparable.

## Translation scope

Normal app chrome and main feature UI should use catalog keys directly or feature-local localization helpers. This includes settings, title bar controls, calendar panels, Pomodoro overlays, Music, doomscrolling, theme editor labels, diagnostics, and benchmark overlays.

Internal ids, CSS tokens, config keys, SQL columns, benchmark result identity fields, generated benchmark markdown, and tests can remain English when they are not rendered as user-facing text. If an internal English value is rendered, localize at the render boundary instead of changing the stored identity unless the identity itself is obsolete.

## Adding a locale

To add a locale:

1. Add the locale metadata in `apps/client/src/lib/i18n/locales.ts`.
2. Add a catalog under `apps/client/src/lib/i18n/messages/`.
3. Register the catalog in `translator.svelte.ts`.
4. Add the option to `LANGUAGE_PREFERENCES` in `stores/preferences.ts`.
5. Add or update tests for locale resolution, translator fallback, and any locale-specific formatter behavior.
6. Review app surfaces for hardcoded user-facing text and add feature keys where needed.
