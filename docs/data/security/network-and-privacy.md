# Network and privacy

Ganbaru AI has no analytics, advertising, telemetry, crash-reporting, or behavioral-tracking service. It does not send calendar, focus, Notes, project, browsing-control, or Chat data to Ganbaru AI infrastructure.

Offline use remains a first-class mode. Network-capable features are explicit, bounded, and attributable to a user choice or configured integration.

## Current network surfaces

Current code may use the network for these feature-owned purposes:

- update metadata and user-opened release information;
- user-selected coding-agent providers, whose native processes may contact their configured service;
- YouTube playback and metadata required by the Music player;
- user-initiated Notion import and supported icon or audio-source lookups;
- browser previews or URLs explicitly opened by the user;
- the Chrome extension's local native-messaging connection, which is not a remote service.

Each adapter owns its allowed schemes, origins, redirects, response bounds, timeouts, and credential handling. There is no generic webview command that fetches an arbitrary URL with application credentials.

Provider network behavior follows the selected provider and its own policy. Ganbaru AI constrains the process, workspace, environment, host tools, and context it supplies, but cannot promise that an external provider does not retain submitted content. The UI must make provider choice and data transfer understandable.

## Planned network surfaces

These are not implemented:

- encrypted local device linking and optional remote synchronization through a user-hosted Rust relay;
- a hosted or local BYOK chat widget separate from coding-agent Chat;
- a separately authorized external MCP service;
- a ganbaru-ai CLI with external integration commands.

Their security requirements remain design constraints. Documentation must not describe their proposed endpoints as current traffic.

## No hidden telemetry

Logs and diagnostics remain local unless the user explicitly exports or copies them. Benchmark results are local. Dependency, update, or icon lookups do not carry unrelated vault content.

Do not add analytics SDKs, remote feature flags, session replay, invisible tracking pixels, or automatic diagnostic uploads. A future optional diagnostic submission would require a separate design with preview, redaction, explicit consent, and a stated recipient.

## URL and request rules

Network adapters validate:

- scheme and hostname allowlist;
- redirect destination and count;
- credentials embedded in URLs;
- loopback, private, link-local, multicast, and unspecified addresses;
- request and response size;
- content type and parser limits;
- connect, header, body, and inactivity deadlines;
- secret placement in headers, query strings, logs, and errors.

An origin permitted by CSP is not automatically permitted by a Rust network adapter, and an opener allowlist does not grant fetch authority.

Explicitly activated Notes hyperlinks use a feature-owned native command on desktop and Android. It applies the rich-text URL size and control-character bounds, allows only HTTP, HTTPS, and validated email links, and rejects embedded URL credentials before opening the system handler. Local note and database-block references use Notes navigation. Opening a hyperlink does not fetch its content through the app or expand the generic opener capability allowlist.

## Local data encryption

The vault and SQLite database are not application-encrypted. Ganbaru AI trusts operating-system account isolation and full-disk encryption such as LUKS, BitLocker, or FileVault.

This keeps user-authored files accessible to ordinary backup and editing tools and avoids inventing a second fragile key-recovery system. It also means arbitrary malware running as the same user may read the vault. Documentation and threat claims must state that limitation honestly.

Provider credentials and similar secrets are different. They live behind operating-system credential references and are materialized only at the native operation that needs them. Secrets do not belong in config.json, the vault database, provider DTOs, diagnostics, or exports.

## Future synchronization encryption

Remote sync must use end-to-end encryption in addition to transport encryption. The accepted design uses signed, encrypted resource-scoped operations and immutable asset chunks, delivered directly or through an optional user-hosted Rust relay that stores opaque records. Hocuspocus is no longer the proposed backend.

The target composition uses pinned TLS 1.3 device identities, XChaCha20-Poly1305 records, and HPKE with X25519 and HKDF-SHA256 for resource keys. Enrollment requires a single-use invitation and confirmation by the administration device. A separate recovery identity, signed membership history, key rotation on revocation, fresh writer generations on rejoin, replay protection, and downgrade rejection are required. These mechanisms and their implementation libraries remain unimplemented; audit success is not protocol security review.

The relay must not receive plaintext application content. It can still observe connection metadata, timing, ciphertext size, and routing identifiers unless later padding or privacy work reduces them. Local network linking does not require an account or relay.

Revocation prevents future authorized operations and key distribution. It cannot erase plaintext already materialized on an offline device or external provider. See [Synchronization](../sync.md).

## Data minimization

Every network request carries the smallest data required for its feature. Examples:

- update checks do not include vault identity or activity history;
- provider prompts include only explicitly selected and authorized context;
- media requests do not include Notes, calendar, or project data;
- icon and audio searches send the user's query, not surrounding vault content;
- future availability sharing uses coarse user-approved capacity rather than raw Pomodoro or idle history.

Derived data remains sensitive. A summary, embedding, screenshot, or search result can reveal the same information as its source and follows the same authorization and transfer policy.

## External content

Remote images, media metadata, HTML, Markdown, JSON, XML, provider events, and downloaded files are untrusted. They are bounded and parsed by the narrowest feature adapter. Remote content is not permitted to choose a local path, execute a command, access provider credentials, or create an organizational grant.

## User disclosure

Before a feature sends personal or repository content to an external service, the product should identify the provider, purpose, selected context, and material privacy consequence. Persistent background access requires a clear setting and a way to disable it.

Disabling a network integration stops new requests and cleans up local credentials or tokens according to its retention contract. It cannot recall data already sent to an external provider.
