// @vitest-environment jsdom

import { mount, tick, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLocalization } from "$lib/i18n/translator.svelte";
import type { ProjectCustomField } from "$lib/projects/types";
import { ProjectTaskQueryController } from "./project-task-query-controller.svelte";
import ProjectListTableHarness from "./ProjectListTableHarness.svelte";

vi.mock("$lib/stores/projects.svelte", () => ({ getProjects: () => ({customFieldOptionsForField: () => []}) }));
type Input = ConstructorParameters<typeof ProjectTaskQueryController>[0];
let component: ReturnType<typeof mount> | undefined;
let target: HTMLDivElement;

beforeEach(() => {
  target = document.createElement("div");
  document.body.append(target);
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(async () => {
  if (component) await unmount(component);
  component = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

/** Supply a real query controller with only its native persistence boundaries mocked. */
async function renderTable() {
  const field: ProjectCustomField = {id: "points", projectId: "project", name: "Points", fieldType: "number", sortOrder: 100, createdAt: "", updatedAt: ""};
  const savePresentation = vi.fn<Input["projects"]["saveTaskListPresentation"]>().mockResolvedValue(undefined);
  const addField = vi.fn<Input["projects"]["addCustomField"]>().mockResolvedValue({...field, id: "created", name: "Budget"});
  const saveColumns = vi.fn<Input["projects"]["saveTaskListColumns"]>().mockResolvedValue(undefined);
  const query = new ProjectTaskQueryController({projects: {
    selectedProject: {id: "project"}, activeView: "list", customFieldsForProject: () => [field], prioritiesForProject: () => [],
    saveTaskListPresentation: savePresentation, addCustomField: addField, saveTaskListColumns: saveColumns,
    projectDataLoaded: () => true, sectionsForProject: () => [],
    loadTaskView: async () => undefined, taskViewLoading: false, taskViewError: null,
    taskViewPage: { projectId: "project", view: "list", tasks: [], columnCalculations: [{column: "custom:points", total: 2500, filled: 1200, sum: 9000}] },
  } as unknown as Input["projects"], calendar: {rawBlocks: []} as unknown as Input["calendar"], translate: getLocalization().t});
  query.listColumns = ["custom:points", "due"];
  component = mount(ProjectListTableHarness, { target, props: {query} });
  await tick();
  return {query, savePresentation, addField, saveColumns};
}

/** Resolve an actual labelled control, including controls portaled into the owner. */
function button(label: string, owner: ParentNode = document): HTMLButtonElement {
  const result = Array.from(owner.querySelectorAll<HTMLButtonElement>("button")).find((entry) => entry.getAttribute("aria-label") === label || entry.textContent?.trim() === label);
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}

/** Open the property panel after its initial focus settles. */
async function openPoints(): Promise<void> {
  button("Points").click();
  await vi.waitFor(() => {
    const panel = document.querySelector('[data-app-floating-surface][aria-label="Points"]');
    expect(panel).not.toBeNull();
    expect(document.activeElement).toBe(panel?.querySelector("button:not(:disabled)"));
  });
}

describe("Projects table property configuration", () => {
  it("keeps header popovers in their owner and restores failed wrapping preferences with an explicit error", async () => {
    const {query, savePresentation} = await renderTable();
    let rejectWrite!: (error: unknown) => void;
    savePresentation.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectWrite = reject; }));
    await openPoints();
    const panel = document.querySelector('[data-app-floating-surface][aria-label="Points"]');
    expect(panel?.parentElement?.closest("[data-floating-root]")).toBe(target.firstElementChild);
    button("Wrap column content").click();
    await tick();
    expect(query.listPresentation.wrappedColumns).toEqual(["custom:points"]);
    expect(button("Points").disabled).toBe(true);
    rejectWrite(new Error("Disk full"));
    await vi.waitFor(() => expect(query.presentationSaving).toBe(false));
    expect(query.listPresentation.wrappedColumns).toEqual([]);
    expect(target.querySelector('[role="alert"]')?.textContent).toContain("Disk full");
    expect(button("Points").disabled).toBe(false);
  });

  it("retains property drafts after creation failures and inserts a retry beside the invoking column", async () => {
    const {query, addField, saveColumns} = await renderTable();
    addField.mockRejectedValueOnce(new Error("Vault unavailable"));
    await openPoints();
    const panel = document.querySelector('[data-app-floating-surface][aria-label="Points"]')!;
    button("Insert property", panel).click();
    await vi.waitFor(() => expect(document.querySelector<HTMLInputElement>('[aria-label="Property name"]')).not.toBeNull());
    const input = document.querySelector<HTMLInputElement>('[aria-label="Property name"]')!;
    input.value = "Budget";
    input.dispatchEvent(new Event("input", {bubbles: true}));
    await tick();
    input.form?.dispatchEvent(new Event("submit", {bubbles: true, cancelable: true}));
    await vi.waitFor(() => expect(query.propertySaving).toBe(false));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Vault unavailable");
    expect(input.value).toBe("Budget");
    input.form?.dispatchEvent(new Event("submit", {bubbles: true, cancelable: true}));
    await vi.waitFor(() => expect(saveColumns).toHaveBeenCalledWith("project", ["custom:points", "custom:created", "due"]));
    expect(query.propertyError).toBeNull();
  });

  it("shows complete native reductions instead of deriving totals from loaded rows", async () => {
    const {query} = await renderTable();
    query.listPresentation.calculations = {"custom:points": "sum"};
    query.loadCurrent([], null);
    await vi.waitFor(() => expect(target.textContent).toContain("Sum: 9,000"));
    query.search = "New filter";
    await tick();
    expect(target.textContent).not.toContain("Sum: 9,000");
    expect(target.textContent).toContain("Loading");
  });

  it("keeps parent column actions disabled after closing a pending property creation panel", async () => {
    const {query, addField, saveColumns} = await renderTable();
    let finishCreation!: (field: ProjectCustomField) => void;
    addField.mockImplementationOnce(() => new Promise<ProjectCustomField>((resolve) => { finishCreation = resolve; }));
    await openPoints();
    const panel = document.querySelector('[data-app-floating-surface][aria-label="Points"]')!;
    button("Insert property", panel).click();
    await vi.waitFor(() => expect(document.querySelector<HTMLInputElement>('[aria-label="Property name"]')).not.toBeNull());
    const input = document.querySelector<HTMLInputElement>('[aria-label="Property name"]')!;
    input.value = "Budget";
    input.dispatchEvent(new Event("input", {bubbles: true}));
    await tick();
    input.form?.dispatchEvent(new Event("submit", {bubbles: true, cancelable: true}));
    await vi.waitFor(() => expect(input.disabled).toBe(true));
    input.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
    await vi.waitFor(() => expect(input.isConnected).toBe(false));
    expect(panel.isConnected).toBe(true);
    expect(button("Hide column", panel).disabled).toBe(true);
    expect(button("Move column right", panel).disabled).toBe(true);
    expect(button("Wrap column content", panel).disabled).toBe(true);
    button("Hide column", panel).click();
    expect(saveColumns).not.toHaveBeenCalled();
    finishCreation({id: "created", projectId: "project", name: "Budget", fieldType: "number", sortOrder: 100, createdAt: "", updatedAt: ""});
    await vi.waitFor(() => expect(query.propertySaving).toBe(false));
    expect(saveColumns).toHaveBeenCalledExactlyOnceWith("project", ["custom:points", "custom:created", "due"]);
    expect(button("Hide column", panel).disabled).toBe(false);
  });
});
