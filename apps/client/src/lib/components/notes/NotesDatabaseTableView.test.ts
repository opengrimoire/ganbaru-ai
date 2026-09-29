// @vitest-environment jsdom
import { mount, tick, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NotesDataSourceTableView } from "$lib/notes/types";
import {
  createNotesDataSourceRowPage, getNotesDataSourceTableView, listNotesDataSourceTemplates, loadNotesPage,
  updateNotesDataSourceRowProperty, updateNotesDataSourceTableView,
} from "$lib/api/notes";
import { createProvisionalNotesPage } from "$lib/notes/page-creation";
import NotesDatabaseTableView from "./NotesDatabaseTableView.svelte";

vi.mock("$lib/api/notes", () => ({
  getNotesDataSourceTableView: vi.fn(),
  listNotesDataSourceTemplates: vi.fn(async () => []),
  updateNotesDataSourceTableView: vi.fn(),
  createNotesDataSourceRowPage: vi.fn(),
  updateNotesDataSourceRowProperty: vi.fn(),
  applyNotesDataSourceTemplate: vi.fn(),
  loadNotesPage: vi.fn(),
}));

/** Minimal canonical table response with a single resizable title column. */
function table(width: number): NotesDataSourceTableView {
  const source = {
    source_provider: null, source_object_id: null, source_workspace_id: null,
    source_last_edited_time: null, created_time: "2026-09-29T00:00:00Z", last_edited_time: "2026-09-29T00:00:00Z",
  };
  return {
    data_source: {
      ...source, object: "data_source", id: "source", parent: { type: "database_id", database_id: "database" },
      database_parent: { type: "page_id", page_id: "page" }, title: "Tasks", title_rich_text: [], description: [],
      icon: null, in_trash: false, properties: { Name: { id: "title", name: "Name", type: "title", title: {} } },
    },
    view: {
      ...source, object: "view", id: "view", parent: { type: "database_id", database_id: "database" },
      data_source_id: "source", name: "Table", type: "table", filter: {}, sorts: [], url: null,
      configuration: { type: "table", table: {
        property_order: ["title"], hidden_property_ids: [], column_widths: { title: width }, row_open_mode: "full_page",
      } },
    },
    rows: [], total_row_count: 0, has_more: false, next_cursor: null,
  };
}

let component: ReturnType<typeof mount> | undefined;
afterEach(async () => {
  if (component) await unmount(component);
  component = undefined;
  document.body.replaceChildren();
  vi.resetAllMocks();
});

/** Dispatch pointer coordinates using jsdom's mouse event implementation. */
function pointer(target: EventTarget, type: string, x: number): void {
  const event = new MouseEvent(type, { clientX: x, button: 0, bubbles: true, cancelable: true });
  Object.defineProperty(event, "pointerId", { value: 1 });
  target.dispatchEvent(event);
}

async function open(onSavingChange = vi.fn<(saving: boolean) => void>()) {
  vi.mocked(getNotesDataSourceTableView).mockResolvedValue(table(240));
  vi.mocked(listNotesDataSourceTemplates).mockResolvedValue([]);
  vi.mocked(loadNotesPage).mockRejectedValue(new Error("Page not found"));
  component = mount(NotesDatabaseTableView, { target: document.body, props: {
    dataSourceId: "source", onSavingChange, onSelectPage: vi.fn(), onAddProperty: vi.fn(), onEditProperties: vi.fn(), onCloseSettings: vi.fn(),
  } });
  await tick();
  await tick();
  await vi.waitFor(() => expect(document.querySelector(".collection-resize")).not.toBeNull());
  const handle = document.querySelector<HTMLButtonElement>(".collection-resize")!;
  handle.setPointerCapture = vi.fn();
  const row = document.querySelector<HTMLElement>('[role="row"]')!;
  return { handle, onSavingChange, width: () => row.style.getPropertyValue("--collection-columns") };
}

describe("Notes table width handoff", () => {
  it("keeps the drag width through a delayed save and accepts its canonical response", async () => {
    let complete: (view: NotesDataSourceTableView) => void = () => {};
    vi.mocked(updateNotesDataSourceTableView).mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    const { handle, onSavingChange, width } = await open();
    pointer(handle, "pointerdown", 100);
    pointer(window, "pointermove", 180);
    await tick();
    expect(width()).toContain("320px");
    pointer(window, "pointerup", 180);
    await tick();
    expect(width()).toContain("320px");
    expect(updateNotesDataSourceTableView).toHaveBeenCalledTimes(1);
    expect(onSavingChange).toHaveBeenLastCalledWith(true);
    expect(document.body.textContent).not.toContain("Saving table");
    complete(table(316));
    await vi.waitFor(() => {
      expect(width()).toContain("316px");
      expect(onSavingChange).toHaveBeenLastCalledWith(false);
    });
  });

  it("restores the saved width after cancellation or a rejected keyboard resize", async () => {
    vi.mocked(updateNotesDataSourceTableView).mockRejectedValue(new Error("Cannot save width"));
    const { handle, width } = await open();
    pointer(handle, "pointerdown", 100);
    pointer(window, "pointermove", 180);
    pointer(window, "pointercancel", 180);
    await tick();
    expect(width()).toContain("240px");
    expect(updateNotesDataSourceTableView).not.toHaveBeenCalled();
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await tick();
    await tick();
    expect(width()).toContain("240px");
    await vi.waitFor(() => {
      expect(width()).toContain("240px");
      expect(document.querySelector('[role="alert"]')?.textContent).toContain("Cannot save width");
    });
  });
});

/** Canonical creation response for the row reserved by the table. */
function created(request: { id: string; first_block_id: string; title: string }) {
  return createProvisionalNotesPage({ ...request,
    parent: { type: "data_source_id", data_source_id: "source" }, folder_id: null });
}

function newPage(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>("[data-database-new-row] button")!;
}

function titleInput(index = 0): HTMLInputElement {
  return document.querySelectorAll<HTMLInputElement>('[data-table-cell="true"]')[index]!;
}

function typeTitle(input: HTMLInputElement, title: string): void {
  input.value = title;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("immediate Notes table creation", () => {
  it("reserves editable blank rows before creation completes and keeps New page available", async () => {
    vi.mocked(createNotesDataSourceRowPage).mockImplementation(() => new Promise(() => {}));
    await open();
    const originalAddButton = newPage();
    const originalAddRow = originalAddButton.closest(".collection-row");
    originalAddButton.click();
    await tick();
    expect(originalAddButton.isConnected).toBe(false);
    expect(originalAddRow?.isConnected).toBe(false);
    expect(newPage()).not.toBe(originalAddButton);
    expect(titleInput().value).toBe("");
    expect(titleInput().disabled).toBe(false);
    expect(document.activeElement).toBe(titleInput());
    expect(newPage().disabled).toBe(false);
    expect(document.querySelector("form")).toBeNull();
    newPage().click();
    await tick();
    expect(document.querySelectorAll('[data-database-row-id]')).toHaveLength(2);
    expect(createNotesDataSourceRowPage).toHaveBeenCalledTimes(2);
    const requests = vi.mocked(createNotesDataSourceRowPage).mock.calls.map(([, request]) => request);
    expect(requests.every((request) => request.title === "")).toBe(true);
    expect(requests[0].id).not.toBe(requests[1].id);
    expect(getNotesDataSourceTableView).toHaveBeenCalledTimes(1);
  });

  it("keeps typing through creation and saves Enter on the last row without a draft-row flash", async () => {
    let finish: () => void = () => {};
    vi.mocked(createNotesDataSourceRowPage).mockImplementation((_source, request) => new Promise((resolve) => {
      finish = () => resolve(created(request));
    }));
    vi.mocked(updateNotesDataSourceRowProperty).mockImplementation(async (_source, id, update) => {
      const page = created({ id, first_block_id: "block", title: String(update.value) }).page;
      vi.mocked(getNotesDataSourceTableView).mockResolvedValue({ ...table(240), rows: [page], total_row_count: 1 });
      return page;
    });
    await open();
    newPage().click();
    await tick();
    const input = titleInput();
    const nextAddButton = newPage();
    typeTitle(input, "My new row");
    await tick();
    finish();
    await tick();
    await tick();
    expect(titleInput()).toBe(input);
    expect(input.value).toBe("My new row");
    expect(document.activeElement).toBe(input);
    expect(updateNotesDataSourceRowProperty).not.toHaveBeenCalled();
    expect(getNotesDataSourceTableView).toHaveBeenCalledTimes(1);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(updateNotesDataSourceRowProperty).toHaveBeenCalledWith("source", expect.any(String), {
      property_id: "title", value: "My new row",
    }));
    expect(document.querySelectorAll('[data-database-row-id]')).toHaveLength(1);
    expect(newPage()).not.toBeNull();
    await vi.waitFor(() => {
      expect(getNotesDataSourceTableView).toHaveBeenCalledTimes(2);
      expect(newPage().disabled).toBe(false);
    });
    expect(newPage()).toBe(nextAddButton);
    expect(document.activeElement).toBe(nextAddButton);
    expect(listNotesDataSourceTemplates).toHaveBeenCalledTimes(1);
  });

  it("queues a title submitted before creation finishes and retains it through failure and retry", async () => {
    let reject: (error: Error) => void = () => {};
    vi.mocked(createNotesDataSourceRowPage).mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    vi.mocked(createNotesDataSourceRowPage).mockImplementation(async (_source, request) => created(request));
    vi.mocked(updateNotesDataSourceRowProperty).mockImplementation(async (_source, id, update) => {
      const page = created({ id, first_block_id: "block", title: String(update.value) }).page;
      vi.mocked(getNotesDataSourceTableView).mockResolvedValue({ ...table(240), rows: [page], total_row_count: 1 });
      return page;
    });
    await open();
    newPage().click();
    await tick();
    const input = titleInput();
    typeTitle(input, "Keep this title");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(updateNotesDataSourceRowProperty).not.toHaveBeenCalled();
    reject(new Error("Create failed"));
    await vi.waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toContain("Create failed"));
    expect(titleInput().value).toBe("Keep this title");
    document.querySelector<HTMLButtonElement>('[role="alert"] button')!.click();
    await vi.waitFor(() => expect(updateNotesDataSourceRowProperty).toHaveBeenCalledWith("source", expect.any(String), {
      property_id: "title", value: "Keep this title",
    }));
    const calls = vi.mocked(createNotesDataSourceRowPage).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][1]).toEqual(calls[1][1]);
    expect(document.querySelectorAll('[data-database-row-id]')).toHaveLength(1);
  });
});
