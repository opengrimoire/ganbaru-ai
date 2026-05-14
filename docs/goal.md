# Goal: full iCalendar compatibility documentation

Create a complete documentation plan for full iCalendar (`.ics`) compatibility in GanbaruAI under `docs/interop/icalendar/`. The goal is not to implement code yet. The goal is to design and document, in enough detail for future implementation, how GanbaruAI can become highly compatible with RFC 5545 iCalendar files and real-world calendar clients while preserving the app's performance, local-first design, and current normalized calendar model.

## Context and motivation

GanbaruAI currently supports a useful `VEVENT`-focused `.ics` import/export subset, but it is not a full RFC 5545 implementation. Recent fixes corrected all-day exclusive `DTEND` handling, status/free-busy rendering, recurring `EXDATE` export time, zoned `RECURRENCE-ID` export, parameter escaping, UTF-8 line folding, and all-day override date handling.

The next step is to write an architectural and milestone documentation set for full `.ics` compatibility, not just Google Calendar and not Google API integration. The target is file-format compatibility for every legal `.ics` file where possible, fully offline, without requiring accounts, tokens, hosted services, or user login. Scheduling transports such as email, CalDAV, or Google may be future optional integrations, but the compatibility architecture must not depend on them.

## Core architectural direction

Use a two-layer model:

1. A lossless iCalendar preservation layer that stores every imported legal iCalendar component, property, parameter, value type, timezone definition, unsupported standard field, and `X-*` extension in durable structured storage, probably jCal-like JSON or a typed JSON representation. This layer supports lossless parse, validation, preservation, and export.
2. The current app projection layer, which keeps GanbaruAI's normalized `calendar_events`, attendees, alarms, overrides, recurrence data, and related data as the lean model used for rendering, editing, pomodoro, search, and visible-window queries.

The docs must emphasize that startup and RAM should stay lean: normal calendar rendering should load only projected rows for the visible window, not raw preserved iCalendar components. Full preserved components should be loaded lazily for import, export, detailed event editing, repair tools, diagnostics, or compatibility checks.

## Required docs structure

Create this docs folder and markdown structure:

```text
docs/interop/icalendar/
  README.md
  standards-scope.md
  architecture.md
  data-model.md
  milestones.md
  conformance-checklist.md
  fixtures-and-clients.md
  edit-merge-policy.md
  recurrence-and-timezones.md
  scheduling-boundary.md
  performance-budget.md
  migration-plan.md
  decisions.md
  clients/
    google-calendar.md
    outlook.md
    apple-calendar.md
    thunderbird.md
    nextcloud.md
    proton-calendar.md
    fastmail.md
```

Each document should be concrete, implementation-oriented, and consistent with GanbaruAI's existing docs style. Use sentence case headings. Do not use em dash characters or double hyphen sequences. Keep the documentation focused and useful, but detailed enough that a future coding agent can implement from it.

## Important content requirements

- Clearly distinguish full RFC 5545 file compatibility from full UI support and from RFC 5546 scheduling workflow.
- Explain that full `.ics` file compatibility can be implemented offline with code only. No Google login, tokens, accounts, or hosted services are required for parse, preserve, validate, and export.
- Explain that actually sending RSVP replies, cancellations, meeting invitations, email alarms, or syncing with remote calendars requires a future user-configured transport such as email, CalDAV, Google, or another provider. That is outside the base offline `.ics` compatibility goal.
- Define the target standards and related RFCs: RFC 5545 iCalendar, RFC 6868 parameter escaping, RFC 5546 scheduling semantics as preserve-first metadata, and client interoperability as practical testing rather than the source of truth.
- Document known current support and gaps: `VEVENT` projection exists, all-day exclusive `DTEND` is fixed, `STATUS`, `TRANSP`, `CLASS`, `PRIORITY`, `SEQUENCE`, `CATEGORIES`, `GEO`, `ORGANIZER`, `ATTENDEE`, `VALARM`, and `X-*` properties have partial support, but the app does not yet fully support every legal component, property, parameter, value type, `VTODO`, `VJOURNAL`, `VFREEBUSY`, full `VTIMEZONE` interpretation, full `VALARM` repeat/duration semantics, complete attendee parameters, complete recurrence semantics, floating timed event preservation, and full scheduling workflow.
- Propose a lossless storage schema at the design level, including tables such as an iCalendar object/import table and an iCalendar component table. Include fields like `calendar_id`, `component_type`, `uid`, `recurrence_id`, raw or structured jCal JSON, `projected_event_id`, preservation status, source metadata, `created_at`, `updated_at`, and indexes. Do not overfit the exact schema, but make the required responsibilities clear.
- Explain import flow: parse `.ics`, validate components, store lossless components, project supported `VEVENT`s into normalized `calendar_events`, preserve unsupported components, warn on lossy projections, and keep re-import dedupe safe.
- Explain export flow: generate `.ics` from preserved components plus current projected edits, update supported fields such as `SUMMARY`, `DTSTART`, `DTEND`, `RRULE`, `EXDATE`, `RECURRENCE-ID`, `STATUS`, `TRANSP`, and `ATTENDEE` while preserving unsupported fields and parameters, and avoid mixing stale raw fields with edited projection data.
- Define an edit merge policy: supported edits update both projection and preserved component; unsupported preserved fields remain untouched; structural edits that invalidate unsupported recurrence or scheduling metadata must either regenerate safely, mark the component as no longer losslessly editable, or warn before export.
- Include a recurrence and timezone plan covering full `RRULE` and `BY*` support, `RDATE`, `EXDATE`, `RECURRENCE-ID`, `RANGE=THISANDFUTURE` preservation, floating dates/times, UTC times, `TZID` times, all-day date values, custom `VTIMEZONE` definitions, DST transitions, window-bounded expansion, caps for pathological rules, and semantic equivalence tests.
- Include performance budgets: startup must not parse preserved components, visible-window load must only query projected rows, recurrence expansion must be window bounded, large imports must be capped or streamed where practical, and export/import can be heavier but should remain bounded and measured.
- Include migration plan: existing normalized events can export normally; existing imported events may not have enough provenance for full lossless reconstruction; future imports should store preservation data; migrations must be idempotent and avoid corrupting user data.
- Include conformance checklist content that enumerates components, major properties, parameters, and value types with columns or status categories such as projected, preserved, exported, editable, tested, and notes.
- Include client-specific docs under `clients/` for Google Calendar, Outlook, Apple Calendar, Thunderbird, Nextcloud, Proton Calendar, and Fastmail. These should document practical quirks, export/import test instructions, fixture ideas, manual test checklists, observed behavior, and a place for test date/version notes. Client docs should not define standards behavior. They should record real-world interoperability observations.
- Include a fixtures-and-clients plan for automated fixtures and manual cross-client testing. Use disposable calendars for manual testing. Include fixture classes like all-day single day, all-day multi-day, yearly all-day, timed recurring with `EXDATE`, overrides with `RECURRENCE-ID`, alarms, attendees, organizer, attachments, custom `X-*` properties, `VTODO`, `VJOURNAL`, `VFREEBUSY`, custom `VTIMEZONE`, floating timed events, non-ASCII text, escaped parameters, folded lines, and invalid or malicious files.
- Include a `decisions.md` architecture decision log with at least initial accepted decisions: use lossless preservation plus normalized projection; preserve scheduling metadata but do not act without transport; keep raw components lazy-loaded; client quirks are test docs, not standards.
- Cross-link these docs from existing `docs/features/calendar.md` and `docs/data/schema.md` where appropriate, without rewriting unrelated content.
- Run formatting or validation checks that are appropriate for markdown/docs-only changes. If full `pnpm -w run validate` is still the project completion gate for docs edits, run it before finalizing.
- After creating the docs, provide a concise summary of files created/updated and any validation results.

## Completion criteria

- The full `docs/interop/icalendar/` documentation set exists with the required files.
- The documents clearly describe the lossless preservation plus normalized projection architecture.
- The documents distinguish offline file compatibility from UI support and scheduling transport.
- The documents include concrete milestones, conformance tracking, performance budgets, migration notes, edit-merge policy, recurrence/timezone design, and client-specific testing plans.
- Existing calendar and schema docs cross-link to the new compatibility documentation where appropriate.
- Appropriate checks have passed, or any skipped checks are explicitly reported with the reason.
