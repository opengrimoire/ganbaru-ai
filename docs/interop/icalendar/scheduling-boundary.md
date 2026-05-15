# Scheduling boundary

iCalendar scheduling metadata is data. Sending scheduling messages is a separate capability.

## Offline compatibility

GanbaruAI can parse, preserve, edit carefully, and export scheduling-related fields offline:

- `METHOD`
- `ORGANIZER`
- `ATTENDEE`
- `PARTSTAT`
- `RSVP`
- `ROLE`
- `CUTYPE`
- `DELEGATED-FROM`
- `DELEGATED-TO`
- `SENT-BY`
- `MEMBER`
- `REQUEST-STATUS`
- `STATUS:CANCELLED`
- recurrence overrides used for updates and cancellations

This requires no account setup.

## Transport-backed actions

These actions require identity and transport:

- send meeting invitations
- send cancellation messages
- send RSVP replies
- update someone else's calendar
- notify attendees
- send email alarms
- sync with Google Calendar, CalDAV, Outlook, or another remote provider

Future transports may include:

- user-configured email
- CalDAV
- Google Calendar integration
- Microsoft integration
- local `.ics` invitation file export

No transport should be required for base import/export compatibility.

## UI policy

Until GanbaruAI has an identity model:

- attendee response status is read-only.
- the app must not let a user accept, decline, or tentatively accept as another attendee.
- organizer and attendee data can be displayed as imported metadata.
- offline edits should not imply that attendees were notified.
- local placeholder RSVP state may be stored for UI patterns, but it is app-local metadata and must not be exported as an `ATTENDEE`.

If future identity support exists:

- the app can identify the attendee row matching the current user.
- RSVP actions can update that attendee row.
- sending the reply still requires a configured transport.

## Import policy

When importing scheduling components:

- preserve `METHOD`.
- preserve organizer and attendee parameters.
- project event data into calendar rows when possible.
- warn that invitation workflow semantics are not acted on.
- treat imported data as the user's local copy unless a future sync source says otherwise.

## Export policy

When exporting scheduling metadata:

- preserve original scheduling fields when no unsafe edit occurred.
- include diagnostics for edited offline invitations.
- avoid generating `METHOD:REQUEST` for ordinary local calendar export unless the source calendar has one distinct preserved scheduling method or the user explicitly exports an invitation.
- fall back to `METHOD:PUBLISH` when an exported calendar contains mixed preserved methods, because one `VCALENDAR` cannot represent multiple scheduling message types truthfully.
- do not fabricate attendee replies.

## Future scheduling modes

Suggested explicit modes:

- **Calendar backup export:** exports calendar data, no send semantics.
- **Invitation file export:** exports one event as a scheduling object for manual sending.
- **Transport send:** sends via configured email, CalDAV, or provider API.
- **Subscription export:** produces a read-only feed shape.

Each mode should declare whether it preserves, strips, or generates scheduling metadata.
