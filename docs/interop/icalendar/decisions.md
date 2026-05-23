# Decisions

This log records architecture decisions for iCalendar compatibility. New entries should include date, status, decision, and rationale.

## 2026-05-14: use lossless preservation plus normalized projection

Status: accepted.

Decision:

GanbaruAI will pursue full `.ics` compatibility with two layers:

- a lossless iCalendar preservation layer
- the existing normalized app projection layer

Rationale:

This preserves unsupported standard data without loading every iCalendar field into the calendar UI model. It keeps startup and visible-window performance focused on projected rows while enabling lossless import/export.

## 2026-05-14: preserve scheduling metadata but do not act without transport

Status: accepted.

Decision:

RFC 5546 scheduling fields are parsed and preserved as metadata. GanbaruAI will not send replies, cancellations, invitations, or updates unless a future user-configured transport exists.

Rationale:

Offline `.ics` compatibility does not require accounts or tokens. Actual scheduling actions require identity and delivery.

## 2026-05-14: keep preserved components lazy-loaded

Status: accepted.

Decision:

The normal calendar boot path and visible-window queries must not load full preserved iCalendar component trees.

Rationale:

Full compatibility should not penalize everyday calendar rendering. Import, export, diagnostics, and detail views can load preserved data on demand.

## 2026-05-14: client quirks are test docs, not standards

Status: accepted.

Decision:

Client-specific docs record Google, Outlook, Apple Calendar, Thunderbird, Nextcloud, Proton Calendar, and Fastmail behavior, but standards docs define correctness.

Rationale:

Client behavior changes over time and may deviate from RFCs. GanbaruAI should be standards-based while still testing real-world interoperability.

## 2026-05-14: use structured export merging, not raw text splicing

Status: accepted.

Decision:

Exports should be generated from structured preserved data plus projected edits. Raw component text may be kept for diagnostics, but should not be spliced with edited fields.

Rationale:

Raw text splicing risks duplicate properties, stale values, broken folding, and invalid parameter escaping. Structured merging is safer and testable.
