// @vitest-environment jsdom

import { mount, tick, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectCustomField } from "$lib/projects/types";
import ProjectListPropertyMenuHarness from "./ProjectListPropertyMenuHarness.test.svelte";

const store = vi.hoisted(() => ({updateCustomField: vi.fn<(field: ProjectCustomField, update: {name: string}) => Promise<void>>() }));
vi.mock("$lib/stores/projects.svelte", () => ({getProjects: () => ({customFieldOptionsForField: () => [], updateCustomField: store.updateCustomField})}));

let component: ReturnType<typeof mount> | undefined;
const initialField: ProjectCustomField = {id: "points", projectId: "project", name: "Points", fieldType: "number", sortOrder: 100, createdAt: "", updatedAt: ""};

afterEach(async () => {
  if (component) await unmount(component);
  component = undefined;
  document.body.replaceChildren();
  vi.resetAllMocks();
});

/** Resolve a labelled control in its actual floating owner. */
function button(label: string, owner: ParentNode = document): HTMLButtonElement {
  const result = Array.from(owner.querySelectorAll<HTMLButtonElement>("button")).find((entry) => entry.getAttribute("aria-label") === label || entry.textContent?.trim() === label);
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}

/** Open the actual property detail panel after its initial focus settles. */
async function openName(label: string): Promise<HTMLInputElement> {
  button(label).click();
  await vi.waitFor(() => {
    const panel = document.querySelector(`[data-app-floating-surface][aria-label="${label}"]`);
    expect(panel).not.toBeNull();
    expect(document.activeElement).toBe(panel?.querySelector("button:not(:disabled)"));
  });
  button("Edit property").click();
  await vi.waitFor(() => {
    const input = document.querySelector<HTMLInputElement>('[aria-label="Property name"]');
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
  });
  return document.querySelector<HTMLInputElement>('[aria-label="Property name"]')!;
}

describe("Projects property-name drafts", () => {
  it("refreshes a pristine closed draft after a canonical rename and preserves an active edit", async () => {
    const instance = mount(ProjectListPropertyMenuHarness, {target: document.body, props: {initialField}});
    component = instance;
    await tick();
    instance.setField({...initialField, name: "Renamed"});
    await tick();
    const input = await openName("Renamed");
    expect(input.value).toBe("Renamed");
    input.value = "Local correction";
    input.dispatchEvent(new Event("input", {bubbles: true}));
    await tick();
    instance.setField({...initialField, name: "Another canonical name"});
    await tick();
    expect(input.value).toBe("Local correction");
  });

  it("retains a rejected draft across canonical updates and resets when the actual property changes", async () => {
    store.updateCustomField.mockRejectedValueOnce(new Error("Disk full"));
    const instance = mount(ProjectListPropertyMenuHarness, {target: document.body, props: {initialField}});
    component = instance;
    await tick();
    const input = await openName("Points");
    input.value = "Unsaved correction";
    input.dispatchEvent(new Event("input", {bubbles: true}));
    await tick();
    input.form?.dispatchEvent(new Event("submit", {bubbles: true, cancelable: true}));
    await vi.waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toContain("Disk full"));
    instance.setField({...initialField, name: "Renamed elsewhere"});
    await tick();
    expect(input.value).toBe("Unsaved correction");
    instance.setField({...initialField, id: "budget", name: "Budget"});
    await tick();
    expect(input.value).toBe("Budget");
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });
});
