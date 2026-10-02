import { beforeEach, describe, expect, it, vi } from "vitest";
import { createProjectPriority, createProjectStatus, createProjectTag, linkProjectTaskEvent, updateProjectTask } from "$lib/api/projects";
import { createProjectStoreActions } from "$lib/stores/project-store-actions";
import { createProjectStoreSelectors } from "$lib/stores/project-store-selectors";
import actionSource from "$lib/stores/project-store-actions.ts?raw";
import type {
  ProjectMutation,
  ProjectsSnapshot,
  ProjectTask,
  ProjectTaskUpdate,
} from "$lib/projects/types";

vi.mock("$lib/api/projects", async (importOriginal) => ({
  ...await importOriginal<typeof import("$lib/api/projects")>(),
  updateProjectTask: vi.fn(),
  linkProjectTaskEvent: vi.fn(),
  createProjectStatus: vi.fn(),
  createProjectPriority: vi.fn(),
  createProjectTag: vi.fn(),
}));

function emptySnapshot(): ProjectsSnapshot {
  return {
    groups: [], projects: [], sections: [], statuses: [], priorities: [], tasks: [],
    checklistItems: [], tags: [], taskTagLinks: [], customFields: [], customFieldOptions: [],
    customFieldValues: [], customFieldOptionValues: [], dependencies: [], eventLinks: [],
    taskChangeEvents: [], viewPreferences: [], customEmojis: [],
  };
}

const task: ProjectTask = {
  id: "task-1", projectId: "project-1", sectionId: "section-1", statusId: "status-1",
  title: "Before", description: "", priority: "none", taskType: "task",
  sectionSortOrder: 1000, statusSortOrder: 1000, milestone: false,
  createdAt: "created", updatedAt: "before", detailLoaded: true,
};

function taskMutation(changedTask: ProjectTask): ProjectMutation {
  return {
    changed: { ...emptySnapshot(), tasks: [changedTask] },
    removals: [],
    calendarEventProjectAssignments: [],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

describe("createProjectStoreActions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("contains no ordinary mutation path that follows success with a snapshot reload", () => {
    expect(actionSource).not.toMatch(/\breload\s*\(/u);
  });

  function setup() {
    let snapshot = { ...emptySnapshot(), tasks: [task] };
    let loadGeneration = 0;
    const reloaded = { ...emptySnapshot(), tasks: [{ ...task, title: "Forced", updatedAt: "forced" }] };
    const reload = vi.fn(async (_projectId?: string | null) => {
      loadGeneration += 1;
      snapshot = reloaded;
    });
    const applyCalendarEventProjectAssignments = vi.fn(async () => undefined);
    const actions = createProjectStoreActions({
      selectors: createProjectStoreSelectors(() => snapshot),
      readSnapshot: () => snapshot,
      readLoadGeneration: () => loadGeneration,
      updateSnapshot: (updater) => { snapshot = updater(snapshot); },
      applyCalendarEventProjectAssignments,
      readSelectedProjectId: () => "project-1",
      setSelectedProjectId: vi.fn(),
      reload,
      ensureProjectData: vi.fn(async () => undefined),
      ensureTaskDetailData: vi.fn(async (_projectId: string, taskId: string) => {
        snapshot = {
          ...snapshot,
          tasks: snapshot.tasks.map((task) => task.id === taskId ? { ...task, detailLoaded: true } : task),
        };
      }),
    });
    return { actions, readSnapshot: () => snapshot, reload, applyCalendarEventProjectAssignments };
  }

  it("preserves settings draft identities and ranks when creating collection rows", async () => {
    const dates = { createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" };
    vi.mocked(createProjectStatus).mockImplementation(async (entry) => ({ changed: { ...emptySnapshot(), statuses: [{ ...entry, ...dates }] }, removals: [], calendarEventProjectAssignments: [] }));
    vi.mocked(createProjectPriority).mockImplementation(async (entry) => ({ changed: { ...emptySnapshot(), priorities: [{ ...entry, ...dates }] }, removals: [], calendarEventProjectAssignments: [] }));
    vi.mocked(createProjectTag).mockImplementation(async (entry) => ({ changed: { ...emptySnapshot(), tags: [{ ...entry, ...dates, color: 8 as const }] }, removals: [], calendarEventProjectAssignments: [] }));
    const { actions, readSnapshot } = setup();
    await actions.addStatus("project-1", "Ready", "active", 8, { id: "draft-status", sortOrder: 4 });
    await actions.addPriority("project-1", "Medium", 8, { id: "draft-priority", sortOrder: 5 });
    await actions.addTag("project-1", "Work", 8, { id: "draft-tag", sortOrder: 6 });
    expect(createProjectStatus).toHaveBeenCalledWith(expect.objectContaining({ id: "draft-status", sortOrder: 4 }));
    expect(createProjectPriority).toHaveBeenCalledWith(expect.objectContaining({ id: "draft-priority", sortOrder: 5 }));
    expect(createProjectTag).toHaveBeenCalledWith(expect.objectContaining({ id: "draft-tag", sortOrder: 6 }));
    expect(readSnapshot().tags[0].id).toBe("draft-tag");
    await expect(actions.addTag("project-1", "Work", 8, { id: "another-draft", sortOrder: 7 })).rejects.toThrow("A tag with this name already exists");
    expect(createProjectTag).toHaveBeenCalledOnce();
    expect((await actions.addTag("project-1", "Work"))?.id).toBe("draft-tag");
  });

  it("patches an authoritative task result with no follow-up snapshot load", async () => {
    vi.mocked(updateProjectTask).mockImplementation(async (update: ProjectTaskUpdate) =>
      taskMutation({ ...task, title: update.title, updatedAt: "server" }));
    const context = setup();

    await context.actions.updateTask(task, { title: "After" });

    expect(context.readSnapshot().tasks[0]).toMatchObject({ title: "After", updatedAt: "server" });
    expect(context.reload).not.toHaveBeenCalled();
  });

  it("keeps the snapshot unchanged when the command transaction fails", async () => {
    vi.mocked(updateProjectTask).mockRejectedValue(new Error("transaction rolled back"));
    const context = setup();

    await expect(context.actions.updateTask(task, { title: "After" })).rejects.toThrow("transaction rolled back");

    expect(context.readSnapshot().tasks[0]).toEqual(task);
    expect(context.reload).not.toHaveBeenCalled();
  });

  it("ignores an older response for the same entity", async () => {
    const first = deferred<ProjectMutation>();
    const second = deferred<ProjectMutation>();
    vi.mocked(updateProjectTask)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const context = setup();
    const oldRequest = context.actions.updateTask(task, { title: "Old response" });
    const newRequest = context.actions.updateTask(task, { title: "New response" });

    second.resolve(taskMutation({ ...task, title: "New response", updatedAt: "new" }));
    await newRequest;
    first.resolve(taskMutation({ ...task, title: "Old response", updatedAt: "old" }));
    await oldRequest;

    expect(context.readSnapshot().tasks[0]).toMatchObject({ title: "New response", updatedAt: "new" });
  });

  it("allows an explicit forced reload to reconcile a local patch", async () => {
    vi.mocked(updateProjectTask).mockResolvedValue(
      taskMutation({ ...task, title: "Local patch", updatedAt: "local" }),
    );
    const context = setup();
    await context.actions.updateTask(task, { title: "Local patch" });

    await context.reload("project-1");

    expect(context.readSnapshot().tasks[0]).toMatchObject({ title: "Forced", updatedAt: "forced" });
    expect(context.reload).toHaveBeenCalledOnce();
  });

  it("does not apply a mutation response that predates a forced reload", async () => {
    const pending = deferred<ProjectMutation>();
    vi.mocked(updateProjectTask).mockReturnValue(pending.promise);
    const context = setup();
    const request = context.actions.updateTask(task, { title: "Stale" });

    await context.reload("project-1");
    pending.resolve(taskMutation({ ...task, title: "Stale", updatedAt: "stale" }));
    await request;

    expect(context.readSnapshot().tasks[0]).toMatchObject({ title: "Forced", updatedAt: "forced" });
  });

  it("patches event links and forwards a server-derived calendar assignment", async () => {
    vi.mocked(linkProjectTaskEvent).mockResolvedValue({
      changed: {
        ...emptySnapshot(),
        eventLinks: [{ taskId: "task-1", eventId: "event-1", linkKind: "scheduled", createdAt: "server" }],
      },
      removals: [],
      calendarEventProjectAssignments: [{ eventId: "event-1", projectId: "project-1" }],
    });
    const context = setup();

    await context.actions.linkTaskEvent("task-1", "event-1");

    expect(context.readSnapshot().eventLinks).toHaveLength(1);
    expect(context.applyCalendarEventProjectAssignments).toHaveBeenCalledWith([
      { eventId: "event-1", projectId: "project-1" },
    ]);
    expect(context.reload).not.toHaveBeenCalled();
  });
});
