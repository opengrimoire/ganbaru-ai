import { describe, expect, it } from "vitest";
import {
  isDetachableTabView,
  isView,
  firstMainView,
  mainTabViews,
  parseInitialViewSearch,
  viewLabel,
} from "./navigation";

describe("navigation helpers", () => {
  it("accepts registered views only", () => {
    expect(isView("calendar")).toBe(true);
    expect(isView("music")).toBe(true);
    expect(isView("settings")).toBe(false);
    expect(isView(null)).toBe(false);
  });

  it("limits detached windows to title bar tabs", () => {
    expect(isDetachableTabView("calendar")).toBe(true);
    expect(isDetachableTabView("projects")).toBe(true);
    expect(isDetachableTabView("notes")).toBe(true);
    expect(isDetachableTabView("music")).toBe(false);
  });

  it("parses an initial view from the window search string", () => {
    expect(parseInitialViewSearch("?view=notes")).toBe("notes");
    expect(parseInitialViewSearch("?view=music")).toBe("music");
    expect(parseInitialViewSearch("?view=settings")).toBeUndefined();
    expect(parseInitialViewSearch("")).toBeUndefined();
  });

  it("provides user-facing labels for every view", () => {
    expect(viewLabel("calendar")).toBe("Calendar");
    expect(viewLabel("projects")).toBe("Projects");
    expect(viewLabel("notes")).toBe("Notes");
    expect(viewLabel("music")).toBe("Music");
  });

  it("removes detached tabs from the main tab list", () => {
    expect(mainTabViews(new Set(["calendar", "notes"]))).toEqual(["projects"]);
  });

  it("falls back to music when every primary tab is detached", () => {
    expect(firstMainView(new Set(["calendar", "projects", "notes"]))).toBe("music");
  });
});
