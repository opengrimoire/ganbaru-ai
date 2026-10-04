# Project dependency cascade testing

Native tests exercise complete canonical chains without a supplied view window, downstream propagation, optional date fields, leap-day milestones, cycles, undated or invalid dates, foreign endpoints, overflow, protected work, stale previews, transaction rollback, durable retry, and bounded input/result admission. A second-task write failure must roll back earlier task dates, revisions, history, and the receipt. A committed receipt must survive reopening SQLite and must not rewrite a later edit on retry.

Frontend tests validate unknown preview payloads, request only project identity, suppress late results after project switches or repeated refreshes, preserve the reviewed proposal on uncertain apply, and reconcile native rows absent from the loaded cache. Store regressions retain the operation identity on retry and preserve newer canonical task revisions. Gantt geometry and date-drag tests remain TypeScript tests; dependency calculation belongs to the native suite.

In the real desktop and Android app:

- Filter or collapse Gantt so a dependency endpoint is hidden. Open dependency date review and verify every affected task, original date, proposed date, and dependency reason appears.
- Use a branched chain, a milestone, and tasks with due dates only. Confirm durations and populated date fields survive apply and reopening the project.
- Complete or archive an affected task, and separately add a scheduled Calendar link. Confirm the conflict is explained and Apply remains unavailable. Reference-only links should allow ordinary date repair.
- Change a task or dependency in another window after preview. Apply must report that review changed; refresh and review again before committing.
- Delay preview and switch projects. The previous project's proposal must not replace the current one. Delay or interrupt apply, retry, and verify dates and history change only once.
- Confirm Gantt drag feedback remains immediate and existing task detail, selection, keyboard navigation, and touch scrolling still work.

These automated checks do not prove physical interaction, rendered layout, or platform input latency.
