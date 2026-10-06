// @vitest-environment jsdom
import { tick } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { moveProjectTaskListColumnResize, startProjectTaskListColumnResize, type ProjectTaskListColumnWidths } from "$lib/projects/list/view";
import {
  PROJECT_LIST_SCROLL_CLASS,
  PROJECT_LIST_STICKY_ROW_CLASS,
  ProjectListViewportController,
  projectListStickyRow,
  setProjectListStickyRowsOffset,
} from "./viewport-controller.svelte";

/** Start a real resize gesture with a measured name column. */
function drag(controller: ProjectListViewportController, delta: number): void {
  controller.resizeGesture = moveProjectTaskListColumnResize(startProjectTaskListColumnResize({
    column: "name", pointerId: 1, startClientX: 100, startWidthRem: 24,
    rootFontSizePx: 16, widthsAtStart: controller.effectiveColumnWidths,
  }), 100 + delta);
}

/** Supply only the pointer identity read by the release handler. */
function release(): PointerEvent {
  const event = new MouseEvent("pointerup");
  Object.defineProperty(event, "pointerId", { value: 1 });
  return event as PointerEvent;
}

describe("Project column resize persistence", () => {
  it("keeps the released width visible until saved props arrive", async () => {
    let widths: ProjectTaskListColumnWidths = { name: 24 };
    let complete: () => void = () => {};
    const controller = new ProjectListViewportController({
      getColumnWidths: () => widths,
      getGridInput: (columnWidths) => ({ columns: [], columnWidths }),
      persistColumnWidths: (next) => new Promise<void>((resolve) => {
        complete = () => { widths = next; resolve(); };
      }),
    });
    drag(controller, 64);
    controller.finishResize(release(), true);
    await tick();
    expect(widths.name).toBe(24);
    expect(controller.effectiveColumnWidths.name).toBe(28);
    complete();
    await tick();
    await tick();
    expect(controller.effectiveColumnWidths.name).toBe(28);
    widths = { name: 30 };
    await vi.waitFor(() => expect(controller.effectiveColumnWidths.name).toBe(30));
  });

  it("restores saved widths on cancellation or failed persistence", async () => {
    const persist = vi.fn().mockRejectedValue(new Error("Width save failed"));
    const controller = new ProjectListViewportController({
      getColumnWidths: () => ({ name: 24 }),
      getGridInput: () => ({ columns: [] }),
      persistColumnWidths: persist,
    });
    drag(controller, 64);
    controller.finishResize(release(), false);
    expect(controller.effectiveColumnWidths.name).toBe(24);
    expect(persist).not.toHaveBeenCalled();
    drag(controller, 64);
    controller.finishResize(release(), true);
    expect(controller.effectiveColumnWidths.name).toBe(28);
    await tick();
    await tick();
    await vi.waitFor(() => expect(controller.effectiveColumnWidths.name).toBe(24));
    expect(controller.resizeError).toBe("Width save failed");
  });

  it("does not drop a newer preview when an earlier save finishes", async () => {
    const saves: Array<() => void> = [];
    let widths: ProjectTaskListColumnWidths = { name: 24 };
    const controller = new ProjectListViewportController({
      getColumnWidths: () => widths,
      getGridInput: () => ({ columns: [] }),
      persistColumnWidths: (next) => new Promise<void>((resolve) => {
        saves.push(() => { widths = next; resolve(); });
      }),
    });
    drag(controller, 64);
    controller.finishResize(release(), true);
    drag(controller, 128);
    controller.finishResize(release(), true);
    saves[0]();
    await tick();
    await tick();
    expect(controller.effectiveColumnWidths.name).toBe(32);
    saves[1]();
    await tick();
    await tick();
    expect(controller.effectiveColumnWidths.name).toBe(32);
  });
});

function listWithRows(count: number): { container: HTMLDivElement; rows: HTMLDivElement[]; cell: HTMLDivElement } {
  const container = document.createElement("div");
  container.className = PROJECT_LIST_SCROLL_CLASS;
  const rows = Array.from({ length: count }, () => {
    const row = document.createElement("div");
    row.className = PROJECT_LIST_STICKY_ROW_CLASS;
    container.append(row);
    return row;
  });
  const cell = document.createElement("div");
  container.append(cell);
  document.body.append(container);
  return { container, rows, cell };
}

describe("Projects list sticky rows", () => {
  afterEach(() => document.body.replaceChildren());

  it("writes the offset on sticky rows without touching the container or other rows", () => {
    const { container, rows, cell } = listWithRows(2);

    setProjectListStickyRowsOffset(container, 120);

    for (const row of rows) {
      expect(row.style.getPropertyValue("--project-list-scroll-left")).toBe("120px");
      expect(row.style.getPropertyValue("--project-list-scroll-left-negative")).toBe("-120px");
    }
    expect(container.style.getPropertyValue("--project-list-scroll-left")).toBe("");
    expect(cell.style.getPropertyValue("--project-list-scroll-left")).toBe("");
  });

  it("starts a row mounted after scrolling at the current offset", () => {
    const { container } = listWithRows(1);
    setProjectListStickyRowsOffset(container, 64);
    const added = document.createElement("div");
    container.append(added);

    projectListStickyRow(added);

    expect(added.style.getPropertyValue("--project-list-scroll-left")).toBe("64px");
    expect(added.style.getPropertyValue("--project-list-scroll-left-negative")).toBe("-64px");
  });

  it("leaves a row outside a scrolled list at the stylesheet default", () => {
    const { container } = listWithRows(1);
    const added = document.createElement("div");
    container.append(added);
    projectListStickyRow(added);

    const detached = document.createElement("div");
    document.body.append(detached);
    projectListStickyRow(detached);

    expect(added.style.getPropertyValue("--project-list-scroll-left")).toBe("");
    expect(detached.style.getPropertyValue("--project-list-scroll-left")).toBe("");
  });
});
