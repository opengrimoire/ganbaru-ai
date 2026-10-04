# Doomscrolling usage limits

Usage limits are independent daily or weekly budgets. They apply whenever the relevant local adapter can observe a configured website or application, not only during a Pomodoro session.

## Current ownership

Desktop budget matching, daily and Monday-based weekly totals, and per-entry breakdowns are native. One bounded snapshot reads committed usage on the writable device, or accepted usage plus applicable pending usage on a linked read-only device. Settings receive compact budgets and allocations instead of the current week's individual samples. Overlapping sources allocate to the first matching entry once per limit. Disabled limits remain visible without authorizing enforcement.

Native publication binds exhaustion to the active database, recorded local window, and exact persisted limit configuration. A budget or linked-source edit invalidates the previous result. Missing fingerprints from older device snapshots fail open until native publication refreshes them. Future timestamps and inconsistent remaining time or exhaustion flags cannot authorize a close or a browser block.

One serialized desktop native owner now observes selected applications, records intervals, derives exhaustion, publishes browser snapshots, and executes authorized closes. Settings read its cached projection and cannot start observations, submit intervals, or request closes. While no budget exists, the owner publishes an empty projection without reading SQLite or the spool; spooled samples drain on the first read after a budget is added. Vault selection, handoff, shutdown, and persisted rule edits invalidate old observations and publications. Handoff waits for captured batches to reach the device-local spool before the database is closed; a worker that cannot drain within the bounded wait cancels the handoff and remains unable to execute revoked work.

Daily and weekly limits no longer require a WebView execution scheduler. Pomodoro-dependent rules consume fresh committed native Focus state with phase and lifecycle fences; expired evidence cannot authorize a successor phase. Android Guardian owns selected-package observation and enforcement; a serialized Rust publisher derives its shared totals and rule snapshots. Settings on both platforms read native projections. Real desktop lifecycle and Android acceptance remain pending.

## Limit model

A limit has a stable identity, optional display name, enabled state, at least one daily or weekly budget, and one or more linked entries. Entries can represent the same habit across platforms, such as a website host, Android package, and desktop application.

Single-entry limits can derive a display name from the entry. Multi-entry limits require a meaningful group name. New limits default to a one-hour daily budget and no weekly budget. Weekly budgets cannot exceed the full number of hours in a week.

Each linked source uses an event-palette color for the usage breakdown. Color communicates source allocation but is accompanied by labels.

Browser categories are not limit entries. Categories remain deterministic browser rule presets; limits target explicit hosts and applications.

## Time windows

Daily budgets reset at local midnight. Weekly budgets use the Monday-based local week. Timezone changes cause later samples to use the new local date; existing samples retain their recorded local date so a clock change does not silently rewrite history.

Deleting a limit does not delete usage samples. Recreating a matching limit can include already recorded activity in the current window, preventing delete-and-recreate from acting as a hidden reset.

Linked accounting reads the entire bounded local window independently of transport batch sizes. Applying an owner snapshot and acknowledging the pending samples it includes happen in one device-local transaction. A failed replacement retains both the previous accepted snapshot and unacknowledged samples for retry.

Sent pending samples retain their identities until acknowledgement. Compaction combines only samples that have never been sent and derives replacement identities from their constituent identities. Older spools conservatively treat existing pending samples as sent. Native interval batches commit together with a bounded last-batch receipt for each vault and device, so retrying an uncertain write cannot reinsert usage that has already been acknowledged. A full spool fails explicitly and suspends further interval capture until the retained batch can be persisted.

## Browser counting

Browser usage counts the active HTTP or HTTPS tab while its browser window is focused. Passive focused use, including reading and fullscreen video, counts. A background tab, background browser window, locked browser, extension page, and unsupported browser URL do not count.

Samples contain normalized host, elapsed time, local date, and bounded timing metadata. They never contain the full URL, query string, page text, playback state, or input history.

## Android counting

Android counts explicitly selected packages while Android reports their activities visible and the screen interactive and unlocked. Passive use counts. Split-screen and picture-in-picture can count every selected package that remains visible.

Samples contain package identifier, display label, elapsed time, local date, and bounded timing. They do not contain screen content, text, taps, notifications, or unselected application history.

Legacy name-only entries remain visible but require reselection before package enforcement can be trusted.

The Guardian journal preserves sent sample identities across compaction and retains pending rows when the active vault changes. A full journal rolls back new samples, totals, and their checkpoint together. Samples split rather than clamp elapsed time, including a local day longer than 24 hours. Linked accepted totals retain their corresponding acknowledgement identities until Guardian confirms deletion, so retries cannot count the same retained evidence twice.

The native publisher combines canonical or accepted usage with every applicable pending identity in the captured window. It excludes identities already included in committed totals and publishes the shared result with the local counters captured at that same point. Guardian adds only later local observations to that baseline. Removed or changed rules, vault changes, failed publication, and captures crossing midnight revoke obsolete policy. The frontend supplies localized notification text and displays cached native budgets; it does not calculate totals or publish enforcement policy.

While the native application process exists, shared accounting refreshes independently of JavaScript scheduling. If Android removes that process, the separate Guardian service continues observing and enforcing its retained local policy. New remote totals require the application publisher to return. Real Android background and process-restart acceptance is still required.

## Desktop counting

Desktop counting prefers the foreground application where the operating system exposes it. Supported adapters can include Windows foreground windows, macOS frontmost applications, Linux X11 active-window data, and Wayland compositor protocols that expose focused applications.

Intervals use monotonic elapsed evidence and split at actual local midnights, including daylight-saving changes and skipped civil dates. Long observation gaps and discontinuities between wall and monotonic clocks produce no inferred usage. Fractional seconds carry across consecutive observations of the same source and date; changing source, date, configuration, or vault can discard less than one second of unfinished evidence. Linux observations use application classes, process names, or compositor application IDs and do not retain window titles.

On Wayland sessions without foreground visibility, a selected application may count while its safely matched process is open. The UI labels this as open-app time rather than focused use. If neither safe foreground nor process matching exists, the source is unavailable and does not accumulate time.

## Enforcement

When a browser budget is exhausted, matching top-level pages redirect to the extension block page. The page identifies whether the daily or weekly limit was reached and does not offer a bypass button.

On Android, an exhausted package-backed limit returns the user Home and posts a rate-limited notification linking to the limit settings.

Desktop application closing occurs only where a safe close adapter exists. The final boundary revalidates the exact enabled limit, linked entry, current total, app identity, protected-app policy, and observation freshness. A stale, removed, disabled, mismatched, or no-longer-exhausted limit performs no close.

## Presentation

Each budget displays used and available time with a stacked source breakdown. Limits that have both daily and weekly budgets show separate labeled groups. Unavailable adapters, stale permissions, and entries that require reselection are explicit.

An open Android limits panel refreshes the cached native projection without driving accounting or enforcement. Missing native budgets display an unavailable state instead of inferred zero usage. Desktop adapter warnings are omitted on Android.

Rounding and batching can produce a small delay before the newest interval appears. Presentation should not imply second-level precision when samples are intentionally batched.

## History and privacy

Usage history is local structured data. It supports totals and configuration guidance without becoming a complete activity diary. Retention and compaction preserve current budgets and useful trends while bounding storage.
