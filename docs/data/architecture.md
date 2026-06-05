# Data architecture

The app stores two categories of data with deliberately different mechanisms. Mixing them, or storing one as the other, creates friction every time. Keeping them separate keeps each tool used for what it is good at.

## The split

**Documents.** Notes, diary entries, project working documents. These are markdown files on disk inside the user's Ganbaru AI folder. The file is the source of truth. SQLite holds an index for fast search, tag lookups, backlinks, and modified-at queries, but the index is rebuildable from the files. If the database is deleted, no document is lost.

Why markdown on disk and not in SQLite as text columns:

- Users can open, edit, sync, and back up their documents with any tool they already trust (a text editor, git, rsync, Obsidian, Syncthing).
- The Ganbaru AI folder remains useful if the app stops being maintained. AGPL plus a plain-file format means the user is never trapped.
- Conflict resolution during sync uses the same file-level tools the user already understands.

**Structured data.** Calendar events, kanban tasks, work environment configs, pomodoro runs, segments, pauses, playlist definitions, project metadata. These live in SQLite. The database is the source of truth. There is no "underlying file" to fall back to.

Why SQLite and not markdown:

- Structured data needs relational integrity (foreign keys, cascades, atomic transactions). Markdown does not enforce this.
- Aggregations that drive analytics (focus score, break adherence, idle patterns) are SQL queries, not markdown text searches.
- The data model evolves. A schema migration is a known, scoped operation. Re-parsing a thousand markdown files of varying shape is not.

The rule is one-directional: structured data may be exported as markdown for collaborators or AI agents that read repos, but those exports are views, not source. They can be regenerated at any time. The reverse, treating an exported markdown file as authoritative, is forbidden.

## Ganbaru AI folder layout

Everything portable that the app produces lives under one folder. First launch defaults to `Documents/Ganbaru AI` in production and `Documents/Ganbaru AI Dev` in development builds, with secondary actions to choose another folder or import an existing Ganbaru AI folder from another installation. Development setup warns the user to use the dev default or a copied production folder so test data does not mix with real production data. Tauri's platform app config directory stores only device-local bootstrap and runtime state, such as the active folder pointer, benchmark state, and transient doomscrolling snapshots.

Folder setup errors are blocking and remain visible until the user starts another folder action, successfully selects a usable folder, or closes the app. The UI translates backend validation failures into user-facing guidance for non-empty unrelated folders, missing or damaged `vault.json`, unsupported folder schema versions, permission problems, missing folders, and database-open failures for `ganbaru-ai.sqlite`.

```
Ganbaru AI/
  vault.json                         # internal Ganbaru AI folder marker, id, display name, schema version
  config.json                        # user settings, environment definitions, blocker rulesets
  ganbaru-ai.sqlite                  # SQLite source of truth for structured data and indexes
  notes/daily/                      # daily notes (markdown)
  notes/projects/                   # per-project notes and working documents (markdown)
  diary/morning/, diary/evening/    # dated diary entries (markdown plus indexed fields)
  projects/{project-id}/            # per-project file attachments (PDFs, references)
  reports/                          # generated project status reports (markdown, PDF)
  assets/                           # user assets (images embedded in notes, attachments)
  templates/                        # phase templates, methodology templates (SWOT, BMC)
  .yjs/                             # Yjs document state cache (binary)
```

Music files stay wherever the user keeps them. The Ganbaru AI folder stores playlist definitions only, with paths or URIs into the user's music library. This avoids duplicating large audio files into the app folder and respects existing collections.

Backups go to a user-specified path **outside** the Ganbaru AI folder. Backing up the folder into itself defeats the purpose if disk corruption takes the folder.

## Database files

The user database is always `ganbaru-ai.sqlite` at the active Ganbaru AI folder root. Development and production builds keep separate Tauri app config directories and separate `app-state.json` files, so each build can point at a different folder. The benchmark harness uses device-local `benchmark.sqlite` in `app_config_dir`; it is not portable user data.

Lazy initialization: the database connection is opened on first use after a Ganbaru AI folder has been selected, not at process startup. This keeps cold start time low and allows the folder to be on a slower-than-disk path, such as an encrypted volume, without delaying the setup UI.

The Tauri integration owns SQLite in Rust through focused `sqlx` commands. Higher-level ORMs were considered and rejected: they add code to maintain, do not earn enough productivity for an app this small, and obscure the actual queries that show up in performance profiles. Plain SQL with typed command wrappers keeps the call sites direct.

## External tools and the CLI bridge

The app is not the only thing that needs to read this data. AI agents (Codex or another CLI coding agent in the integrated terminal, MCP clients), backup tools, scripts, and human collaborators all interact with the same store.

The bridge is the `ganbaru-ai` CLI (Rust binary, reads the same SQLite). It exposes structured commands (`task list`, `event get`, `export kanban`) that AI agents call via Bash. This keeps three properties:

1. One source of truth. The CLI reads what the app writes. There is no duplicate authoritative store for agents.
2. Markdown exports stay derivative. The CLI can write kanban snapshots or generated reports to a git repo for collaborators who never install the app, but those files are regenerated from the database; editing them by hand is supported only via an explicit import command where the export type supports imports.
3. External readers handle dirty state. If the app crashed and a run is mid-write, the CLI applies the same recovery semantics as the app on startup (see `algorithms/pomodoro-state-machine.md`). Aggregations always operate on a consistent view.

The MCP server is for external clients only (ChatGPT, teammate agents, and other MCP-compatible clients). Internal agent flows use the CLI directly. This keeps MCP a thin, documented surface and avoids two parallel paths to the same data.

## Source-of-truth checks

When designing a new feature, ask:

- Is this content the user would expect to exist as a file they can open without the app? If yes, it is a document.
- Does it have relational structure (foreign keys, aggregations, cross-record queries)? If yes, it is structured data.
- Could it be regenerated from another source? If yes, it is a cache (e.g. the `.yjs/` directory, the search index part of `ganbaru-ai.sqlite`).

If the answer is unclear, the default is structured data in SQLite. Promoting a value to a markdown file later is easy. Demoting a markdown file with subtle structure to SQLite later is painful.
