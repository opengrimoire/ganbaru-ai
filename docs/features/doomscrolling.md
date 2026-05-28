# Doomscrolling

Doomscrolling enforces the browsing and app rules that belong to the user's current work context. On desktop, the first implementation is a Chrome extension for Chromium-based browsers. Firefox follows later with the same product behavior where the browser APIs allow it. On mobile, the same feature becomes app-level blocking through platform-specific screen time APIs.

Doomscrolling is not a separate productivity tool. It is a guardrail attached to the calendar, Pomodoro, and work environment systems. The user plans the work context once, then GanbaruAI applies the matching rules while the session is active.

## Current implementation status

The current desktop implementation is an early Chrome and Brave development slice:

- `extensions/chrome` is a Manifest V3 unpacked extension named GanbaruAI.
- `ganbaruai-native-messaging` is a repo-owned native messaging host binary built from Rust.
- The app writes a small runtime state file when Pomodoro state changes.
- The native host reads the runtime state and `vault/config.json`, then decides whether a requested website should be blocked.
- The native host writes a small local connection status file each time the extension contacts it. The app uses this to show whether a browser extension has connected recently.
- Settings > Doomscrolling is split into Browser, Mobile apps, and Desktop apps. Browser supports enable or disable, blocking during focus, blocking during short breaks, blocking during long breaks, Blacklist mode, Whitelist mode, blocked websites, blocked categories, custom category stacks, exceptions, and allowed websites. Mobile apps is a work-in-progress placeholder.
- The Desktop apps tab uses the same schedule controls for local app rules, but desktop app blocking is blocklist-only. Adding an app opens an on-demand installed-app picker, so the app does not continuously scan the system. The picker omits system and basic utility apps because they are not procrastination targets. Adding or removing an app from the picker requires confirmation because blocked apps can be closed automatically during configured Pomodoro phases. GanbaruAI, system utilities, shell processes, desktop shell processes, and generic runtimes are protected and cannot be added to blocked apps or closed by stale rules. On Linux, active blocked apps are closed automatically during protected Pomodoro phases and the app shows an OS notification explaining where to change the setting, capped to five notifications per minute.
- Blacklist mode presents built-in and custom categories as category pills. The New category pill opens the custom category form, websites are entered as list items, and custom category deletion lives inside the edit form.
- The current browser `doomscrolling` config uses `enabled`, `blockDuringFocus`, `blockDuringShortBreaks`, `blockDuringLongBreaks`, `mode`, `blockedCategories`, `customCategoryStacks`, `blockedHosts`, `exceptionHosts`, and `allowedHosts`. Built-in categories are enabled by default. Website entries store `host` and `enabled` so users can disable a rule without deleting it. Category stacks store a name, enabled state, and normalized hosts. Legacy string website entries load as enabled rules, and legacy configs without `mode` treat old `allowedHosts` values as Blacklist mode exceptions. Desktop app rules live under `doomscrolling.desktop` with the same enable and phase schedule toggles plus a blocked app list. Legacy desktop `mode` and `allowedApps` fields are ignored.
- The native host includes a rules fingerprint in state responses so the extension rechecks already open tabs when website rules change during an active focus or break phase.
- Block events are logged locally as JSON lines with host, phase, rule snapshot, and decision.

This is intentionally smaller than the full spec below. It supports domain-level browser blocking, preset categories, and automatic Linux desktop app closing during Pomodoro sessions first. Work environment rules, access-change analytics, tab actions, Firefox, mobile blocking, and content-aware matching remain later stages.

## Purpose

Doomscrolling exists to reduce the cost of staying on task during vulnerable moments:

- The first minutes of a focus period, when the user has not yet warmed up.
- Context switches, when the user opens a browser for a valid reason and drifts.
- Break endings, when an allowed break site can easily become the next focus period.
- Morning routines, when the user wants to avoid low-value browsing before the first planned session.

It should make the desired action easier than the distracted action. It should not shame the user, overtake the browser with noisy UI, or create a second dashboard to manage.

## Non-goals

- It is not an ad blocker, privacy filter, parental control tool, or network firewall.
- It does not inspect all browser traffic for analytics.
- It does not use LLM judgment in the initial implementation.
- It does not try to prevent every possible bypass. The goal is useful friction, not hostile lock-in.
- It does not block development, banking, emergency, operating system, or browser management pages.

## Product principles

**Friction should be proportional.** A normal distraction should be stopped with one calm redirect. A repeated bypass attempt can require more friction. An emergency override should remain available.

**Blocking should be explainable.** The user should know which rule blocked the page, which environment is active, and how much focus time remains.

**Rules belong to intent.** The same site can be useful in one context and harmful in another. `youtube.com` may be blocked in "Writing" but allowed in "Music practice" for a specific playlist.

**The browser surface stays small.** The extension popup and block page are status and recovery surfaces, not full configuration surfaces. Configuration lives in the app.

**Logs are signals, not punishment.** Block events feed analytics and future recommendations. They should help the user tune rules, not create shame.

**Local-first is non-negotiable.** The extension only talks to the local GanbaruAI backend through native messaging. It does not send URLs, rule matches, or page content to any remote endpoint.

## Activation model

Doomscrolling has three activation sources:

- **Pomodoro focus.** The normal desktop path. Rules are enforced during focus phases of an active session when the event has an assigned work environment with blocker rules.
- **Work environment activation.** Manual environment activation can apply blocker rules even without a scheduled Pomodoro session. This supports ad-hoc work.
- **Morning routine.** The sleep alarm can activate morning rules after dismissal, such as "no social media until first session block."

Pomodoro focus is the first implementation target. Manual work environment activation and morning routine enforcement use the same rule engine later.

## Pomodoro lifecycle behavior

The blocker state follows the active Pomodoro phase:

- **No active session.** Rules are inactive unless a manually activated environment or morning routine says otherwise.
- **Focus phase.** Rules are enforced with the active environment's focus strictness.
- **Break phase.** Rules follow the environment's break policy. The policy can keep rules strict, relax all rules, or allow only configured break sites.
- **Manual pause.** Rules stay in the focus state by default. A pause is usually an interruption inside focus, not a license to browse. The environment can opt into relaxed pause behavior.
- **Idle pause.** Rules stay strict. Idle detection means the focus session is waiting for the user to return.
- **Suspend pause.** Rules stay strict until the user resumes, stops, or the session expires.
- **Stopped session.** Pomodoro-sourced rules turn off. If the environment was manually activated, its non-Pomodoro rules can remain active.
- **Block transition.** Rules switch to the next event's environment atomically with the Pomodoro transition. If both events use the same environment, no browser-facing state change is needed.

The extension should receive explicit state updates from the app. It should not infer Pomodoro phase from wall-clock time alone.

## Rule model

A blocker ruleset belongs to a work environment. A calendar event can use the environment as-is or carry per-event overrides. Overrides are evaluated only for that event and do not mutate the environment template.

Rules are evaluated against the normalized URL and, for selected sites, optional page metadata gathered by the extension.

Core rule kinds:

- **Blocked domain.** Blocks a host and optionally its subdomains, such as `reddit.com` and `www.reddit.com`.
- **Blocked URL pattern.** Blocks a path pattern on a domain, such as shorts pages on video sites.
- **Allowed domain.** Allows a host even when a broader blocked category or wildcard would match.
- **Allowed URL pattern.** Allows a specific page, playlist, repo, docs section, or task resource.
- **Allowed keyword.** Allows a page when the title, URL, or supported site metadata contains task-relevant keywords.
- **Blocked keyword.** Blocks a page when title, URL, or supported metadata contains distracting terms.
- **Allowed channel or creator.** Allows specific supported content sources such as a YouTube channel.
- **Blocked category.** A local preset such as social media, streaming, news, sports, porn, gambling, gaming, shopping, dating, or trading. Presets can include exact domains, domain keyword rules, and site-specific path rules.
- **Custom category stack.** A user-named group of domains that can be enabled, disabled, edited, or deleted as one unit.

Initial Chrome implementation should support blocked domains, allowed domains, blocked categories, and custom category stacks. Built-in categories may include local URL-only keyword matching when the category risk is clear enough, such as porn domains and Reddit subreddit names. User-authored URL pattern, keyword, and channel rules can ship once matching and site metadata extraction are stable.

## Rule precedence

Rule precedence must be deterministic and visible when the app explains a blocked page:

1. Emergency and browser safety allowlist.
2. Explicit session allow.
3. Explicit per-event allow.
4. Explicit per-event block.
5. Explicit environment allow.
6. Explicit environment block.
7. Category allow.
8. Category block.
9. Default allow.

Within the same level, the most specific URL pattern wins over the broader domain rule. If specificity ties, the newest user-authored rule wins. Built-in rules lose ties against user-authored rules.

The block page should name the winning block rule and the allow rule that would be needed to permit the page.

## Matching rules

URLs are normalized before matching:

- Lowercase scheme and host.
- Remove default ports.
- Decode percent-encoded hostnames.
- Convert internationalized domain names to a canonical form.
- Strip fragments.
- Treat query strings as sensitive and ignore them for default rule matching.

Path matching should be explicit. A blocked domain rule blocks the domain regardless of path. A blocked URL pattern can use simple wildcard segments owned by the app, not arbitrary user-provided regular expressions in the first implementation.

Query-string matching is off by default because queries often contain private searches, document IDs, tokens, or personal data. If a future rule needs query matching, the UI must show a privacy warning and store only the minimum needed pattern.

## Content-aware blocking

Some sites are too broad for domain-level blocking. YouTube is the key example: it can be a distraction, a learning resource, or the user's configured music source.

Content-aware blocking is staged:

- **Stage 1, URL and channel rules.** Allow specific videos, playlists, channels, docs domains, and repositories. Block broad categories such as shorts.
- **Stage 2, local metadata rules.** Match page title, visible creator name, video title, playlist title, and task keywords. The extension sends only the minimum metadata needed to the local backend.
- **Stage 3, optional LLM judgment.** If the user enables an AI provider, the app can ask whether the page appears relevant to the active task. This is later work and must be opt-in per environment.

The extension must never send full page text to a remote model directly. If LLM judgment exists later, the app owns provider selection, prompt construction, redaction, and user consent.

## Browser extension behavior

The Chrome extension has four jobs:

- Maintain a native messaging connection to the local Tauri backend.
- Receive the current blocker state and compiled rule updates.
- Enforce blocking by redirecting matched top-level navigations to an extension block page.
- Support work environment tab actions, such as opening configured tabs for the active environment.

The first Chrome implementation should use Manifest V3. Rule enforcement should prefer browser-native declarative request rules where practical because they are fast and privacy-preserving. The service worker remains responsible for native messaging, rule updates, extension popup state, and block event reporting.

The extension must not inject UI into normal pages for basic blocking. Redirecting to an extension-owned block page is easier to reason about and avoids page CSS, script, and content security policy issues.

## Native messaging protocol

Native messaging connects the extension to GanbaruAI's local backend. The protocol should be versioned from the first implementation.

The extension sends:

- `hello`: extension version, browser kind, protocol version, extension id.
- `ready`: service worker or extension context is ready to receive state.
- `block_event`: a page was blocked, with redacted URL data and matched rule id.
- `tab_action_result`: result of opening, focusing, or closing environment tabs.
- `diagnostic`: local connection or rule application failure, without sensitive page data.

The backend sends:

- `hello_ack`: accepted protocol version and feature flags.
- `state_snapshot`: active environment, Pomodoro phase, strictness, break policy, and compiled rules.
- `state_patch`: incremental changes to the active state.
- `tab_action`: open, focus, group, pin, or close tabs for work environment activation.
- `clear_state`: turn off Pomodoro-sourced enforcement.
- `ping`: connection keepalive.

Every message must include a schema version and request id when a response is expected. Unknown message types are ignored with a diagnostic response. Invalid payloads are rejected and never applied.

## Connection failure behavior

The default is fail open with a visible warning. If the extension cannot reach the app, it should stop enforcing stale rules after a short grace period and show `Disconnected` in the popup.

Reasons:

- Accidental lockout is worse than missed enforcement.
- Native messaging setup can fail during development or after browser profile changes.
- The app is local-first and user-owned, not an enterprise control system.

A future strict mode can fail closed during focus, but it must be explicit, easy to disable from the app, and carefully documented.

When the app is running but the extension is missing or disconnected, the app should show a small setup warning on Pomodoro and work environment surfaces. It should not block the user from starting focus.

The current app settings view shows this as a recent connection check for the current app session. A fresh timestamp from this app run means the extension is installed, enabled, and able to talk to GanbaruAI. A missing, stale, or older-session timestamp means the browser is closed, the extension is disabled or missing, or native messaging is not registered. The app should not claim to know which of those is true unless the browser reports it directly.

## Block page UX

The block page is intentionally minimal. It should show:

- The normalized site host once, formatted as `[host] is blocked`.
- A short steady message: `Stay strong and keep moving forward`.
- Remaining focus time, if a Pomodoro focus phase is active.
- Primary action: close tab.

It should not show:

- The GanbaruAI name as page content.
- The blocked URL more than once.
- Motivation quotes.
- XP, streaks, badges, or character dialogue.
- Daily stats or total blocked count.
- Animated backgrounds.
- A long explanation of procrastination.
- A feed of recent blocked pages.
- Temporary access controls on the block page.

The block page itself must not become a reward or distraction.

## False positives and access changes

The block page should not offer quick bypass controls. The default recovery action is to close the tab and continue the session.

When the user hit a false positive or needs a blocked site for the current task, the change should happen in GanbaruAI settings where the rule context is visible. Future access-change flows can support:

- Adding an exception in Blacklist mode.
- Adding a site to Whitelist mode.
- Disabling a website rule, category, category stack, or desktop app rule.

Any flow that changes access from a blocked surface should require confirmation and explain the scope before applying the change.

The app should log access changes separately from block events. Analytics can then distinguish "blocked and abandoned" from "blocked but intentionally changed."

## Extension popup UX

The popup is a compact status surface. It should show:

- Connection state: connected, disconnected, app not running, unsupported browser.
- Active environment name.
- Pomodoro phase and remaining time when active.
- Current rule mode: strict focus, relaxed break, manual environment, morning routine, inactive.
- Last blocked domain, if any, without query string.
- Buttons: open GanbaruAI and test the current page.

The popup should not expose full rule editing. It can link to the app's environment editor. Keeping editing in the app avoids duplicated settings UI and keeps the browser extension small.

## App configuration UX

Configuration lives in the app under work environments.

The environment editor should include a blocker section with:

- Toggle: enable blocker for this environment.
- Focus policy: off, normal, strict.
- Break policy: relaxed, same as focus, allow only break sites.
- Website mode: Blacklist mode or Whitelist mode.
- Blacklist mode rules: blocked domains, categories, and exceptions.
- Whitelist mode rules: allowed sites and task resources.
- Supported site rules, such as YouTube channels or playlists.
- False-positive handling defaults.

## Suggested defaults

GanbaruAI should ship with editable presets, not hidden hardcoded rules.

Initial presets:

- **Social media.** Common social feeds and infinite-scroll platforms.
- **Short-form video.** Shorts, reels, and similar paths where URL patterns allow it.
- **Video distractions.** Broad video sites, with support for explicit allowed playlists or channels.
- **News and feeds.** News, aggregation, and feed-reader domains.
- **Shopping.** Shopping and marketplace domains.
- **Forums.** Broad forums, with project-specific allow rules for technical communities.

Presets should be inspectable before enabling. The user should be able to remove individual domains from a preset without disabling the whole preset.

## Analytics and logs

Block events are productivity signals. They should be recorded with enough context to explain patterns without storing unnecessary browsing history.

Recommended fields:

- `id`
- `occurred_at`
- `run_id`, nullable
- `event_id`, nullable
- `environment_id`, nullable
- `phase`: focus, break, manual, morning, inactive
- `browser_kind`
- `url_host`
- `url_path_hash`, nullable
- `url_path_redacted`, nullable and opt-in
- `rule_id`
- `rule_name_snapshot`
- `decision`: blocked, temporary_allowed, false_positive_reported
- `access_scope`, nullable
- `reason`, nullable

Full URLs should not be stored by default. The default log should keep host and matched rule. Path storage should be redacted or hashed unless the user opts into more detail.

Analytics examples:

- "Most blocked attempts happen in the first 10 minutes of focus."
- "This environment blocks documentation you often allow. Consider adding a task resource."
- "Break browsing frequently continues into focus. Consider stricter break policy."

Analytics should suggest configuration changes, not judge the user.

## Data ownership

Blocker rules are structured data and should live in SQLite with work environment records. They are not markdown notes. Generated exports for agents or collaborators can present rules as markdown views, but SQLite remains the source of truth.

Every block event should snapshot the rule name and environment name needed for later explanation. The user may rename or delete a rule, but historical logs should still be understandable.

If rule fields are renamed, removed, or changed, migrations must preserve user-authored intent where possible and drop obsolete derived fields explicitly.

## Security and privacy

The extension is a high-trust component because it can observe browser navigations. Its design must minimize what it observes, stores, and transmits.

Rules:

- The extension talks only to the local native messaging host.
- No analytics, crash reporting, remote config, CDN assets, or update checks outside browser store mechanics.
- The extension should request the narrowest practical permissions.
- Full page content is not collected for the initial implementation.
- Content scripts are avoided unless a supported site needs metadata that cannot be obtained from URL or tab title.
- If content scripts are added, they should run only on specific supported domains.
- Native messages are validated on both sides.
- The backend should reject messages from unknown extension ids where the platform exposes the caller identity.
- Debug logs must not include full URLs by default.

The block page and popup use extension-owned assets only. They do not load remote fonts, images, or scripts.

## Browser support strategy

Chrome and Chromium-based browsers come first. The first target is Manifest V3 with native messaging and declarative request rules.

Firefox comes later. Product behavior should match Chrome, but implementation can differ where WebExtension APIs differ. The shared code should be organized around a small browser adapter boundary:

- native messaging connection
- dynamic rule application
- tab operations
- popup state
- block page routing

Firefox support should not require changing the data model or user-facing rule semantics.

## Browser page handling

Some browser pages should never be blocked:

- Extension pages owned by GanbaruAI.
- Browser preference pages and extension management pages.
- New tab pages.
- Local files, unless the user explicitly enables local file matching later.
- Native messaging setup pages or local GanbaruAI setup pages.
- Authentication pages required for the user's configured AI or sync provider.

The safety allowlist should be built in and shown as `browser safety allowlist` when the app explains a blocked page.

## Work environment tab actions

The extension also supports environment activation by opening or focusing browser tabs.

Initial tab actions:

- Open configured URLs.
- Reuse an existing matching tab when one is already open.
- Focus the first task resource tab when the environment activates.
- Optionally pin environment tabs.

Later tab actions:

- Group environment tabs.
- Close tabs from the previous environment.
- Move tabs to a designated window.

Tab closing must be conservative. The app should not close user tabs by default. Closing or replacing tabs should require an explicit environment setting.

## Edge cases

**App starts after browser.** The extension shows disconnected until the backend is available, then requests a fresh state snapshot.

**Browser starts during focus.** The extension connects, receives the active focus state, applies rules, and reports readiness.

**Rules change mid-focus.** The app sends a state patch. The extension applies the new compiled rules and reports success or failure.

**User opens a blocked page in multiple tabs.** Each top-level navigation can produce a block event, but analytics should group repeated attempts close together when presenting summaries.

**User hits back from the block page.** The browser should return to the previous page if one exists. If back would reopen the blocked page, the block page should offer close tab or open allowed task resource.

**A page becomes blocked after it is already open.** On state changes, the extension should recheck active tabs and redirect newly blocked pages where browser APIs allow it.

**A page becomes allowed after an access change.** The extension should reload or navigate back to the original URL only after the user confirms. Automatic navigation can be surprising.

**Incognito or private windows.** Disabled by default. If the user enables extension access in private browsing, the app should label private events separately and keep the same local-only rules.

**Multiple browser profiles.** Each profile extension instance connects independently. The backend treats them as separate clients under the same local user.

## Implementation stages

Stage 1, Chrome minimum:

- Native messaging setup.
- Connected, disconnected, and inactive popup states.
- Environment blocker rules compiled from domain and URL pattern rules.
- Redirect blocked top-level navigations to the extension block page.
- Log block events with redacted URL data.
- App environment editor with website mode, blocked domains, exceptions, allowed domains, and break policy.

Stage 2, session quality:

- False-positive and access-change flow.
- Recheck active tabs on state changes.
- Category presets.
- App setup diagnostics for missing native host or missing extension.
- Tab opening for work environment activation.

Stage 3, richer browser context:

- Site-specific rules for YouTube videos, playlists, and channels.
- Metadata matching for title and creator name on supported sites.
- Tab grouping or pinning where supported.
- Better analytics suggestions from repeated block and allow patterns.

Stage 4, Firefox:

- Firefox extension adapter.
- Firefox native messaging host manifest installation.
- Firefox rule application path.
- Cross-browser conformance tests for rule decisions.

Stage 5, optional AI relevance:

- User-enabled LLM relevance checks for supported environments.
- Prompt and redaction controls owned by the app.
- Local cache of user-approved relevance decisions.
- Clear fallback to deterministic rules when AI is unavailable.

## Open design questions

- Should strict mode ever fail closed when the extension loses contact with the app?
- Should break browsing be globally configurable, per environment, or both?
- How much URL path detail should analytics expose by default?
- Should access changes from a blocked surface require a typed reason in strict environments?
- Which additional regional category presets are worth maintaining?
- Should custom category stacks support editing individual hosts inline, or stay as delete-and-recreate bundles until rule editing is broader?

## Related docs

- `features/pomodoro.md`: session lifecycle that activates focus enforcement.
- `features/work-environments.md`: where blocker rules are configured.
- `features/pomodoro-idle-detection.md`: idle and suspend behavior while focus rules remain active.
- `features/sleep-alarm.md`: morning routine activation.
- `data/schema.md`: structured data ownership and future blocker tables.
- `data/security.md`: no phone home rule and extension trust boundary.
- `docs/ROADMAP.md`: Chrome in phase 4, Firefox and content-specific blocking later.
