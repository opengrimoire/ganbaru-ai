// @vitest-environment jsdom

import { mount, tick, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localFileSourceFromPath } from "$lib/music/sources";
import { getMusicPlayer } from "$lib/stores/music-player.svelte";
import { getMusicSourcesController } from "$lib/music/music-sources-controller.svelte";

class ResizeObserverStub {
  observe(): void {}
  disconnect(): void {}
}

function matchMediaStub(query: string): MediaQueryList {
  return {
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => true,
  };
}

describe("MusicPanel", () => {
  let target: HTMLDivElement | undefined;
  let component: ReturnType<typeof mount> | undefined;

  afterEach(async () => {
    if (component) await unmount(component);
    target?.remove();
    component = undefined;
    target = undefined;
    vi.unstubAllGlobals();
    getMusicSourcesController().firstUseSession = false;
    getMusicPlayer().setPlaylistVisible(false);
  });

  it("mounts an interactive dialog above its persistent media layer and closes with Escape", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    target = document.createElement("div");
    document.body.append(target);
    const onclose = vi.fn();
    const { default: MusicPanel } = await import("./MusicPanel.svelte");

    component = mount(MusicPanel, { target, props: { onclose } });
    await tick();

    const dialog = target.querySelector<HTMLElement>("[role='dialog']");
    expect(dialog).not.toBeNull();
    expect(dialog?.classList.contains("z-70")).toBe(true);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onclose).toHaveBeenCalledOnce();
  });

  it("uses a square playlist launcher and no close button in the mobile player", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    target = document.createElement("div");
    document.body.append(target);
    const { default: MusicPanel } = await import("./MusicPanel.svelte");

    component = mount(MusicPanel, {
      target,
      props: { onclose: vi.fn(), presentation: "mobile" },
    });
    await tick();

    const launcher = target.querySelector<HTMLElement>("[data-music-playlist-launcher]");
    const header = target.querySelector<HTMLElement>("[data-music-player-header]");
    expect(launcher?.classList.contains("h-9")).toBe(true);
    expect(launcher?.classList.contains("w-9")).toBe(true);
    expect(header?.classList.contains("py-2")).toBe(true);
    expect(target.querySelector("button[aria-label='Close']")).toBeNull();
  });

  it("does not reset persistent playback state when the panel closes", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    target = document.createElement("div");
    document.body.append(target);
    const player = getMusicPlayer();
    const source = localFileSourceFromPath("/music/persistent.flac", "Persistent");
    player.currentSource = source;
    player.queue = [source];
    const { default: MusicPanel } = await import("./MusicPanel.svelte");

    component = mount(MusicPanel, { target, props: { onclose: vi.fn() } });
    await tick();
    await unmount(component);
    component = undefined;

    expect(getMusicPlayer()).toBe(player);
    expect(player.currentSource).toEqual(source);
    expect(player.queue).toEqual([source]);

    player.currentSource = null;
    player.queue = [];
  });

  it("owns playback arrow shortcuts before the underlying tab can handle them", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    target = document.createElement("div");
    document.body.append(target);
    const player = getMusicPlayer();
    const adjustVolume = vi.spyOn(player, "adjustVolume").mockResolvedValue();
    const underlyingKeydown = vi.fn();
    const { default: MusicPanel } = await import("./MusicPanel.svelte");

    component = mount(MusicPanel, { target, props: { onclose: vi.fn() } });
    await tick();
    window.addEventListener("keydown", underlyingKeydown);
    const event = new KeyboardEvent("keydown", {
      key: "ArrowUp",
      bubbles: true,
      cancelable: true,
    });

    window.dispatchEvent(event);
    window.removeEventListener("keydown", underlyingKeydown);

    expect(event.defaultPrevented).toBe(true);
    expect(adjustVolume).toHaveBeenCalledWith(0.05);
    expect(underlyingKeydown).not.toHaveBeenCalled();
  });

  it("lets the playlist chooser close with Escape without closing Music", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    target = document.createElement("div");
    document.body.append(target);
    const onclose = vi.fn();
    const { default: MusicPanel } = await import("./MusicPanel.svelte");

    component = mount(MusicPanel, { target, props: { onclose } });
    await tick();
    target.querySelector<HTMLButtonElement>("[data-music-playlist-launcher]")?.click();
    await vi.waitFor(() => {
      expect(document.body.querySelector(".playlist-launcher-popover")).not.toBeNull();
    });

    window.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }));
    await tick();

    expect(document.body.querySelector(".playlist-launcher-popover")).toBeNull();
    expect(onclose).not.toHaveBeenCalled();
  });

  it("keeps the initialized builder mounted but inactive while returning to the player", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("matchMedia", matchMediaStub);
    target = document.createElement("div");
    document.body.append(target);
    const { default: MusicPanel } = await import("./MusicPanel.svelte");

    component = mount(MusicPanel, { target, props: { onclose: vi.fn() } });
    await tick();
    const playerPage = target.querySelector<HTMLElement>("[data-music-player-page]");
    expect(playerPage).not.toBeNull();
    expect(target.querySelector("#music-source")).toBeNull();
    expect(target.querySelector("button[aria-label='Pick folder']")).toBeNull();
    expect(target.querySelector("button[aria-label='Load source']")).toBeNull();
    expect(target.querySelector("button[aria-label='Reset']")).toBeNull();

    target.querySelector<HTMLButtonElement>("[data-music-playlist-launcher]")?.click();
    await vi.waitFor(() => {
      expect([...document.body.querySelectorAll<HTMLButtonElement>("button")]
        .some((button) => button.textContent?.includes("Open builder"))).toBe(true);
    });
    const firstOpenBuilder = [...document.body.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Open builder"));
    firstOpenBuilder?.click();
    await vi.waitFor(() => {
      expect(target?.querySelector(".builder-root"), target?.textContent ?? "").not.toBeNull();
    }, { timeout: 5_000 });
    expect(target.querySelector("[data-music-player-page]")).toBe(playerPage);
    expect(playerPage?.classList.contains("hidden")).toBe(true);
    expect(target.textContent).not.toContain("Everything is reviewed");
    expect(target.textContent).toMatch(/Opening your music library|Preparing your Music folder/);

    window.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }));
    await tick();
    expect(target.querySelector("[data-music-player-page]")).toBe(playerPage);
    expect(playerPage?.classList.contains("hidden")).toBe(false);
    expect(target.querySelector(".builder-root")).not.toBeNull();
    expect(target.querySelector(".builder-root")?.closest("[aria-hidden='true']")).not.toBeNull();

    target.querySelector<HTMLButtonElement>("[data-music-playlist-launcher]")?.click();
    await vi.waitFor(() => {
      expect([...document.body.querySelectorAll<HTMLButtonElement>("button")]
        .some((button) => button.textContent?.includes("Open builder"))).toBe(true);
    });
    const openBuilder = [...document.body.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Open builder"));
    openBuilder?.click();
    await tick();
    expect(target.querySelector(".builder-root")).not.toBeNull();
    expect(target.querySelector("[data-music-player-page]")).toBe(playerPage);
  });

  it("applies builder and expanded playlist heights in the same view transition", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("matchMedia", matchMediaStub);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.matches("[data-music-player-header]")) return new DOMRect(0, 0, 1_000, 40);
      if (this.matches(".music-media-cell")) return new DOMRect(0, 40, 680, 383);
      if (this.matches("#music-playlist")) return new DOMRect(680, 40, 320, 383);
      return new DOMRect(0, 0, 1_000, 80);
    });
    target = document.createElement("div");
    document.body.append(target);
    const player = getMusicPlayer();
    player.setPlaylistVisible(true);
    const { default: MusicPanel } = await import("./MusicPanel.svelte");

    component = mount(MusicPanel, { target, props: { onclose: vi.fn() } });
    await tick();
    const dialog = target.querySelector<HTMLElement>("[role='dialog']");
    expect(dialog?.style.height).toContain("503px");

    target.querySelector<HTMLButtonElement>("[data-music-playlist-launcher]")?.click();
    await vi.waitFor(() => {
      expect([...document.body.querySelectorAll<HTMLButtonElement>("button")]
        .some((button) => button.textContent?.includes("Open builder"))).toBe(true);
    });
    const openBuilder = [...document.body.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Open builder"));
    openBuilder?.click();
    await tick();

    expect(dialog?.style.height).toContain("680px");
    await vi.waitFor(() => {
      expect(target?.querySelector(".builder-root"), target?.textContent ?? "").not.toBeNull();
    }, { timeout: 5_000 });

    window.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }));
    await tick();

    expect(dialog?.style.height).toContain("503px");
  });

  it("keeps first-use preparation pending when the panel closes before completion", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("matchMedia", matchMediaStub);
    getMusicSourcesController().firstUseSession = true;
    target = document.createElement("div");
    document.body.append(target);
    const { default: MusicPanel } = await import("./MusicPanel.svelte");

    component = mount(MusicPanel, { target, props: { onclose: vi.fn() } });

    await vi.waitFor(() => {
      expect(target?.querySelector(".builder-root"), target?.textContent ?? "").not.toBeNull();
    }, { timeout: 5_000 });
    expect(target.querySelector("[data-music-player-page]")?.classList.contains("hidden")).toBe(true);

    await unmount(component);
    component = undefined;

    expect(getMusicSourcesController().firstUseSession).toBe(true);
  });
});
