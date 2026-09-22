// @vitest-environment jsdom

import { mount, tick, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { activateModalFocus } from "$lib/modal-focus";
import CustomSelect from "./CustomSelect.svelte";

describe("CustomSelect floating interaction", () => {
  let root: HTMLDivElement;
  let component: ReturnType<typeof mount> | undefined;

  afterEach(async () => {
    if (component) await unmount(component);
    root?.remove();
    component = undefined;
  });

  /** Create a dialog with a scrollable form and an explicit floating root. */
  function createHost(): HTMLFormElement {
    root = document.createElement("div");
    root.dataset.floatingRoot = "";
    root.setAttribute("role", "dialog");
    const form = document.createElement("form");
    root.append(form);
    document.body.append(root);
    return form;
  }

  it("keeps menus outside the form flow but inside the dialog and consumes Escape", async () => {
    const form = createHost();
    const onChange = vi.fn();
    const parentKeydown = vi.fn();
    root.addEventListener("keydown", parentKeydown);
    component = mount(CustomSelect, {
      target: form,
      props: {
        inline: true, ariaLabel: "Status", value: "todo", onChange,
        options: [{ value: "todo", label: "To do" }, { value: "done", label: "Done" }],
      },
    });
    const trigger = form.querySelector<HTMLButtonElement>("button");
    trigger?.click();
    await tick();
    const menu = root.querySelector('[role="listbox"]');
    expect(menu?.parentElement).toBe(root);
    expect(form.querySelector('[role="listbox"]')).toBeNull();
    await vi.waitFor(() => expect(document.activeElement).toBe(menu?.querySelector('[aria-selected="true"]')));

    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(menu?.querySelector('[aria-selected="false"]'));
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await tick();
    expect(root.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(parentKeydown).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("filters in the menu and selects the matching option with Enter", async () => {
    const form = createHost();
    const onChange = vi.fn();
    component = mount(CustomSelect, {
      target: form,
      props: {
        inline: true, ariaLabel: "Parent task", value: "", onChange,
        triggerLabel: "Choose a task", searchPlaceholder: "Search tasks", emptyLabel: "No tasks",
        options: [{ value: "one", label: "Write notes" }, { value: "two", label: "Review design" }],
      },
    });
    form.querySelector<HTMLButtonElement>("button")?.click();
    await tick();
    const search = root.querySelector<HTMLInputElement>('[aria-label="Search tasks"]');
    if (!search) throw new Error("Missing menu search field");
    await vi.waitFor(() => expect(document.activeElement).toBe(search));
    search.value = "design";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();
    const options = root.querySelectorAll('[role="option"]');
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toContain("Review design");
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await tick();
    expect(onChange).toHaveBeenCalledWith("two");
    expect(root.querySelector('[role="listbox"]')).toBeNull();
  });

  it("forwards searches to the caller before filtering bounded result sets", async () => {
    const form = createHost();
    const onSearchChange = vi.fn();
    component = mount(CustomSelect, {
      target: form,
      props: {
        inline: true, value: "", onChange: vi.fn(), ariaLabel: "Tags",
        searchPlaceholder: "Find a tag", onSearchChange,
        options: [{ value: "cached", label: "Initial result" }],
      },
    });
    form.querySelector<HTMLButtonElement>("button")?.click();
    await tick();
    const search = root.querySelector<HTMLInputElement>("input");
    if (!search) throw new Error("Missing search field");
    search.value = "another tag";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();
    expect(onSearchChange).toHaveBeenCalledWith("another tag");
    expect(root.querySelectorAll('[role="option"]')).toHaveLength(1);
  });
  it("closes on Tab before the surrounding modal computes its focus boundary", async () => {
    const form = createHost();
    component = mount(CustomSelect, {
      target: form,
      props: { inline: true, value: "todo", onChange: vi.fn(), options: [{ value: "todo", label: "To do" }] },
    });
    const releaseFocus = activateModalFocus(root);
    try {
      const trigger = form.querySelector<HTMLButtonElement>("button");
      trigger?.click();
      await vi.waitFor(() => expect(document.activeElement?.getAttribute("role")).toBe("option"));
      const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
      document.activeElement?.dispatchEvent(tab);
      expect(root.querySelector('[role="listbox"]')).toBeNull();
      expect(document.activeElement).toBe(trigger);
      expect(tab.defaultPrevented).toBe(true);
    } finally {
      releaseFocus();
    }
  });

});
