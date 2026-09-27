// @vitest-environment jsdom

import { mount, tick, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import NotesCheckboxField from "./NotesCheckboxField.svelte";

describe("Notes checkbox field", () => {
  let target: HTMLDivElement | undefined;
  let component: ReturnType<typeof mount> | undefined;

  afterEach(async () => {
    if (component) await unmount(component);
    target?.remove();
    component = undefined;
    target = undefined;
  });

  it.each([
    { checked: false, clickTarget: "square" },
    { checked: false, clickTarget: "text" },
    { checked: true, clickTarget: "square" },
    { checked: true, clickTarget: "text" },
  ] as const)("toggles once from the $clickTarget when checked is $checked", async ({ checked, clickTarget }) => {
    target = document.createElement("div");
    document.body.append(target);
    const onChange = vi.fn();
    component = mount(NotesCheckboxField, {
      target,
      props: { checked, label: "Show resolved", showLabel: true, onChange },
    });
    await tick();

    const button = target.querySelector<HTMLButtonElement>('[role="checkbox"]');
    const spans = button?.querySelectorAll("span");
    expect(button).not.toBeNull();
    expect(spans).toHaveLength(2);
    spans?.item(clickTarget === "square" ? 0 : 1).click();

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith(!checked);
  });
});
