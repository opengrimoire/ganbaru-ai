# Data architecture

The app stores two categories of data with deliberately different mechanisms. Mixing them, or storing one as the other, creates friction every time. Keeping them separate keeps each tool used for what it is good at.

## The split

**Documents.** Notes, diary entries, project working documents. These are markdown files on disk inside the user's vault. The file is the source of truth. SQLite holds an index for fast search, tag lookups, backlinks, and modified-at queries, but the index is rebuildable from the files. If the database is deleted, no document is lost.

Why markdown on disk and not in SQLite as text columns:

- Users can open, edit, sync, and back up their documents with any tool they already trust (a text editor, git, rsync, Obsidian, Syncthing).
- The vault remains useful if the app stops being maintained. AGPL plus a plain-file format means the user is never trapped.
- Conflict resolution during sync uses the same file-level tools the user already understands.

**Structured data.** Calendar events, kanban tasks, work environment configs, pomodoro runs, segments, pauses, playlist definitions, project metadata. These live in SQLite. The database is the source of truth. There is no "underlying file" to fall back to.

Why SQLite and not markdown:

- Structured data needs relational integrity (foreign keys, cascades, atomic transactions). Markdown does not enforce this.
- Aggregations that drive analytics (focus score, break adherence, idle patterns) are SQL queries, not markdown text searches.
- The data model evolves. A schema migration is a known, scoped operation. Re-parsing a thousand markdown files of varying shape is not.

The rule is one-directional: structured data may be exported as markdown for collaborators or AI agents that read repos, but those exports are views, not source. They can be regenerated at any time. The reverse, treating an exported markdown file as authoritative, is forbidden.

## Vault layout

Everything the app produces lives under one folder, the vault. The user picks the path. Defaults are platform-conventional (`~/Documents/GanbaruAI` or similar) but never hardcoded; code reads the path from user config.

```
vault/
  notes/daily/                      # daily notes (markdown)
  notes/projects/                   # per-project notes and working documents (markdown)
  diary/morning/, diary/evening/    # dated diary entries (markdown plus indexed fields)
  calendar/                         # calendar event data (session blocks, schedule state)
  projects/{project-id}/            # per-project file attachments (PDFs, references)
  reports/                          # generated project status reports (markdown, PDF)
  assets/                           # user assets (images embedded in notes, attachments)
  templates/                        # phase templates, methodology templates (SWOT, BMC)
  config.json                       # user settings, environment definitions, blocker rulesets
  .yjs/                             # Yjs document state cache (binary)
  app.db                            # SQLite (events, runs, segments, indexes, etc.)
```

Music files stay wherever the user keeps them. The vault stores playlist definitions only, with paths or URIs into the user's music library. This avoids duplicating large audio files into the vault and respects existing collections.

Backups go to a user-specified path **outside** the vault. Backing up the vault into itself defeats the purpose if disk corruption takes the vault.

## Database files

In development the app uses `ganbaruai-dev.db`. In production it uses `ganbaruai.db`. Both live next to the vault root by default. Lazy initialization: the database connection is opened on first use, not at app startup, to keep cold start time low and to allow the vault to be on a slower-than-disk path (e.g. an encrypted volume) without delaying the UI.

The Tauri integration uses `tauri-plugin-sql`. Higher-level ORMs were considered and rejected: they add code to maintain, do not earn enough productivity for an app this small, and obscure the actual queries that show up in performance profiles. Plain SQL with typed wrappers per table keeps the call sites direct.

## External tools and the CLI bridge

The app is not the only thing that needs to read this data. AI agents (Claude Code in the integrated terminal, MCP clients), backup tools, scripts, and human collaborators all interact with the same store.

The bridge is the `ganbaruai` CLI (Rust binary, reads the same SQLite). It exposes structured commands (`task list`, `event get`, `progress export`) that AI agents call via Bash. This keeps three properties:

1. One source of truth. The CLI reads what the app writes. There is no duplicate authoritative store for agents.
2. Markdown exports stay derivative. The CLI can write `PROGRESS.md` or `KANBAN.md` to a git repo for collaborators who never install the app, but those files are regenerated from the database; editing them by hand is supported only via an explicit import command.
3. External readers handle dirty state. If the app crashed and a run is mid-write, the CLI applies the same recovery semantics as the app on startup (see `algorithms/pomodoro-state-machine.md`). Aggregations always operate on a consistent view.

The MCP server is for external clients only (ChatGPT, Claude web). Internal agent flows use the CLI directly. This keeps MCP a thin, documented surface and avoids two parallel paths to the same data.

## Source-of-truth checks

When designing a new feature, ask:

- Is this content the user would expect to exist as a file they can open without the app? If yes, it is a document.
- Does it have relational structure (foreign keys, aggregations, cross-record queries)? If yes, it is structured data.
- Could it be regenerated from another source? If yes, it is a cache (e.g. the `.yjs/` directory, the search index part of `app.db`).

If the answer is unclear, the default is structured data in SQLite. Promoting a value to a markdown file later is easy. Demoting a markdown file with subtle structure to SQLite later is painful.
