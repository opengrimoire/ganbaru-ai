import { describe, expect, it } from "vitest";
import type { Translate } from "$lib/i18n/translator.svelte";
import type { NotesPage } from "$lib/notes/types";
import { buildNotesMentionTargets } from "./mention-targets";

function page(id: string, title: string): NotesPage {
  return {
    object: "page",
    id,
    created_time: "2026-01-01T00:00:00Z",
    last_edited_time: "2026-01-01T00:00:00Z",
    parent: { type: "workspace", workspace: true },
    folder_id: null,
    in_trash: false,
    icon: null,
    cover: null,
    properties: { title },
    url: null,
    public_url: null,
    source_provider: null,
    source_object_id: null,
    source_workspace_id: null,
    source_last_edited_time: null,
  };
}

const translate = ((key: string, ...args: unknown[]) => (
  args.length > 0 ? `${key}:${String(args[0])}` : key
)) as Translate;

describe("Notes block mention targets", () => {
  it("keeps target family order and deduplicates row pages already in the page list", () => {
    const firstPage = page("page-1", "First");
    const targets = buildNotesMentionTargets({
      pages: [firstPage],
      localUser: {
        object: "user",
        id: "user-1",
        display_name: "Victor",
        created_time: "2026-01-01T00:00:00Z",
        last_edited_time: "2026-01-01T00:00:00Z",
      },
      dataSources: [],
      dataSourceRowPages: [firstPage, page("page-2", "Second")],
      projects: [{ id: "project-1", name: "Project", status: "active" }],
      tasks: [],
      calendarEvents: [],
      activePomodoroRunId: "run-1",
      pomodoroTime: "12:34",
      currentMusicSource: null,
      musicQueue: [],
      translate,
    });

    expect(targets.map((target) => `${target.kind}:${target.id}`)).toEqual([
      "user:user-1",
      "page:page-1",
      "page:page-2",
      "project:project-1",
      "pomodoro_run:run-1",
    ]);
  });
});
