// @vitest-environment jsdom
import { mount, tick, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyNotesDataSourcePropertyAction,
  getNotesDatabaseReference,
  getNotesDataSourceSchema,
  getNotesDataSourceTableView,
  listNotesDatabaseViews,
  listNotesDataSources,
  listNotesDataSourceTemplates,
  setNotesDatabaseEditingLock,
  updateNotesDataSourceSchema,
} from "$lib/api/notes";
import type { NotesChildDatabaseBlock as NotesChildDatabaseBlockDto, NotesDataSourceSchema, NotesDataSourceTableView, NotesDatabaseReference } from "$lib/notes/types";
import { notesDatabaseSession } from "$lib/notes/database-session.svelte";
import NotesChildDatabaseBlock from "./NotesChildDatabaseBlock.svelte";

vi.mock("$lib/api/notes", () => ({
  applyNotesDataSourcePropertyAction: vi.fn(), createNotesDataSource: vi.fn(), attachNotesDataSource: vi.fn(), setNotesDatabaseEditingLock: vi.fn(),
  getNotesDatabaseReference: vi.fn(), getNotesDataSourceSchema: vi.fn(), getNotesDataSourceTableView: vi.fn(),
  listNotesDatabaseViews: vi.fn(), listNotesDataSources: vi.fn(), listNotesDataSourceTemplates: vi.fn(),
  renameNotesDatabase: vi.fn(), updateNotesDataSourceSchema: vi.fn(), updateNotesDataSourceTableView: vi.fn(),
}));

/** Provide a real schema and table that can identify a property other than title. */
function fixture(): { block: NotesChildDatabaseBlockDto; table: NotesDataSourceTableView } {
  const source = {
    source_provider: null, source_object_id: null, source_workspace_id: null,
    source_last_edited_time: null, created_time: "2026-09-30T00:00:00Z", last_edited_time: "2026-09-30T00:00:00Z",
  };
  return {
    block: {
      object: "block", id: "block", parent: { type: "page_id", page_id: "page" },
      created_time: source.created_time, last_edited_time: source.last_edited_time,
      has_children: false, in_trash: false, archived: false,
      source_provider: null, source_object_id: null, source_last_edited_time: null,
      type: "child_database", child_database: { title: "Tasks", database_id: "database", data_source_id: "source", view_id: "view" },
    },
    table: {
      data_source: {
        ...source, object: "data_source", id: "source", parent: { type: "database_id", database_id: "database" },
        database_parent: { type: "page_id", page_id: "page" }, title: "Tasks", title_rich_text: [], description: [],
        icon: null, in_trash: false, properties: {
          Name: { id: "title", name: "Name", type: "title", title: {} },
          Priority: { id: "priority", name: "Priority", type: "number", number: { format: "number" } },
        },
      },
      view: {
        ...source, object: "view", id: "view", parent: { type: "database_id", database_id: "database" },
        data_source_id: "source", name: "Table", type: "table", filter: null, sorts: [], url: null,
        configuration: { type: "table", table: {
          property_order: ["title", "priority"], hidden_property_ids: [], column_widths: {}, row_open_mode: "full_page",
        } },
      },
      rows: [], total_row_count: 0, has_more: false, next_cursor: null,
    },
  };
}

let component: ReturnType<typeof mount> | undefined;
afterEach(async () => {
  if (component) await unmount(component);
  component = undefined;
  notesDatabaseSession.clear();
  document.body.replaceChildren();
  vi.resetAllMocks();
});

/** Mount the real database shell and table with read-only native boundaries mocked. */
async function open(referenceRead?: Promise<NotesDatabaseReference>): Promise<NotesDataSourceTableView> {
  const { block, table } = fixture();
  const reference: NotesDatabaseReference = {
    block_id: "block", page_id: "page", source_block_id: "block", source_page_id: "page", title: "Tasks",
    owned_data_source_count: 1, is_linked: false, editing_locked: false,
  };
  if (referenceRead) vi.mocked(getNotesDatabaseReference).mockReturnValue(referenceRead);
  else vi.mocked(getNotesDatabaseReference).mockResolvedValue(reference);
  vi.mocked(getNotesDataSourceTableView).mockResolvedValue(table);
  vi.mocked(listNotesDatabaseViews).mockResolvedValue([table.view]);
  vi.mocked(listNotesDataSources).mockResolvedValue([table.data_source]);
  vi.mocked(listNotesDataSourceTemplates).mockResolvedValue([]);
  component = mount(NotesChildDatabaseBlock, { target: document.body, props: {
    block, focusBlockId: null, focusRequestId: 0, onFocusBlock: vi.fn(), onKeydown: vi.fn(),
    onSelectPage: vi.fn(), onCreateLinkedDatabaseView: vi.fn(),
  } });
  // The first mount also compiles the lazily imported table renderer.
  await vi.waitFor(() => expect(document.querySelector('[role="columnheader"] button[aria-label="Name"]')).not.toBeNull(), { timeout: 5_000 });
  return table;
}

/** Invoke the actual header menu so selection crosses both component boundaries. */
async function editProperty(name: string): Promise<void> {
  document.querySelector<HTMLButtonElement>(`[role="columnheader"] button[aria-label="${name}"]`)!.click();
  await tick();
  await tick();
  const menu = document.querySelector<HTMLElement>(`[role="dialog"][aria-label="${name}"]`)!;
  const edit = Array.from(menu.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent?.trim() === "Edit property");
  expect(edit).toBeDefined();
  edit!.click();
  await tick();
}

/** Inspect the public property name field of the floating schema editor. */
function propertyName(): HTMLInputElement | null {
  const panel = document.querySelector('[role="dialog"][aria-label="Edit properties"]');
  const nameLabel = Array.from(panel?.querySelectorAll<HTMLLabelElement>("label") ?? [])
    .find((label) => label.querySelector("span")?.textContent?.trim() === "Name");
  return nameLabel?.querySelector("input") ?? null;
}

/** Dismiss the floating editor while retaining its unsaved local draft. */
async function closePropertyEditor(): Promise<void> {
  document.querySelector<HTMLButtonElement>('[role="dialog"][aria-label="Edit properties"] button[aria-label="Close"]')!.click();
  await tick();
}

/** Edit the existing property's local name without saving its schema. */
async function draftPriorityName(name: string): Promise<void> {
  await editProperty("Priority");
  await vi.waitFor(() => expect(propertyName()?.value).toBe("Priority"));
  const input = propertyName()!;
  input.value = name;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await tick();
  await closePropertyEditor();
}

/** Use the real table header picker to request a new numeric property. */
async function addHeaderProperty(name: string, typeLabel = "Number"): Promise<void> {
  document.querySelector<HTMLButtonElement>('[role="columnheader"] button[aria-label="Add property"]')!.click();
  await tick();
  await tick();
  const picker = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Add property"]')!;
  const nameInput = picker.querySelector<HTMLInputElement>('input[aria-label="Name"]')!;
  nameInput.value = name;
  nameInput.dispatchEvent(new Event("input", { bubbles: true }));
  await tick();
  const number = Array.from(picker.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent?.trim() === typeLabel);
  expect(number).toBeDefined();
  number!.click();
  await tick();
}

describe("Notes database property editor selection", () => {
  it("loads relation source choices when a quick addition cached schema before its first editor open", async () => {
    const initial = fixture().table;
    const canonical = { ...initial.data_source, properties: { ...initial.data_source.properties,
      Project: { id: "project", name: "Project", type: "relation", relation: { data_source_id: "foreign", type: "single_property", single_property: {} } },
    } };
    const foreign = { ...initial.data_source, id: "foreign", title: "Foreign projects" };
    vi.mocked(getNotesDataSourceSchema).mockResolvedValue({ data_source: canonical, view: initial.view });
    vi.mocked(updateNotesDataSourceSchema).mockImplementation(async (_source, update) => {
      const updated = { ...initial, data_source: { ...canonical, properties: update.properties } };
      vi.mocked(getNotesDataSourceTableView).mockResolvedValue(updated);
      return { data_source: updated.data_source, view: updated.view };
    });
    await open();
    vi.mocked(listNotesDataSources).mockResolvedValue([canonical, foreign]);
    await addHeaderProperty("Estimate");
    await vi.waitFor(() => expect(document.querySelector('[role="columnheader"] button[aria-label="Project"]')).not.toBeNull());
    expect(listNotesDataSources).not.toHaveBeenCalled();
    await editProperty("Project");
    await vi.waitFor(() => expect(listNotesDataSources).toHaveBeenCalledOnce());
    expect(getNotesDataSourceSchema).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(propertyName()?.disabled).toBe(false));
    const choices = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"][aria-label="Edit properties"] button'));
    expect(choices.some((button) => button.textContent?.includes("Foreign projects"))).toBe(true);
  });
  it.each(["append", "insert"] as const)("loads foreign source metadata for a first %s rollup without opening the schema editor", async (operation) => {
    const initial = fixture().table;
    const canonical = { ...initial.data_source, properties: { ...initial.data_source.properties,
      Project: { id: "project", name: "Project", type: "relation", relation: { data_source_id: "foreign", type: "single_property", single_property: {} } },
    } };
    const foreign = { ...initial.data_source, id: "foreign", properties: { Budget: { id: "budget", name: "Budget", type: "number", number: { format: "number" } } } };
    vi.mocked(getNotesDataSourceSchema).mockResolvedValue({ data_source: canonical, view: initial.view });
    vi.mocked(updateNotesDataSourceSchema).mockImplementation(async (_source, update) => ({ data_source: { ...canonical, properties: update.properties }, view: initial.view }));
    vi.mocked(applyNotesDataSourcePropertyAction).mockImplementation(async (_source, _database, _view, action) => {
      if (action.type !== "insert") throw new Error("expected insertion");
      return { property_id: String(action.property.id), schema: { data_source: { ...canonical, properties: { ...canonical.properties, Total: action.property } }, view: initial.view } };
    });
    await open();
    vi.mocked(listNotesDataSources).mockResolvedValue([canonical, foreign]);
    if (operation === "append") await addHeaderProperty("Total", "Rollup");
    else {
      document.querySelector<HTMLButtonElement>('[role="columnheader"] button[aria-label="Priority"]')!.click();
      await tick();
      await tick();
      document.querySelector<HTMLButtonElement>('button[aria-label="Insert property right"]')!.click();
      await tick();
      await tick();
      const panel = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Insert property right"]')!;
      const name = panel.querySelector<HTMLInputElement>('input[aria-label="Name"]')!;
      name.value = "Total";
      name.dispatchEvent(new Event("input", { bubbles: true }));
      await tick();
      Array.from(panel.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.trim() === "Rollup")!.click();
    }
    await vi.waitFor(() => expect(listNotesDataSources).toHaveBeenCalledOnce());
    if (operation === "append") await vi.waitFor(() => expect(updateNotesDataSourceSchema).toHaveBeenCalledWith("source", expect.objectContaining({ properties: expect.objectContaining({ Total: expect.objectContaining({ rollup: expect.objectContaining({ relation_property_id: "project", rollup_property_id: "budget" }) }) }) }), { dataSourceId: "source", databaseId: "database", viewId: "view" }));
    else await vi.waitFor(() => expect(applyNotesDataSourcePropertyAction).toHaveBeenCalledWith("source", "database", "view", expect.objectContaining({ type: "insert", property_id: "priority", side: "right", property: expect.objectContaining({ rollup: expect.objectContaining({ relation_property_id: "project", rollup_property_id: "budget" }) }) })));
    expect(document.querySelector('[role="dialog"][aria-label="Edit properties"]')).toBeNull();
  });
  it("refreshes a sibling's durable lock and keeps a newer toggle when an initial reference read finishes late", async () => {
    let finishRead: (value: NotesDatabaseReference) => void = () => {};
    const pendingRead = new Promise<NotesDatabaseReference>((resolve) => { finishRead = resolve; });
    const reference: NotesDatabaseReference = { block_id: "block", page_id: "page", source_block_id: "block", source_page_id: "page", title: "Tasks", is_linked: false, owned_data_source_count: 1, editing_locked: true };
    vi.mocked(setNotesDatabaseEditingLock).mockResolvedValue(reference);
    await open(pendingRead);
    document.querySelector<HTMLButtonElement>('button[aria-label="View settings"]')!.click();
    await tick();
    document.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Database layout lock"]')!.click();
    await vi.waitFor(() => expect(setNotesDatabaseEditingLock).toHaveBeenCalledWith("database", true));
    await vi.waitFor(() => expect(document.querySelector<HTMLButtonElement>('[role="columnheader"] button[aria-label="Priority"]')?.disabled).toBe(true));
    finishRead({ ...reference, editing_locked: false });
    await tick();
    await tick();
    expect(document.querySelector<HTMLButtonElement>('[role="columnheader"] button[aria-label="Priority"]')?.disabled).toBe(true);
    vi.mocked(getNotesDatabaseReference).mockResolvedValue({ ...reference, editing_locked: false });
    notesDatabaseSession.invalidate();
    await vi.waitFor(() => expect(document.querySelector<HTMLButtonElement>('[role="columnheader"] button[aria-label="Priority"]')?.disabled).toBe(false));
  });
  it("routes contextual empty duplication to the requesting table and preserves an unsaved schema draft", async () => {
    const initial = fixture().table;
    vi.mocked(getNotesDataSourceSchema).mockResolvedValue({ data_source: initial.data_source, view: initial.view });
    vi.mocked(applyNotesDataSourcePropertyAction).mockImplementation(async (_source, _database, _view, action) => {
      expect(action).toEqual({ type: "duplicate", property_id: "priority", name: "Priority (copy)" });
      const updated: NotesDataSourceTableView = {
        ...initial, data_source: { ...initial.data_source, properties: { ...initial.data_source.properties,
          "Priority (copy)": { id: "priority-copy", name: "Priority (copy)", type: "number", number: { format: "number" } },
        } },
      };
      vi.mocked(getNotesDataSourceTableView).mockResolvedValue(updated);
      return { property_id: "priority-copy", schema: { data_source: updated.data_source, view: updated.view } };
    });
    await open();
    await draftPriorityName("Draft priority");
    document.querySelector<HTMLButtonElement>('[role="columnheader"] button[aria-label="Priority"]')!.click();
    await tick();
    await tick();
    const duplicate = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"][aria-label="Priority"] button'))
      .find((button) => button.textContent?.trim() === "Duplicate property (empty)")!;
    duplicate.click();
    await vi.waitFor(() => expect(applyNotesDataSourcePropertyAction).toHaveBeenCalledWith("source", "database", "view", { type: "duplicate", property_id: "priority", name: "Priority (copy)" }));
    await vi.waitFor(() => expect(document.querySelector('[role="columnheader"] button[aria-label="Priority (copy)"]')).not.toBeNull());
    expect(updateNotesDataSourceSchema).not.toHaveBeenCalled();
    await editProperty("Priority");
    await vi.waitFor(() => expect(propertyName()?.value).toBe("Draft priority"));
  });

  it("retains independent unsaved drafts when editing properties from two attached sources", async () => {
    const initial = fixture().table;
    const second: NotesDataSourceTableView = {
      ...initial, data_source: { ...initial.data_source, id: "second-source" },
      view: { ...initial.view, id: "second-view", name: "Second table", data_source_id: "second-source" },
    };
    vi.mocked(getNotesDataSourceSchema).mockImplementation(async (sourceId) => {
      const selected = sourceId === "second-source" ? second : initial;
      return { data_source: selected.data_source, view: selected.view };
    });
    await open();
    vi.mocked(listNotesDatabaseViews).mockResolvedValue([initial.view, second.view]);
    vi.mocked(getNotesDataSourceTableView).mockImplementation(async (sourceId) => sourceId === "second-source" ? second : initial);
    notesDatabaseSession.invalidate();
    await draftPriorityName("First draft");
    await vi.waitFor(() => expect(document.querySelector<HTMLButtonElement>('button[aria-label="Second table"]')).not.toBeNull());
    document.querySelector<HTMLButtonElement>('button[aria-label="Second table"]')!.click();
    await vi.waitFor(() => expect(getNotesDataSourceTableView).toHaveBeenCalledWith("second-source", { databaseId: "database", viewId: "second-view" }));
    await draftPriorityName("Second draft");
    expect(getNotesDataSourceSchema).toHaveBeenCalledWith("second-source", { databaseId: "database", viewId: "second-view" });
    document.querySelector<HTMLButtonElement>('button[aria-label="Table"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('[role="columnheader"] button[aria-label="Priority"]')).not.toBeNull());
    await editProperty("Priority");
    await vi.waitFor(() => expect(propertyName()?.value).toBe("First draft"));
    await closePropertyEditor();
    document.querySelector<HTMLButtonElement>('button[aria-label="Second table"]')!.click();
    await tick();
    await editProperty("Priority");
    await vi.waitFor(() => expect(propertyName()?.value).toBe("Second draft"));
    expect(updateNotesDataSourceSchema).not.toHaveBeenCalled();
  });

  it("ignores a delayed different-source schema result after reopening the cached source", async () => {
    const initial = fixture().table;
    const second: NotesDataSourceTableView = { ...initial,
      data_source: { ...initial.data_source, id: "second-source" },
      view: { ...initial.view, id: "second-view", name: "Second table", data_source_id: "second-source" },
    };
    let finishSecond: (schema: NotesDataSourceSchema) => void = () => {};
    vi.mocked(getNotesDataSourceSchema).mockImplementation((sourceId) => sourceId === "second-source"
      ? new Promise((resolve) => { finishSecond = resolve; })
      : Promise.resolve({ data_source: initial.data_source, view: initial.view }));
    await open();
    vi.mocked(listNotesDatabaseViews).mockResolvedValue([initial.view, second.view]);
    vi.mocked(getNotesDataSourceTableView).mockImplementation(async (sourceId) => sourceId === "second-source" ? second : initial);
    notesDatabaseSession.invalidate();
    await draftPriorityName("First draft");
    await vi.waitFor(() => expect(document.querySelector<HTMLButtonElement>('button[aria-label="Second table"]')).not.toBeNull());
    document.querySelector<HTMLButtonElement>('button[aria-label="Second table"]')!.click();
    await vi.waitFor(() => expect(getNotesDataSourceTableView).toHaveBeenCalledWith("second-source", { databaseId: "database", viewId: "second-view" }));
    await editProperty("Priority");
    await vi.waitFor(() => expect(getNotesDataSourceSchema).toHaveBeenCalledWith("second-source", { databaseId: "database", viewId: "second-view" }));
    expect(propertyName()?.disabled).toBe(true);
    await closePropertyEditor();
    document.querySelector<HTMLButtonElement>('button[aria-label="Table"]')!.click();
    await tick();
    await editProperty("Priority");
    expect(propertyName()?.value).toBe("First draft");
    finishSecond({ data_source: second.data_source, view: second.view });
    await tick();
    await tick();
    expect(propertyName()?.value).toBe("First draft");
    expect(propertyName()?.disabled).toBe(false);
  });
  it("selects the requested header property after its initial schema read finishes", async () => {
    let finishSchema: (schema: NotesDataSourceSchema) => void = () => {};
    vi.mocked(getNotesDataSourceSchema).mockImplementation(() => new Promise((resolve) => { finishSchema = resolve; }));
    const table = await open();
    await editProperty("Priority");
    await vi.waitFor(() => expect(getNotesDataSourceSchema).toHaveBeenCalledOnce());
    expect(propertyName()).toBeNull();
    finishSchema({ data_source: table.data_source, view: table.view });
    await vi.waitFor(() => expect(propertyName()?.value).toBe("Priority"));
    expect(document.querySelector('[role="dialog"][aria-label="Edit properties"]')).not.toBeNull();
  });

  it("changes the selected property on cached reopens without another schema read", async () => {
    const table = fixture().table;
    vi.mocked(getNotesDataSourceSchema).mockResolvedValue({ data_source: table.data_source, view: table.view });
    await open();
    await editProperty("Name");
    await vi.waitFor(() => expect(propertyName()?.value).toBe("Name"));
    document.querySelector<HTMLButtonElement>('[role="dialog"][aria-label="Edit properties"] button[aria-label="Close"]')!.click();
    await tick();
    await editProperty("Priority");
    await vi.waitFor(() => expect(propertyName()?.value).toBe("Priority"));
    expect(getNotesDataSourceSchema).toHaveBeenCalledOnce();
  });

  it("adds a canonical property without saving or discarding an unrelated editor draft", async () => {
    const initial = fixture().table;
    vi.mocked(getNotesDataSourceSchema).mockResolvedValue({ data_source: initial.data_source, view: initial.view });
    vi.mocked(updateNotesDataSourceSchema).mockImplementation(async (_sourceId, update) => {
      const table: NotesDataSourceTableView = {
        ...initial,
        data_source: { ...initial.data_source, properties: update.properties },
      };
      vi.mocked(getNotesDataSourceTableView).mockResolvedValue(table);
      return { data_source: table.data_source, view: table.view };
    });
    await open();
    await draftPriorityName("Draft priority");
    expect(updateNotesDataSourceSchema).not.toHaveBeenCalled();
    await addHeaderProperty("Estimate");
    await vi.waitFor(() => expect(updateNotesDataSourceSchema).toHaveBeenCalledOnce());
    const update = vi.mocked(updateNotesDataSourceSchema).mock.calls[0][1];
    expect(update.properties.Priority).toMatchObject({ id: "priority", name: "Priority", type: "number" });
    expect(update.properties).not.toHaveProperty("Draft priority");
    expect(update.properties.Estimate).toMatchObject({ name: "Estimate", type: "number" });
    await vi.waitFor(() => expect(document.querySelector('[role="columnheader"] button[aria-label="Estimate"]')).not.toBeNull());
    await editProperty("Priority");
    await vi.waitFor(() => expect(propertyName()?.value).toBe("Draft priority"));
    const panel = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Edit properties"]')!;
    const save = Array.from(panel.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.trim() === "Save properties");
    expect(save?.disabled).toBe(false);
    panel.querySelector<HTMLButtonElement>('button[aria-label="Properties"]')!.click();
    await tick();
    await tick();
    const estimate = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]'))
      .find((button) => button.textContent?.trim() === "Estimate");
    expect(estimate).toBeDefined();
    estimate!.click();
    await tick();
    expect(propertyName()?.value).toBe("Estimate");
  });

  it("retains the unsaved editor draft when quick property creation fails", async () => {
    const initial = fixture().table;
    vi.mocked(getNotesDataSourceSchema).mockResolvedValue({ data_source: initial.data_source, view: initial.view });
    vi.mocked(updateNotesDataSourceSchema).mockRejectedValue(new Error("Cannot create property"));
    await open();
    await draftPriorityName("Draft priority");
    await addHeaderProperty("Estimate");
    await vi.waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toContain("Cannot create property"));
    expect(updateNotesDataSourceSchema).toHaveBeenCalledOnce();
    await editProperty("Priority");
    await vi.waitFor(() => expect(propertyName()?.value).toBe("Draft priority"));
    await closePropertyEditor();
    document.querySelector<HTMLButtonElement>('[role="columnheader"] button[aria-label="Add property"]')!.click();
    await tick();
    await tick();
    expect(document.querySelector<HTMLInputElement>('[role="dialog"][aria-label="Add property"] input[aria-label="Name"]')?.value)
      .toBe("Estimate");
  });
});
