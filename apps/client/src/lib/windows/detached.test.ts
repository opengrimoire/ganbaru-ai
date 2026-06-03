import { describe, expect, it } from "vitest";
import {
  detachedViewWindowLabel,
  detachedViewWindowTitle,
  detachedViewWindowUrl,
  detachableTabViewFromWindowLabel,
  isDetachedViewReattachRequest,
  parseDetachedViewDragPayload,
  serializeDetachedViewDragPayload,
} from "./detached";

describe("detached view windows", () => {
  it("uses stable labels for app-owned popout windows", () => {
    expect(detachedViewWindowLabel("calendar")).toBe("view-calendar");
    expect(detachedViewWindowLabel("projects")).toBe("view-projects");
    expect(detachedViewWindowLabel("notes")).toBe("view-notes");
  });

  it("opens a local app route with the requested initial view", () => {
    expect(detachedViewWindowUrl("calendar")).toBe("/?view=calendar");
    expect(detachedViewWindowUrl("projects")).toBe("/?view=projects");
    expect(detachedViewWindowUrl("notes")).toBe("/?view=notes");
  });

  it("uses view-specific window titles", () => {
    expect(detachedViewWindowTitle("calendar")).toBe("Ganbaru AI: Calendar");
    expect(detachedViewWindowTitle("projects")).toBe("Ganbaru AI: Projects");
    expect(detachedViewWindowTitle("notes")).toBe("Ganbaru AI: Notes");
  });

  it("parses detachable views from detached window labels only", () => {
    expect(detachableTabViewFromWindowLabel("view-calendar")).toBe("calendar");
    expect(detachableTabViewFromWindowLabel("view-music")).toBeUndefined();
    expect(detachableTabViewFromWindowLabel("main")).toBeUndefined();
  });

  it("round-trips detached tab drag payloads", () => {
    const payload = serializeDetachedViewDragPayload("calendar", "view-calendar");
    expect(parseDetachedViewDragPayload(payload)).toEqual({
      view: "calendar",
      sourceLabel: "view-calendar",
    });
  });

  it("rejects mismatched detached tab drag payloads", () => {
    expect(parseDetachedViewDragPayload("not-json")).toBeUndefined();
    expect(parseDetachedViewDragPayload(JSON.stringify({
      view: "calendar",
      sourceLabel: "main",
    }))).toBeUndefined();
    expect(parseDetachedViewDragPayload(JSON.stringify({
      view: "music",
      sourceLabel: "view-music",
    }))).toBeUndefined();
  });

  it("validates reattach requests", () => {
    expect(isDetachedViewReattachRequest({ view: "notes" })).toBe(true);
    expect(isDetachedViewReattachRequest({ view: "music" })).toBe(false);
    expect(isDetachedViewReattachRequest(null)).toBe(false);
  });
});
