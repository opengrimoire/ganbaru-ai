# Testing

## Setup

- **Framework:** vitest (v4+)
- **Config:** `apps/desktop/vitest.config.ts`
- **Path alias:** `$lib` resolves to `apps/desktop/src/lib`

## Running tests

```bash
# From apps/desktop/
pnpm test          # single run
pnpm test:watch    # watch mode

# From root (via turborepo)
pnpm turbo test
```

## Test file locations

Tests live next to the code they test, using the `.test.ts` suffix:

```
apps/desktop/src/lib/
  components/calendar/
    utils.ts           ← source
    utils.test.ts      ← test
    rrule.ts           ← source
    rrule.test.ts      ← test
    recurrence.ts      ← source
    recurrence.test.ts ← test
  stores/
    map-row.ts         ← source
    map-row.test.ts    ← test
  utils/
    pomodoro-segments.ts      ← source
    pomodoro-segments.test.ts ← test
```

## What is tested

### Data layer (unit tests)

| File | What it covers |
|---|---|
| `components/calendar/utils.test.ts` | Date parsing/formatting round-trip, week/day helpers, minute-of-day extraction, duration calculation, grid snapping, event filtering, overlap layout algorithm, time storage round-trip |
| `components/calendar/rrule.test.ts` | RRULE serialization/parsing (simple + BY* rules: ordinal BYDAY, BYMONTHDAY, BYMONTH, BYSETPOS, BYYEARDAY, BYWEEKNO, WKST, UNTIL with datetime), preset round-trips, recurrenceToPreset null cases, formatRecurrenceLabel for all patterns |
| `components/calendar/recurrence.test.ts` | Recurrence expansion (daily/weekly/monthly/yearly, ordinal BYDAY, BYMONTHDAY with short months, UNTIL with datetime, exceptions, overrides, RDATE dedup/exceptions, backward compat), findOrdinalWeekday, parseYMD/fmtYMD |
| `stores/map-row.test.ts` | DB row to CalendarEvent mapping (basic fields, default-to-undefined, JSON deserialization for categories/geo/rdate/extendedProperties/organizer, malformed JSON handling, pomodoro config, color, status, transparency, visibility, all-day, guest permissions default/non-default mapping) |
| `utils/pomodoro-segments.test.ts` | Planned segment computation (cycle iteration, clipping, long break placement, cycle reset), accent band fraction mapping, focus time inheritance (shortened first focus, break-on-threshold, clipping), cycle number inheritance (cross-block propagation, long break triggering), trailing state computation, day timeline bands (single event, sequential inheritance, gap reset, containment, partial overlap, same-range tiebreak, past skipping, active event projection, focus fills from persisted/active segments, fill capping, pause gap visualization in active/persisted focus fills) |

### Not tested (and why)

- **Svelte stores** (`pomodoro.svelte.ts`, `calendar.svelte.ts`): depend on Tauri IPC (`invoke`, `listen`, `execute`). Would need mocking the Tauri runtime. Worth adding when store logic grows more complex.
- **Svelte components**: need a DOM environment + Svelte compiler. Add when UI stabilizes.
- **Rust backend** (`notification.rs`, `tray.rs`): OS-specific (GTK, D-Bus, gsettings). Test manually or with platform-specific CI.

## Adding new tests

1. Create a `.test.ts` file next to the source file
2. Import from `vitest`: `import { describe, it, expect } from "vitest"`
3. Run `pnpm test` from `apps/desktop/`

Pure functions are the best candidates. If a function depends on Tauri IPC or DOM, either extract the pure logic into a separate function or skip it.

## Key conventions

- Tests use the same `$lib` alias as the app code
- No DOM environment configured (tests are Node-only for speed)
- No mocking framework needed for pure function tests
- Test names describe the behavior, not the implementation
