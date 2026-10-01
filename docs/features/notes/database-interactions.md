# Database interaction direction

Status: implemented in source. Compact floating settings, contextual property actions, typed advanced queries, saved table presentation, row sub-items, source management, and shell editing locks are implemented. Real Tauri visual and touch acceptance remains pending.

## Reference interpretation

The supplied Notion Tasks reference shows three layers: a view bar with compact utility controls and a split New button, an applied filter and sort strip, and grouped table content. A selected property opens a menu directly from its header, with deeper property options in a second menu. View settings distinguish view presentation from data source configuration. Current values appear on the right of concise rows, without displaying all configuration fields at once.

The useful design rule is progressive disclosure. Rows and their values are the primary content; controls have restrained typography, consistent icon size, short labels, and predictable spacing. Group headers show identity, count, collapse, and creation. Property and row menus act on the item that opened them. Colors communicate status and active query state rather than decorate every action. Touch requires larger hit targets without imposing that spacing on pointer layouts.

Notion documents independent settings per saved view, property visibility, ordered sorts, grouping, and advanced filter groups in its [view documentation](https://www.notion.com/help/views-filters-and-sorts). Its [table documentation](https://www.notion.com/help/tables) covers column menus, wrapping, freezing, and calculations. These are product references, not a requirement to copy hosted permissions or AI services into the local app.

## Current comparison

| Reference interaction | Notes | Projects |
| --- | --- | --- |
| Saved views over shared records | Six layouts, rename, duplicate, delete, independent view configuration, and linked databases | Saved task view configurations with independent filters, sorts, visibility, grouping, and archive state |
| Compact floating view settings | Anchored popover, current values, detail pages, back navigation, outside dismissal | Shared floating shell with domain-owned query and column controls |
| Property header menu | Edit, insert beside, duplicate empty, filter, sort, hide, reorder, resize, wrap, freeze, format, and calculate | Contextual task and custom-property controls, resizing, automatic fitting, formatting, and calculations |
| Grouped table with collapsible headers | Saved group identity, order, collapse, empty-group visibility, complete filtered counts, and contextual creation | Grouped task list, section ordering, and subtasks |
| Applied query strip | All six layouts show active sorts and individual filtered properties with direct query editing | Existing project filters and active query controls |
| Type-aware filtering | All six layouts share numeric and date comparisons and bounded AND/OR groups; incompatible schema edits reconcile saved predicates | Typed task and custom-field filters retain their domain query contract |
| Property formatting | Schema number formats and saved column date/time formats are honored | Saved date, time, and compatible custom-number formats |
| Date ranges and metadata | Explicit range/time-zone editor, preserved metadata on scalar edits, and complete read-only property rendering | Typed task dates and domain metadata have separate contracts |
| Wrapping and frozen columns | Saved wrapping and frozen prefix; narrow viewports reduce the effective prefix while preserving the saved identity | Saved per-column wrapping and responsive frozen prefix |
| Column/group calculations | Typed compatible reducers over the complete filtered source, including hydrated computed values | Complete filtered-result column footer calculations |
| Colored status/select values | Options have identities and colors; reusable badges exist | Status, priority, and task metadata have domain colors |
| Conditional row/cell color | Ordered typed row or property color rules saved with the view | Saved status/priority row color rules |
| New and template split button | Blank table page creation, existing templates, default templates, contextual board/date creation | Task creation and project templates have separate domain rules |
| Property duplicate and insert left/right | Atomic positional insertion and empty schema duplication with fresh property and option identities | Contextual custom-property insertion and empty duplication with fresh option identities |
| Multiple data sources and source settings | Create owned sources, attach existing shared sources, and select source-specific saved views and schema | Project membership and task ownership have their own model |
| Sub-items | Source-local row hierarchy, atomic child creation, parent reassignment, collapse, and validated copy/history recovery | Task subtasks are implemented |
| Lock, access, notifications, automations, and AI autofill | Shell-local editing lock protects layout and schema while rows stay editable. Typed local buttons exist. Property access and AI autofill are separate future contracts; reminders belong to Calendar | Project access, scheduling, and optional Chat are separate contracts; arbitrary database automation is absent |

## Implemented boundaries

Date edits retain end and time zone unless the user explicitly changes them. Display preferences never change canonical dates or numeric values. Read-only files, people, identifiers, and actor/timestamp metadata use the same property display boundary across layouts.

Counts and calculations describe the complete filtered source. Numeric reducers skip empty and nonnumeric computed values; zero and false are populated. Empty sums and counts are zero, while empty average/minimum/maximum and checked percentages have no result. Unique counts use canonical identities. A multi-valued row contributes once to each of its distinct groups.

Notes queries allow ten predicates, eight nested groups, and three levels of grouping, with five ordered sorts. Formula, rollup, and button predicates remain unavailable because their hydrated values are outside the SQL pagination filter boundary. Calculations may hydrate computed values over all matching rows. Conditional colors share the validated predicate contract and use the first matching rule for each target.

Contextual insertion and duplication operate on the latest source schema transactionally. A duplicate starts with empty row values and fresh identities, and title invariants remain enforced. Sources share rows through independent shell-owned views; selecting a view selects its source for subsequent reads and edits.

The editing lock is a reversible preference on each database shell, including linked shells, rather than an access-control system. It blocks structural, presentation, and query changes in that shell while row editing and creation remain available. Creation inside a collapsed locked group or parent temporarily reveals the new row without changing the saved collapse preference. Row sub-items remain owned by their data source; hierarchy validation protects cycles, cross-source parents, bounded depth, graph copying, and project-history recovery.

Shared collection components own presentation and interaction. Notes and Projects adapters own schema, persistence, query semantics, and record mutation. Hosted permissions, arbitrary automation, and AI autofill need separate product contracts and are not exposed as inactive menu actions.
