# Diary

The diary creates two daily touchpoints: a morning entry and an evening entry. Each is short (10 seconds typical) and structured around a small number of fields. Over time, mood and energy data form a personal baseline that other systems can use.

This doc is a placeholder. Deeper design comes in a later pass.

## Morning entry

Triggered by alarm dismissal on mobile (see `features/sleep-alarm.md`). On desktop, available manually.

Fields:

- **Mood:** one of five options, single tap.
- **Energy level:** one of five options, single tap.
- **Sleep quality:** one of five options, single tap. Auto-suggested based on alarm-to-dismissal time and sleep duration where available.
- **Intention for the day:** typed, or selected from planned tasks.

Total time: about 10 seconds. After the entry, the app shows a summary of the day's planned session blocks and transitions into the morning routine (morning playlist, day plan visible).

## Evening entry

Triggered by the user setting tomorrow's alarm, or available manually.

Fields:

- **What went well:** short text.
- **What did not go well:** short text.
- **Optional longer free-form reflection.**
- **Next-day priority:** typed, or selected from backlog.

After the entry, the app can optionally show a summary of the day's productivity as a wind-down review.

## Storage

Diary entries are dated markdown files in the vault. Structured fields (mood, energy, sleep) are also indexed in SQLite for queries like "show me all days with mood >= 4 in the past month."

The markdown file is the source of truth (see `data/architecture.md`). The SQLite index is regenerated from the files.

## Personal baselines

Mood and energy data over weeks and months form a baseline. The AI panel (see `features/ai-integration.md`) can use these baselines to:

- Tailor communication style on low-energy days.
- Suggest schedule adjustments when patterns are off-baseline.
- Detect trends without requiring the user to self-analyze.

This data never leaves the user's machine unless the user explicitly opts in to a sync or AI provider that processes it externally.
