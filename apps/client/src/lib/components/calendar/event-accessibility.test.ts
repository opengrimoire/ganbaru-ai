// @vitest-environment jsdom

import { mount, tick, unmount } from "svelte";
import { on } from "svelte/events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { darkTheme } from "$lib/stores/themes";
import AllDayEventChip from "./AllDayEventChip.svelte";
import EventBlock from "./EventBlock.svelte";
import type { CalendarEvent, PositionedEvent } from "./types";

const event: CalendarEvent = {
  id: "event-1", title: "Planning", calendarId: "local",
  start: "2026-09-18 10:00", end: "2026-09-18 11:00", timezone: "UTC",
};
const positioned: PositionedEvent = {
  event, startMinute: 600, durationMinutes: 60, left: 0, width: 100,
  column: 0, totalColumns: 1,
};

describe.each(["all-day", "timed"] as const)("%s event accessibility", (kind) => {
  let component: ReturnType<typeof mount> | undefined;
  let target: HTMLDivElement;

  afterEach(async () => {
    if (component) await unmount(component);
    target?.remove();
  });

  it("opens from Enter and Space without starting a drag or bubbling activation", async () => {
    target = document.createElement("div");
    document.body.append(target);
    const onclick = vi.fn();
    const onpointerdown = vi.fn();
    const onprefetch = vi.fn();
    const common = { theme: darkTheme, onclick, onpointerdown, onprefetch };
    component = kind === "all-day"
      ? mount(AllDayEventChip, { target, props: { ...common, event } })
      : mount(EventBlock, { target, props: { ...common, positioned } });
    await tick();
    const control = target.querySelector<HTMLElement>('[role="button"]');
    expect(control).not.toBeNull();
    expect(control?.tabIndex).toBe(0);
    expect(control?.getAttribute("aria-label")).toContain(event.title);
    const bounds = new DOMRect(10, 20, 100, 40);
    vi.spyOn(control!, "getBoundingClientRect").mockReturnValue(bounds);
    control!.focus();
    expect(onprefetch).toHaveBeenCalledOnce();
    const parentKeydown = vi.fn();
    const removeParentKeydown = on(target, "keydown", parentKeydown);
    for (const key of ["Enter", " "]) {
      const keydown = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      control!.dispatchEvent(keydown);
      expect(keydown.defaultPrevented).toBe(true);
    }
    expect(onclick).toHaveBeenCalledTimes(2);
    expect(onclick.mock.calls[0][0]).toEqual(bounds);
    expect(onpointerdown).not.toHaveBeenCalled();
    expect(parentKeydown).not.toHaveBeenCalled();
    removeParentKeydown();
    control!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", repeat: true, bubbles: true }));
    control!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(onclick).toHaveBeenCalledTimes(2);
    control!.click();
    expect(onclick).toHaveBeenCalledTimes(3);
    const dragTarget = target.querySelector(".resize-handle-top") ?? control!;
    dragTarget.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(onpointerdown).toHaveBeenCalledOnce();
  });
});
