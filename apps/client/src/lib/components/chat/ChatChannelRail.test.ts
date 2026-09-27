// @vitest-environment jsdom

import { mount, tick, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatChannelRead } from "$lib/chat/contracts";
import { saveChatSidebarSections } from "$lib/chat/channel-sections";
import { getChat } from "$lib/stores/chat.svelte";
import { setActiveVaultIdentity } from "$lib/vault/active-vault";
import ChatChannelRail from "./ChatChannelRail.svelte";

const projectState = vi.hoisted(() => ({
  store: {
    selectedProjectId: "project-1" as string | null,
    projects: [{ id: "project-1", name: "Ganbaru" }],
  },
}));

vi.mock("$lib/stores/projects.svelte", () => ({
  getProjects: () => projectState.store,
}));

describe("ChatChannelRail", () => {
  let target: HTMLDivElement;
  let component: ReturnType<typeof mount> | null;

  beforeEach(() => {
    localStorage.clear();
    setActiveVaultIdentity("vault-a");
    projectState.store.selectedProjectId = "project-1";
    const chat = getChat();
    chat.activeChannels = [channel("channel-general", "general"), channel("channel-design", "design")];
    chat.archivedChannels = [];
    chat.channelsLoading = false;
    chat.selectedChannelId = "channel-general";
    chat.channelArchiveOpen = false;
    saveChatSidebarSections("project-1", [{
      id: "section-design",
      name: "Design",
      collapsed: false,
      channelIds: ["channel-design"],
    }]);
    target = document.createElement("div");
    document.body.appendChild(target);
    component = null;
  });

  afterEach(async () => {
    if (component) await unmount(component);
    target.remove();
    setActiveVaultIdentity(null);
    vi.restoreAllMocks();
  });

  it("uses right-side disclosure chevrons and collapses every channel section", async () => {
    component = mount(ChatChannelRail, {
      target,
      props: {
        expanded: true,
        showCollapsedStrip: true,
        onExpand: vi.fn(),
        onCollapse: vi.fn(),
      },
    });
    await tick();

    const toggles = [...target.querySelectorAll<HTMLButtonElement>(".section-toggle")];
    expect(toggles.map((toggle) => toggle.textContent?.trim())).toEqual([
      "Channels",
      "Design",
    ]);
    for (const toggle of toggles) {
      expect(toggle.firstElementChild?.tagName).toBe("SPAN");
      expect(toggle.lastElementChild?.classList.contains("section-chevron")).toBe(true);
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
    }

    toggles[0]?.click();
    toggles[1]?.click();
    await tick();

    expect(toggles.map((toggle) => toggle.getAttribute("aria-expanded"))).toEqual([
      "false",
      "false",
    ]);
    expect(toggles.every((toggle) => toggle.classList.contains("collapsed"))).toBe(true);
    expect(target.querySelectorAll(".channel-row")).toHaveLength(0);
    expect(target.textContent).not.toContain("No direct messages yet.");
  });

  it("keeps search in the toolbar and clears filtering without hiding the field", async () => {
    component = mount(ChatChannelRail, {
      target,
      props: { expanded: true, showCollapsedStrip: true, onExpand: vi.fn(), onCollapse: vi.fn() },
    });
    await tick();
    const input = target.querySelector<HTMLInputElement>('.explorer-toolbar input[type="search"]');
    expect(input).not.toBeNull();
    expect(document.activeElement).not.toBe(input);
    expect(target.querySelectorAll(".explorer-toolbar button")).toHaveLength(1);
    window.dispatchEvent(new Event("ganbaru-ai:chat-focus-search"));
    await tick();
    await vi.waitFor(() => expect(document.activeElement).toBe(input));
    if (!input) throw new Error("Search input is missing");
    input.value = "g";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();
    expect([...target.querySelectorAll(".channel-row")].map((row) => row.textContent?.trim())).toEqual(["general", "design"]);
    input.value = "z";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();
    expect(target.querySelectorAll(".channel-row")).toHaveLength(0);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await tick();
    expect(input.value).toBe("");
    expect(target.querySelectorAll(".channel-row")).toHaveLength(2);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await tick();
    expect(target.querySelector('input[type="search"]')).toBe(input);
    expect(document.activeElement).toBe(input);
  });

  it("focuses new section drafts and cancels them without changing navigation", async () => {
    component = mount(ChatChannelRail, {
      target,
      props: { expanded: true, showCollapsedStrip: true, onExpand: vi.fn(), onCollapse: vi.fn() },
    });
    await tick();
    const trigger = target.querySelector<HTMLElement>(".section-menu summary");
    trigger?.click();
    const createSection = target.querySelector<HTMLButtonElement>(".section-menu button");
    createSection?.click();
    await tick();
    const input = target.querySelector<HTMLInputElement>('form input');
    expect(input).not.toBeNull();
    await vi.waitFor(() => expect(document.activeElement).toBe(input));
    if (!input) throw new Error("Section name input is missing");
    input.value = "Unfinished section";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await tick();
    expect(target.querySelector("form")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect([...target.querySelectorAll(".section-toggle")].map((toggle) => toggle.textContent?.trim())).toEqual(["Channels", "Design"]);
    trigger?.click();
    createSection?.click();
    await tick();
    expect(target.querySelector<HTMLInputElement>('form input')?.value).toBe("");
  });

  it("opens channel actions without selecting the channel and restores focus on Escape", async () => {
    const selectChannel = vi.spyOn(getChat(), "selectChannel").mockResolvedValue();
    component = mount(ChatChannelRail, {
      target,
      props: { expanded: true, showCollapsedStrip: true, onExpand: vi.fn(), onCollapse: vi.fn() },
    });
    await tick();
    const trigger = target.querySelector<HTMLButtonElement>('.explorer-row-action');
    trigger?.click();
    await tick();
    expect(selectChannel).not.toHaveBeenCalled();
    const menu = target.querySelector<HTMLElement>('[role="menu"]');
    expect(menu).not.toBeNull();
    await vi.waitFor(() => expect(menu?.contains(document.activeElement)).toBe(true));
    menu?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await tick();
    expect(target.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("does not mark a channel as current while the archive is open", async () => {
    getChat().channelArchiveOpen = true;
    component = mount(ChatChannelRail, {
      target,
      props: { expanded: true, showCollapsedStrip: true, onExpand: vi.fn(), onCollapse: vi.fn() },
    });
    await tick();
    expect(target.querySelector('.channel-row[aria-current]')).toBeNull();
    expect(target.querySelector('.archive-button')?.getAttribute("aria-current")).toBe("page");
  });

  it("closes the mobile surface after navigating to a channel", async () => {
    const chat = getChat();
    const selectChannel = vi.spyOn(chat, "selectChannel").mockResolvedValue();
    const onCollapse = vi.fn();
    component = mount(ChatChannelRail, {
      target,
      props: {
        presentation: "surface",
        expanded: true,
        showCollapsedStrip: false,
        onExpand: vi.fn(),
        onCollapse,
      },
    });
    await tick();

    const designChannel = [...target.querySelectorAll<HTMLButtonElement>(".channel-row")]
      .find((button) => button.textContent?.trim() === "design");
    designChannel?.click();

    await vi.waitFor(() => {
      expect(selectChannel).toHaveBeenCalledWith("channel-design");
      expect(onCollapse).toHaveBeenCalledOnce();
    });
  });
});

function channel(id: string, name: string): ChatChannelRead {
  const timestamp = "2026-08-05T12:00:00.000Z";
  return {
    id,
    conversationId: `conversation-${id}`,
    projectId: "project-1",
    name,
    topic: `${name} channel`,
    isDefault: name === "general",
    memberships: [],
    messageCount: 0,
    unreadCount: 0,
    latestPreview: null,
    lastActivityAt: timestamp,
    attentionState: null,
    revision: 1,
    archivedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
