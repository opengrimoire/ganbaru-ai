// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { ProjectRouteUiController } from "./route-ui-controller.svelte";

describe("Project route UI controller", () => {
  it("defers a toolbar transition until dirty settings are discarded", () => {
    const controller = new ProjectRouteUiController({
      setActiveView: vi.fn(),
    });
    controller.toolbarPanel = "settings";
    controller.settingsDirty = true;

    controller.toggleToolbarPanel("filters");
    expect(controller.toolbarPanel).toBe("settings");
    expect(controller.discardConfirmOpen).toBe(true);

    controller.confirmDiscard();
    expect(controller.toolbarPanel).toBe("filters");
    expect(controller.settingsDirty).toBe(false);
  });

  it("suppresses route shortcuts while a document selection surface is open", () => {
    const setActiveView = vi.fn();
    const controller = new ProjectRouteUiController({
      setActiveView,
    });
    controller.taskFinderOpen = true;
    const event = new KeyboardEvent("keydown", { key: "3", cancelable: true });

    expect(controller.handleViewShortcut(event)).toBe(false);
    expect(setActiveView).not.toHaveBeenCalled();
  });

  it("clears non-editable selections inside the route without touching inputs", () => {
    const controller = new ProjectRouteUiController({
      setActiveView: vi.fn(),
    });
    const root = document.createElement("div");
    const text = document.createTextNode("selected");
    root.append(text);
    document.body.append(root);
    controller.rootElement = root;
    const range = document.createRange();
    range.selectNodeContents(text);
    document.getSelection()?.addRange(range);

    controller.handleDocumentSelectionChange();
    expect(document.getSelection()?.isCollapsed).toBe(true);
    root.remove();
  });
});
