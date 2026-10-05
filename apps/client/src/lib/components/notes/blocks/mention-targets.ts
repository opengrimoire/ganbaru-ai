import {
  listNotesDataSources,
  listNotesDataSourceRowPages,
} from "$lib/api/notes";
import type { CalendarEvent } from "$lib/calendar/types";
import type { Translate } from "$lib/i18n/translator.svelte";
import { sourceDisplayLabel, type MusicSource } from "$lib/music/sources";
import { notesLocalUserDisplayName } from "$lib/notes/collaboration/local-user";
import { notesPageIconText } from "$lib/notes/pages/icon";
import { notesPageTitle } from "$lib/notes/pages/title";
import type {
  NotesNamedMentionTarget,
  NotesObjectMentionTarget,
  NotesPageMentionTarget,
} from "$lib/notes/rich-text/core";
import type { NotesDataSource, NotesLocalUser, NotesPage } from "$lib/notes/types";

export interface NotesDatabaseMentionData {
  dataSources: NotesDataSource[];
  rowPages: NotesPage[];
}

export interface NotesMentionProject {
  id: string;
  name: string;
  status: string;
}

export interface NotesMentionTask {
  id: string;
  projectId: string;
  title: string;
  archivedAt?: string | null;
}

export interface NotesMusicMentionContext {
  currentMusicSource: MusicSource | null;
  musicQueue: readonly MusicSource[];
}

export const EMPTY_NOTES_MUSIC_MENTION_CONTEXT: NotesMusicMentionContext = {
  currentMusicSource: null,
  musicQueue: [],
};

export interface NotesMentionTargetInput extends NotesMusicMentionContext {
  pages: readonly NotesPage[];
  localUser: NotesLocalUser | null;
  dataSources: readonly NotesDataSource[];
  dataSourceRowPages: readonly NotesPage[];
  projects: readonly NotesMentionProject[];
  tasks: readonly NotesMentionTask[];
  calendarEvents: readonly CalendarEvent[];
  activePomodoroRunId: string | null;
  pomodoroTime: string;
  translate: Translate;
}

/** Load local database mention sources while isolating failures by data source. */
export async function loadNotesDatabaseMentionData(): Promise<NotesDatabaseMentionData> {
  const dataSources = await listNotesDataSources();
  const rowPageGroups = await Promise.all(
    dataSources.map(async (dataSource) => {
      try {
        return await listNotesDataSourceRowPages(dataSource.id);
      } catch (error) {
        console.warn("notes mention data source row targets failed", error);
        return [];
      }
    }),
  );
  return { dataSources, rowPages: rowPageGroups.flat() };
}

/** Build the ordered, deduplicated mention catalog shown by Notes text editors. */
export function buildNotesMentionTargets(input: NotesMentionTargetInput): NotesNamedMentionTarget[] {
  const { translate: t } = input;
  const dataSourceById = new Map(input.dataSources.map((source) => [source.id, source]));
  const pagesById = new Map(input.pages.map((page) => [page.id, page]));
  const pageTargets: NotesPageMentionTarget[] = [];
  const seenPages = new Set<string>();
  for (const page of [...input.pages, ...input.dataSourceRowPages]) {
    if (seenPages.has(page.id)) continue;
    seenPages.add(page.id);
    let subtitle: string;
    if (page.parent.type === "data_source_id") {
      const dataSource = dataSourceById.get(page.parent.data_source_id);
      subtitle = dataSource
        ? t("notes.mentionTargetDataSourceRowIn", dataSource.title || t("notes.untitled"))
        : t("notes.mentionTargetDataSourceRow");
    } else {
      const parent = page.parent.type === "page_id" ? pagesById.get(page.parent.page_id) : null;
      subtitle = parent ? notesPageTitle(parent, t("notes.untitled")) : t("notes.workspace");
    }
    pageTargets.push({
      kind: "page",
      id: page.id,
      title: notesPageTitle(page, t("notes.untitled")),
      subtitle,
      iconText: notesPageIconText(page.icon),
    });
  }

  const userTargets: NotesObjectMentionTarget[] = input.localUser
    ? [{
        kind: "user",
        id: input.localUser.id,
        title: notesLocalUserDisplayName(input.localUser.display_name),
        subtitle: t("notes.mentionTargetLocalUser"),
      }]
    : [];
  const seenDatabases = new Set<string>();
  const databaseTargets: NotesObjectMentionTarget[] = [];
  for (const dataSource of input.dataSources) {
    const databaseId = dataSource.parent.database_id;
    if (seenDatabases.has(databaseId)) continue;
    seenDatabases.add(databaseId);
    databaseTargets.push({
      kind: "database",
      id: databaseId,
      title: dataSource.title || t("notes.untitled"),
      subtitle: t("notes.mentionTargetDatabase"),
      iconText: notesPageIconText(dataSource.icon),
    });
  }
  const projectById = new Map(input.projects.map((project) => [project.id, project]));
  const projectTargets: NotesObjectMentionTarget[] = input.projects
    .filter((project) => project.status === "active")
    .map((project) => ({
      kind: "project",
      id: project.id,
      title: project.name,
      subtitle: t("notes.mentionTargetProject"),
    }));
  const taskTargets: NotesObjectMentionTarget[] = input.tasks
    .filter((task) => !task.archivedAt)
    .map((task) => {
      const project = projectById.get(task.projectId);
      return {
        kind: "project_task",
        id: task.id,
        title: task.title || t("notes.untitled"),
        subtitle: project
          ? t("notes.mentionTargetProjectTaskIn", project.name)
          : t("notes.mentionTargetProjectTask"),
      };
    });
  const calendarTargets: NotesObjectMentionTarget[] = input.calendarEvents
    .filter((event) => event.status !== "cancelled")
    .map((event) => ({
      kind: "calendar_event",
      id: event.recurringParentId ?? event.id,
      title: event.title || t("notes.untitled"),
      subtitle: t("notes.mentionTargetCalendarEvent"),
    }));
  const pomodoroTargets: NotesObjectMentionTarget[] = input.activePomodoroRunId
    ? [{
        kind: "pomodoro_run",
        id: input.activePomodoroRunId,
        title: t("notes.mentionTargetPomodoroRun"),
        subtitle: input.pomodoroTime,
      }]
    : [];
  const musicTargets: NotesObjectMentionTarget[] = [];
  const seenMusic = new Set<string>();
  const musicSources = input.currentMusicSource
    ? [input.currentMusicSource, ...input.musicQueue]
    : [...input.musicQueue];
  for (const source of musicSources) {
    if (seenMusic.has(source.identity)) continue;
    seenMusic.add(source.identity);
    musicTargets.push({
      kind: "music_item",
      id: source.identity,
      title: sourceDisplayLabel(source),
      subtitle: t("notes.mentionTargetMusicItem"),
    });
  }

  return [
    ...userTargets,
    ...pageTargets,
    ...databaseTargets,
    ...projectTargets,
    ...taskTargets,
    ...calendarTargets,
    ...pomodoroTargets,
    ...musicTargets,
  ];
}
