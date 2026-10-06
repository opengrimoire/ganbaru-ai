// @vitest-environment jsdom
import { flushSync, mount, tick, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import CollectionPropertyCreator from "./CollectionPropertyCreator.svelte";
import type { CollectionPropertyTypeOption } from "./property-icons";

type Type = "text" | "number" | "relation";
const TYPES: CollectionPropertyTypeOption<Type>[] = [
  { value: "text", label: "Text", kind: "text", section: "basic" },
  { value: "number", label: "Number", kind: "number", section: "basic" },
  { value: "relation", label: "Relation", kind: "relation", section: "advanced" },
];

let component: ReturnType<typeof mount> | undefined;
afterEach(async () => {
  if (component) await unmount(component);
  component = undefined;
  document.body.replaceChildren();
});

/** Mount the creator with a spy for the chosen type and name. */
function render(props: { name?: string; pending?: boolean } = {}) {
  const onCreate = vi.fn<(type: Type, name: string) => void>();
  component = mount(CollectionPropertyCreator<Type>, { target: document.body, props: { types: TYPES, onCreate, ...props } });
  flushSync();
  return { onCreate };
}

/** Type into an input the way a person would, so bound state updates. */
function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  flushSync();
}

/** Press a key in an input and report whether the creator consumed it. */
function press(input: HTMLInputElement, key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  input.dispatchEvent(event);
  return event;
}

function nameInput(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>('input[aria-label="Property name"]')!;
}

function typeButtons(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>("[data-property-type]")];
}

describe("Collection property creator", () => {
  it("creates the clicked type with the typed name, leaving blank names to the owner", () => {
    const { onCreate } = render();
    document.querySelector<HTMLButtonElement>('[data-property-type="number"]')!.click();
    expect(onCreate).toHaveBeenLastCalledWith("number", "");
    type(nameInput(), "Budget");
    document.querySelector<HTMLButtonElement>('[data-property-type="relation"]')!.click();
    expect(onCreate).toHaveBeenLastCalledWith("relation", "Budget");
  });

  it("separates sections with a divider", () => {
    render();
    const grids = document.querySelectorAll(".grid-cols-2");
    expect([...grids].map((grid) => [...grid.querySelectorAll("[data-property-type]")].map((button) => button.getAttribute("data-property-type"))))
      .toEqual([["text", "number"], ["relation"]]);
    expect(document.querySelectorAll(".border-t")).toHaveLength(1);
  });

  it("creates the first type when Enter is pressed in the name field", () => {
    const { onCreate } = render();
    type(nameInput(), "Notes");
    expect(press(nameInput(), "Enter").defaultPrevented).toBe(true);
    expect(onCreate).toHaveBeenCalledExactlyOnceWith("text", "Notes");
    expect(press(nameInput(), "a").defaultPrevented).toBe(false);
    expect(onCreate).toHaveBeenCalledOnce();
  });

  it("searches types and creates the first match on Enter", async () => {
    const { onCreate } = render();
    type(nameInput(), "Linked");
    document.querySelector<HTMLButtonElement>('button[aria-label="Search types"]')!.click();
    await vi.waitFor(() => expect(document.activeElement).toBe(document.querySelector('input[aria-label="Search types"]')));
    const search = document.querySelector<HTMLInputElement>('input[aria-label="Search types"]')!;
    type(search, "REL");
    expect(typeButtons().map((button) => button.dataset.propertyType)).toEqual(["relation"]);
    press(search, "Enter");
    expect(onCreate).toHaveBeenCalledExactlyOnceWith("relation", "Linked");
  });

  it("says when no type matches and creates nothing on Enter", async () => {
    const { onCreate } = render();
    document.querySelector<HTMLButtonElement>('button[aria-label="Search types"]')!.click();
    await tick();
    const search = document.querySelector<HTMLInputElement>('input[aria-label="Search types"]')!;
    type(search, "missing");
    expect(typeButtons()).toEqual([]);
    expect(document.body.textContent).toContain("No matching types");
    press(search, "Enter");
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("keeps the search toggle from counting as a menu action", () => {
    render();
    expect(document.querySelector('button[aria-label="Search types"]')?.hasAttribute("data-collection-menu-keep-open")).toBe(true);
  });

  it("starts from an owner's retained draft", () => {
    const { onCreate } = render({ name: "Unsaved estimate" });
    expect(nameInput().value).toBe("Unsaved estimate");
    press(nameInput(), "Enter");
    expect(onCreate).toHaveBeenCalledExactlyOnceWith("text", "Unsaved estimate");
  });

  it("disables naming and creation while a creation is pending", () => {
    const { onCreate } = render({ pending: true });
    expect(nameInput().disabled).toBe(true);
    expect(typeButtons().every((button) => button.disabled)).toBe(true);
    press(nameInput(), "Enter");
    expect(onCreate).not.toHaveBeenCalled();
  });
});
