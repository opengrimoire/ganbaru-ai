import { describe, expect, it } from "vitest";
import { notesDatabaseCollapsedRows, notesDatabaseHierarchyRows, parseNotesDatabaseRowHierarchy, type NotesDatabaseRowHierarchy } from "./database-row-hierarchy";

function hierarchy(ancestors: Record<string, string[]>): NotesDatabaseRowHierarchy {
  return Object.fromEntries(Object.entries(ancestors).map(([id, parents]) => [id, {
    parent_row_page_id: parents[0] ?? null, ancestor_row_page_ids: parents, depth: parents.length, child_count: 0,
  }]));
}

describe("database row hierarchy", () => {
  it("orders loaded children below their closest ancestor while preserving sibling sort order", () => {
    const rows = ["child-b", "other", "grandchild", "parent", "child-a"].map((id) => ({ id }));
    const metadata = hierarchy({ "child-b": ["parent"], grandchild: ["unloaded", "parent"], "child-a": ["parent"] });
    expect(notesDatabaseHierarchyRows(rows, metadata, []).map((row) => row.id)).toEqual(["other", "parent", "child-b", "grandchild", "child-a"]);
    expect(notesDatabaseHierarchyRows(rows, metadata, ["parent"]).map((row) => row.id)).toEqual(["other", "parent"]);
    expect(notesDatabaseHierarchyRows(rows, metadata, ["unloaded"]).map((row) => row.id)).toEqual(["other", "parent", "child-b", "child-a"]);
  });

  it("retains filtered descendants and validates exact ancestry rather than trusting IPC depth", () => {
    const metadata = hierarchy({ child: ["missing"], root: [] });
    expect(notesDatabaseHierarchyRows([{ id: "child" }], metadata, [])).toEqual([{ id: "child" }]);
    expect(parseNotesDatabaseRowHierarchy(metadata)).toEqual(metadata);
    for (const invalid of [
      { child: { ...metadata.child, depth: -1 } },
      { child: { ...metadata.child, ancestor_row_page_ids: ["child"] } },
      { child: { ...metadata.child, parent_row_page_id: "other" } },
      { child: { ...metadata.child, child_count: -1 } },
    ]) expect(() => parseNotesDatabaseRowHierarchy(invalid)).toThrow("inconsistent");
    const specialKey = parseNotesDatabaseRowHierarchy(JSON.parse('{"__proto__":{"parent_row_page_id":null,"ancestor_row_page_ids":[],"depth":0,"child_count":0}}'));
    expect(Object.hasOwn(specialKey, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(specialKey)).toBe(Object.prototype);
  });

  it("permits expanding a row at the saved collapse limit and rejects additional collapse identities", () => {
    const ids = Array.from({ length: 500 }, (_, index) => `row-${index}`);
    expect(notesDatabaseCollapsedRows(ids, "new")).toEqual(ids);
    expect(notesDatabaseCollapsedRows(ids, "row-10")).toHaveLength(499);
    expect(notesDatabaseCollapsedRows([], "parent")).toEqual(["parent"]);
  });
});
