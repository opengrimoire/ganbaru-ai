# Doomscrolling browser integration

The Chromium extension is a small enforcement and status client for the local Ganbaru AI application. Firefox should later implement the same product semantics through its own adapter where browser APIs differ.

## Responsibilities

The extension:

- Connects to the local native messaging host.
- Receives versioned current rule and limit state.
- Counts active focused website time with minimal host-only samples.
- Redirects blocked top-level navigation to an extension-owned block page.
- Rechecks open normal tabs when rules, phase, or budget state changes.
- Reports bounded diagnostics and normalized block events.

It does not reproduce the full settings editor, inspect all traffic, inject basic blocker UI into arbitrary pages, or contact a remote Ganbaru service.

## Native messaging

Messages are versioned, bounded, and validated on both sides. They cover handshake, current state, rule refresh, usage samples, block decisions, connection status, and limited future tab actions. Unknown or malformed messages are rejected without applying state.

The wire schema belongs to interoperability or source-level contracts rather than this product spec. Product compatibility requires that an unsupported protocol version fails visibly and open.

Current repository setup automates Chromium native-host registration on Linux and macOS. Windows manifest placement and registry registration remain a manual packaging gap. Documentation and release status must not describe Windows browser blocking as automatically installed until a signed installer owns that setup and uninstall cleanup.

## Connection and stale state

Phase snapshots expire at their accepted validity deadline even when their heartbeat timestamp remains fresh. Running snapshots from older app versions without that field expire when their published remaining time reaches zero. A paused snapshot can retain its work allowance, but a native owner lease still expires independently. Phase expiry leaves independent usage-budget rules under their own validity contract.

If the local host is unavailable, the extension shows a disconnected state and stops enforcing after the applicable snapshot expires. It does not guess whether the browser, extension, host registration, app process, or active vault caused the failure.

When a browser starts during focus, it requests a fresh state. When the app starts after the browser, reconnection refreshes current rules. A manual `Recheck now` action flushes active usage, refreshes native state, and reevaluates open tabs.

Budget snapshots are published from native accounting. The host rejects an exhausted result if its persisted limit configuration changed, its local day ended, its timestamp is in the future, or its budget arithmetic is inconsistent. An older snapshot without a configuration fingerprint stops budget enforcement until a fresh native result arrives. Phase rules keep their independent freshness contract.

## Block page

The block page is deliberately quiet. It shows the normalized host, the rule or exhausted budget, remaining focus time when relevant, and a primary close-tab action.

It does not show motivational feeds, rewards, streaks, statistics, recent browsing, long explanations, or quick bypass controls. Access changes occur in Ganbaru AI settings where their scope is explicit.

The page uses extension-owned local assets only.

## Popup

The popup shows connection, active phase, remaining time, most recent normalized blocked host, and a recheck or open-app action. It remains a status and recovery surface, not a second settings application.

## Safety allowlist

The extension never blocks its own pages, browser settings and extension management, new-tab pages, local setup pages, required provider authentication, or other browser safety surfaces. The explanation identifies this built-in allowlist when it wins.

## Privacy

Full URLs are not stored by default. Query strings and fragments are excluded. Page content is not collected for basic blocking. Any future content script runs only on documented supported domains and returns the minimum local metadata required by a user-enabled rule.

Private browsing is disabled unless the user enables the extension for that profile. Multiple browser profiles connect as separate clients and do not broaden one another's permissions.

## Future tab actions

Planned work-environment actions can open or focus configured task resources and optionally pin or group them. Reusing an existing matching tab is preferred. Closing or replacing user tabs is off by default and requires an explicit environment policy.
