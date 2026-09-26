// @vitest-environment jsdom
import { createRawSnippet, mount, tick, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import CustomSelect from "$lib/components/settings/CustomSelect.svelte";
import NotesDatabaseMenu from "./NotesDatabaseMenu.svelte";

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

/** Create a clipped database inside a page preview's floating boundary. */
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

describe("Notes database settings panels", () => {
  it("escapes clipped content, focuses the first field and dismisses without stealing outside focus", async () => {
    const { dialog, row } = host();
    const children = createRawSnippet(() => ({ render: () => '<div><input aria-label="Filter value" /></div>' }));
    component = mount(NotesDatabaseMenu, { target: row, props: { label: "Filter", kind: "filter", children } });
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
    component = mount(NotesDatabaseMenu, { target: row, props: { label: "Layout", children } });
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

  it("runs an action before dismissing and removes the floating panel when unmounted", async () => {
    const { dialog, row } = host();
    const action = vi.fn();
    const children = createRawSnippet(() => ({
      render: () => '<div><button type="button">Duplicate</button></div>',
      setup: (element) => { element.querySelector("button")?.addEventListener("click", action); },
    }));
    component = mount(NotesDatabaseMenu, { target: row, props: { label: "Actions", kind: "actions", children } });
    const trigger = await open(row);
    dialog.querySelector<HTMLButtonElement>("[data-database-menu-body] button")?.click();
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
});
