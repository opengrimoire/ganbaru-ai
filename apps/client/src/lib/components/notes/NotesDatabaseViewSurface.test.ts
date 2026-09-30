// @vitest-environment jsdom
import { mount, tick, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listNotesDatabaseViews, listNotesDataSourceTemplates } from "$lib/api/notes";
import { databaseResource, notesDatabaseSession } from "$lib/notes/database-session.svelte";
import type { NotesDatabaseView } from "$lib/notes/types";
import NotesDatabaseViewSurface from "./NotesDatabaseViewSurface.svelte";

vi.mock("$lib/api/notes", () => ({
  listNotesDatabaseViews: vi.fn(), listNotesDataSourceTemplates: vi.fn(async () => []),
}));
vi.mock("./notes-editor-component-registry", async () => {
  const { default: component } = await import("./NotesDatabaseViewSessionHarness.svelte");
  return {
    readNotesDatabaseView: () => ({ kind: "table", component }),
    loadNotesDatabaseView: async () => ({ kind: "table", component }),
    retryNotesDatabaseView: async () => ({ kind: "table", component }),
  };
});

function views(): NotesDatabaseView[] {
  return ["First", "Second"].map((name) => ({
    object: "view", id: name, parent: { type: "database_id", database_id: "database" },
    data_source_id: "source", name, type: "table", filter: {}, sorts: [], url: null,
    configuration: { type: "table", table: {
      property_order: [], hidden_property_ids: [], column_widths: {}, row_open_mode: "full_page",
    } },
    created_time: "2026-09-29T00:00:00Z", last_edited_time: "2026-09-29T00:00:00Z",
    source_provider: null, source_object_id: null, source_workspace_id: null, source_last_edited_time: null,
  }));
}

let component: ReturnType<typeof mount> | undefined;
afterEach(async () => {
  if (component) await unmount(component);
  component = undefined;
  notesDatabaseSession.clear();
  document.body.replaceChildren();
  vi.resetAllMocks();
});

function open(): void {
  component = mount(NotesDatabaseViewSurface, { target: document.body, props: {
    dataSourceId: "source", databaseId: "database", initialViewId: "First",
    reloadKeys: { table: 0, board: 0, gallery: 0, list: 0, calendar: 0, timeline: 0 },
    onSelectPage: vi.fn(), onEditProperties: vi.fn(), onCreateLinkedDatabaseView: vi.fn(), onAddProperty: vi.fn(),
  } });
}

function chooseSecond(): void {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((candidate) => candidate.textContent?.trim() === "Second");
  expect(button).toBeDefined();
  button!.click();
}

describe("Notes database view sessions", () => {
  it("restores the chosen saved view immediately without refetching metadata", async () => {
    vi.mocked(listNotesDatabaseViews).mockResolvedValue(views());
    vi.mocked(listNotesDataSourceTemplates).mockResolvedValue([]);
    open();
    await vi.waitFor(() => expect(document.querySelector("[data-session-view]")?.getAttribute("data-session-view")).toBe("First"));
    chooseSecond();
    await tick();
    await unmount(component!);
    component = undefined;
    document.body.replaceChildren();
    open();
    await tick();
    expect(document.querySelector("[data-session-view]")?.getAttribute("data-session-view")).toBe("Second");
    expect(listNotesDatabaseViews).toHaveBeenCalledOnce();
    expect(listNotesDataSourceTemplates).toHaveBeenCalledOnce();
  });

  it("does not undo a view selection made while a metadata refresh is pending", async () => {
    notesDatabaseSession.write(databaseResource("views", "source", { databaseId: "database" }), views());
    notesDatabaseSession.write(databaseResource("templates", "source"), []);
    open();
    await tick();
    let finish: (value: NotesDatabaseView[]) => void = () => {};
    vi.mocked(listNotesDatabaseViews).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    vi.mocked(listNotesDataSourceTemplates).mockResolvedValue([]);
    notesDatabaseSession.invalidate();
    await vi.waitFor(() => expect(listNotesDatabaseViews).toHaveBeenCalledOnce());
    chooseSecond();
    await tick();
    finish(views());
    await tick();
    await tick();
    expect(document.querySelector("[data-session-view]")?.getAttribute("data-session-view")).toBe("Second");
  });
});
