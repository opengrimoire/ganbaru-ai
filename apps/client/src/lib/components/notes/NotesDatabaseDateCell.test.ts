// @vitest-environment jsdom
import { mount, tick, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NotesPage } from "$lib/notes/types";
import type { NotesDatabaseTableColumn } from "$lib/notes/database-table";
import type { NotesDatabaseDateValue } from "$lib/notes/database-date";
import NotesDatabaseDateCell from "./NotesDatabaseDateCell.svelte";

const date = { start: "2026-10-01T09:00:00", end: "2026-10-01T11:00:00", time_zone: "America/Monterrey" };
const row: NotesPage = {
  object: "page", id: "row", created_time: "2026-10-01T00:00:00Z", last_edited_time: "2026-10-01T00:00:00Z",
  parent: { type: "data_source_id", data_source_id: "source" }, folder_id: null, in_trash: false,
  icon: null, cover: null, properties: { When: { id: "when", type: "date", date } },
  url: null, public_url: null, source_provider: null, source_object_id: null, source_workspace_id: null, source_last_edited_time: null,
};
const column: NotesDatabaseTableColumn = { id: "when", name: "When", type: "date", hidden: false, width: 180, options: [], relationDataSourceId: null, buttonLabel: "", buttonRequiresConfirmation: false };
let component: ReturnType<typeof mount> | undefined;
afterEach(async () => { if (component) await unmount(component); component = undefined; document.body.replaceChildren(); });

/** Open the real anchored date editor and change an accessible canonical field. */
async function open(onSave: (value: NotesDatabaseDateValue | null) => Promise<boolean>): Promise<void> {
  component = mount(NotesDatabaseDateCell, { target: document.body, props: { row, column, rowIndex: 0, columnIndex: 1, mutating: false, onSave, onNavigate: vi.fn() } });
  document.querySelector<HTMLButtonElement>('button[aria-label="When"]')!.click();
  await tick(); await tick();
}
async function edit(label: string, value: string): Promise<void> {
  const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); await tick();
}
function apply(): void {
  Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find((button) => button.textContent?.trim() === "Apply date")!.click();
}

describe("Notes database date range editor", () => {
  it("updates the start while retaining the existing range and named zone", async () => {
    const onSave = vi.fn(async () => true);
    await open(onSave);
    await edit("Start", "2026-10-01T10:00:00"); apply();
    await tick(); await tick();
    expect(onSave).toHaveBeenCalledWith({ ...date, start: "2026-10-01T10:00:00" });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it("rejects reversed ranges locally and retains all edits after a failed native save", async () => {
    const onSave = vi.fn(async () => false);
    await open(onSave);
    await edit("End", "2026-09-30"); apply(); await tick();
    expect(onSave).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("end must be on or after");
    await edit("End", "2026-10-02"); apply(); await tick(); await tick();
    expect(document.querySelector<HTMLInputElement>('input[aria-label="End"]')?.value).toBe("2026-10-02");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("edits are retained");
  });
});
