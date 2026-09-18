# Data documentation

This directory defines how Ganbaru AI owns, protects, and evolves durable data. It explains decisions that are not obvious from the schema or source code. SQL migrations and schema tests remain authoritative for exact columns, indexes, triggers, and foreign keys.

Documentation in this directory describes the intended product contract. When current code does not meet that contract, the document identifies the gap instead of redefining the contract around an accidental implementation detail.

## Start here

- [Architecture](architecture.md) defines sources of truth, portability, and the boundary between files, SQLite, and device-local state.
- [Schema](schema/README.md) indexes the durable SQLite domains and migration policy.
- [Access control](access-control.md) is the normative authorization specification for organizational Chat.
- [Invariants](invariants.md) lists conditions that must remain true across writes, recovery, imports, and refactors.
- [Hazards](hazards.md) records cross-cutting failure scenarios that are easy to miss in ordinary feature work.
- [Security](security/README.md) defines the threat model and security boundaries.
- [Sync](sync.md) defines the implemented local whole-vault handoff and the separate planned concurrent synchronization contract. Remote sync is not implemented.

## Authority map

| Question | Authoritative source |
| --- | --- |
| Which storage mechanism owns a kind of data? | [Architecture](architecture.md) |
| What tables and relationships exist now? | SQL migrations and schema tests, summarized under [Schema](schema/README.md) |
| Who may see or operate on Chat resources? | [Access control](access-control.md) |
| What must never become false? | [Invariants](invariants.md) |
| What failure sequences require explicit handling? | [Hazards](hazards.md) |
| What is trusted, untrusted, or future security work? | [Security](security/README.md) |
| How does local handoff work, and how will concurrent sync work later? | [Sync](sync.md) |

Feature documents own user-visible behavior. Algorithm documents own pure decision rules. Data documents own durable identity, authority, persistence, migration, and recovery contracts. Avoid copying the same rule into all three layers.

## Change discipline

Any change to SQLite, persisted JSON, config keys, import or export formats, asset paths, or generated vault data must consider existing installs, stale rows, old exports, seed data, cleanup, and fallback behavior. Applied migrations are immutable. New schema work uses a new timestamped migration and updates the smallest relevant domain document.

Do not document routine fields merely to mirror DDL. Preserve the rationale for non-obvious identity, ownership, deletion, ordering, history, portability, and security decisions.
