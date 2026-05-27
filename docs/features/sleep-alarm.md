# Sleep alarm

A mobile-only feature that wakes the user, triggers the morning diary entry, and triggers the evening diary entry when tomorrow's alarm is set. Integrates with the diary, music, and Doomscrolling.

This doc is a placeholder. Deeper design comes in a later pass.

## Why mobile-only

The alarm runs on the device that is by the user's bed. That is almost always the phone. The desktop app does not run an alarm because the desktop is typically not powered on overnight, and asking the user to leave it running just to ring an alarm is the wrong tradeoff.

## Morning flow

1. Alarm rings at the configured time.
2. User dismisses the alarm.
3. The morning diary screen appears immediately (see `features/diary.md`).
4. The morning playlist starts (see `features/music.md`).
5. Doomscrolling activates with the user's morning rules (e.g., social media blocked until the first session block starts).

The flow is meant to be friction-free on the user side: dismiss the alarm, fill in five quick fields, and the day is set up.

## Evening flow

1. User sets tomorrow's alarm.
2. The evening diary screen appears.
3. After completion, the app can optionally show a wind-down review of the day's productivity.

## Sleep duration

The system records the time from when the alarm was set to when it was dismissed. This is a rough proxy for sleep duration (it does not account for time spent falling asleep or for waking and going back to sleep). The value feeds:

- The sleep quality auto-suggestion in the morning diary.
- The personal baselines that the AI panel can use to understand the user's energy patterns.

## Linkage to other systems

- **Diary:** triggers morning and evening entries.
- **Music:** triggers morning playlist on alarm dismissal.
- **Doomscrolling:** activates morning rules immediately on dismissal.
- **AI panel:** sleep duration informs personal energy baselines.
