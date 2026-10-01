// @vitest-environment jsdom
import { createRawSnippet, mount, tick, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import CustomSelect from "$lib/components/settings/CustomSelect.svelte";
import CollectionMenu from "$lib/components/collections/CollectionMenu.svelte";

let component: ReturnType<typeof mount> | undefined;
let nested: ReturnType<typeof mount> | undefined;

afterEach(async () => {
  if (nested) await unmount(nested);
  if (component) await unmount(component);
  component = undefined;
  nested = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/** Create a clipped collection inside a page preview's floating boundary. */
function host() {
  const dialog = document.createElement("div");
  dialog.dataset.floatingRoot = "";
  const row = document.createElement("div");
  row.style.overflow = "hidden";
  dialog.append(row);
  document.body.append(dialog);
  return { dialog, row };
}

/** Wait for the panel to position itself and focus its first field. */
async function open(row: HTMLElement): Promise<HTMLButtonElement> {
  const trigger = row.querySelector<HTMLButtonElement>("button")!;
  trigger.click();
  await tick();
  await tick();
  return trigger;
}

describe("Shared collection menus", () => {
  it("escapes clipped content, focuses the first field and dismisses without stealing outside focus", async () => {
    const { dialog, row } = host();
    const children = createRawSnippet(() => ({ render: () => '<div><input aria-label="Filter value" /></div>' }));
    component = mount(CollectionMenu, { target: row, props: { label: "Filter", kind: "filter", children } });
    const trigger = await open(row);
    const panel = dialog.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(panel.parentElement).toBe(dialog);
    expect(row.querySelector('[role="dialog"]')).toBeNull();
    expect(panel.style.position).toBe("fixed");
    expect(document.activeElement).toBe(panel.querySelector("input"));

    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await tick();
    expect(dialog.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    await open(row);
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    await tick();
    expect(dialog.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(outside);
  });

  it("keeps nested dropdown selection inside the panel and consumes Escape one level at a time", async () => {
    const { dialog, row } = host();
    const onChange = vi.fn();
    const children = createRawSnippet(() => ({
      render: () => "<div></div>",
      setup: (element) => {
        nested = mount(CustomSelect, { target: element, props: {
          inline: true, value: "todo", ariaLabel: "Status", onChange,
          options: [{ value: "todo", label: "To do" }, { value: "done", label: "Done" }],
        } });
      },
    }));
    component = mount(CollectionMenu, { target: row, props: { label: "Layout", children } });
    const trigger = await open(row);
    const panel = dialog.querySelector<HTMLElement>('[role="dialog"]')!;
    const select = panel.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')!;
    select.click();
    await vi.waitFor(() => expect(document.activeElement?.getAttribute("role")).toBe("option"));
    const listbox = panel.querySelector('[role="listbox"]')!;
    expect(listbox.parentElement).toBe(panel);
    const escape = () => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    escape();
    await tick();
    expect(panel.isConnected).toBe(true);
    expect(panel.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(select);

    select.click();
    await vi.waitFor(() => expect(document.activeElement?.getAttribute("role")).toBe("option"));
    panel.querySelector<HTMLButtonElement>('[role="option"][aria-selected="false"]')?.click();
    await tick();
    expect(onChange).toHaveBeenCalledWith("done");
    expect(panel.isConnected).toBe(true);
    escape();
    await tick();
    expect(panel.isConnected).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("commits a scalar field before outside background dismissal without stealing focus", async () => {
    const { dialog, row } = host();
    const commit = vi.fn();
    const connectedAtCommit: boolean[] = [];
    const children = createRawSnippet(() => ({
      render: () => '<div><input aria-label="Filter value" /></div>',
      setup: (element) => {
        const input = element.querySelector<HTMLInputElement>("input")!;
        input.addEventListener("blur", () => {
          connectedAtCommit.push(input.isConnected);
          commit(input.value);
        });
      },
    }));
    component = mount(CollectionMenu, { target: row, props: { label: "Filter", kind: "filter", children } });
    const trigger = await open(row);
    const triggerFocus = vi.spyOn(trigger, "focus");
    const panel = dialog.querySelector<HTMLElement>('[role="dialog"]')!;
    panel.querySelector<HTMLInputElement>("input")!.value = "High";
    const background = document.createElement("div");
    document.body.append(background);
    background.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    background.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(commit).toHaveBeenCalledExactlyOnceWith("High");
    expect(connectedAtCommit).toEqual([true]);
    await tick();
    expect(panel.isConnected).toBe(false);
    expect(triggerFocus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
  });

  it("handles Escape after its last focused field becomes disabled and rejects unrelated Escape", async () => {
    const { dialog, row } = host();
    const children = createRawSnippet(() => ({ render: () => '<div><fieldset><input aria-label="Filter value" /></fieldset></div>' }));
    component = mount(CollectionMenu, { target: row, props: { label: "Filter", kind: "filter", children } });
    const trigger = await open(row);
    const panel = dialog.querySelector<HTMLElement>('[role="dialog"]')!;
    const input = panel.querySelector<HTMLInputElement>("input")!;
    input.blur();
    const enabledEscape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    document.body.dispatchEvent(enabledEscape);
    await tick();
    expect(enabledEscape.defaultPrevented).toBe(false);
    expect(panel.isConnected).toBe(true);

    input.focus();
    input.blur();
    panel.querySelector<HTMLFieldSetElement>("fieldset")!.disabled = true;
    expect(input.matches(":disabled")).toBe(true);
    const unrelated = document.createElement("input");
    document.body.append(unrelated);
    const unrelatedEscape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    unrelated.dispatchEvent(unrelatedEscape);
    expect(unrelatedEscape.defaultPrevented).toBe(false);
    expect(panel.isConnected).toBe(true);

    const disabledEscape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    document.body.dispatchEvent(disabledEscape);
    await tick();
    expect(disabledEscape.defaultPrevented).toBe(true);
    expect(panel.isConnected).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("runs an action before dismissing and removes the floating panel when unmounted", async () => {
    const { dialog, row } = host();
    const action = vi.fn();
    const children = createRawSnippet(() => ({
      render: () => '<div><button type="button">Duplicate</button></div>',
      setup: (element) => { element.querySelector("button")?.addEventListener("click", action); },
    }));
    component = mount(CollectionMenu, { target: row, props: { label: "Actions", kind: "actions", children } });
    const trigger = await open(row);
    dialog.querySelector<HTMLButtonElement>("[data-collection-menu-body] button")?.click();
    await tick();
    await tick();
    expect(action).toHaveBeenCalledOnce();
    expect(dialog.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    await open(row);
    await unmount(component!);
    component = undefined;
    expect(dialog.querySelector('[role="dialog"]')).toBeNull();
  });

  it("keeps the panel open when an action reveals an inline editor", async () => {
    const { dialog, row } = host();
    const children = createRawSnippet(() => ({
      render: () => '<button type="button" data-collection-menu-keep-open>Edit title</button>',
    }));
    component = mount(CollectionMenu, { target: row, props: { label: "View options", kind: "actions", children } });
    await open(row);
    dialog.querySelector<HTMLButtonElement>("[data-collection-menu-keep-open]")?.click();
    await tick();
    expect(dialog.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("dismisses immediate property actions while keeping nested filter actions inside their owner", async () => {
    const { dialog, row } = host();
    const move = vi.fn();
    const addFilter = vi.fn();
    const filterChildren = createRawSnippet(() => ({
      render: () => '<div><button type="button">Add filter</button></div>',
      setup: (element) => { element.querySelector("button")?.addEventListener("click", addFilter); },
    }));
    const children = createRawSnippet(() => ({
      render: () => '<div><button type="button">Move right</button><div data-filter-target></div></div>',
      setup: (element) => {
        element.querySelector("button")?.addEventListener("click", move);
        nested = mount(CollectionMenu, { target: element.querySelector("[data-filter-target]")!, props: {
          label: "Filter", kind: "filter", children: filterChildren,
        } });
      },
    }));
    component = mount(CollectionMenu, { target: row, props: {
      label: "Priority", kind: "property", dismissOnAction: true, children,
    } });
    const trigger = await open(row);
    const property = dialog.querySelector<HTMLElement>('[role="dialog"][aria-label="Priority"]')!;
    property.querySelector<HTMLButtonElement>('[aria-label="Filter"]')!.click();
    await vi.waitFor(() => expect(property.querySelector('[role="dialog"][aria-label="Filter"]')).not.toBeNull());
    const filter = property.querySelector<HTMLElement>('[role="dialog"][aria-label="Filter"]')!;
    filter.querySelector<HTMLButtonElement>("[data-collection-menu-body] button")!.click();
    await tick();
    expect(addFilter).toHaveBeenCalledOnce();
    expect(filter.isConnected).toBe(true);
    expect(property.isConnected).toBe(true);
    filter.focus();
    filter.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await tick();
    expect(filter.isConnected).toBe(false);
    property.querySelector<HTMLButtonElement>("[data-collection-menu-body] button")!.click();
    await tick();
    await tick();
    expect(move).toHaveBeenCalledOnce();
    expect(property.isConnected).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("closes the New template picker after a template is chosen", async () => {
    const { dialog, row } = host();
    const applyTemplate = vi.fn();
    const children = createRawSnippet(() => ({
      render: () => '<div><button type="button">Weekly review</button></div>',
      setup: (element) => { element.querySelector("button")?.addEventListener("click", applyTemplate); },
    }));
    component = mount(CollectionMenu, { target: row, props: {
      label: "New page options", kind: "new-options", iconOnly: true, primary: true, showHeader: false,
      dismissOnAction: true, children,
    } });
    const trigger = await open(row);
    dialog.querySelector<HTMLButtonElement>("[data-collection-menu-body] button")?.click();
    await tick();
    expect(applyTemplate).toHaveBeenCalledOnce();
    expect(dialog.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
