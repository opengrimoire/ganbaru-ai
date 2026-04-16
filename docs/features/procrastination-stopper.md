# Procrastination stopper

The stopper enforces blocking rules: which sites and apps are off-limits during scheduled focus times and morning routines. Two implementations: a browser extension on desktop, app-level blocking on mobile.

This doc is a placeholder. Deeper design comes in a later pass.

## Desktop: browser extension

A Chrome and Firefox extension connected to the Tauri backend via native messaging. The extension receives blocklist configurations from the app and enforces them by redirecting blocked URLs to a branded block page.

The blocking is content-specific where possible. For example: block unrelated YouTube videos while allowing videos related to the current task. Initial implementation uses keyword and channel matching; deeper content analysis (via the LLM layer) is a later enhancement.

The block page is intentionally minimal: it states the site is blocked and shows the active environment name. No gamification elements, motivational quotes, or stats appear there, because the block page itself should not be a distraction. (Long-term, optional motivation surfaces are possible but low priority.)

## Mobile: app-level blocking

Blocks entire apps according to the user's configured rules. Active during scheduled focus times and morning routines. Implementation uses the platform's screen time / focus mode APIs where available.

## Configuration: tied to work environments

Each work environment carries its own ruleset (see `features/work-environments.md`). Switching environments switches the active rules. The user does not configure the blocker as a separate system; they configure environments, and the blocker enforces what the active environment specifies.

## Trigger logging

Every block event (blocked URL, blocked app launch attempt) is logged with timestamp, what was blocked, and what was active at the time. These logs feed productivity analytics and can show patterns like "most distraction attempts happen in the first 10 minutes of focus."

## Linkage to other systems

- **Pomodoro:** active during focus periods of a session with a configured environment.
- **Work environments:** rules are part of the environment config.
- **Sleep alarm:** morning rules activate on alarm dismissal (see `features/sleep-alarm.md`).
- **AI panel:** content-aware blocking decisions can route through the LLM in later phases.
