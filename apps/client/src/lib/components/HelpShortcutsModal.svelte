<script lang="ts">
  import { onMount, type Component } from "svelte";
  import ArrowDown from "@lucide/svelte/icons/arrow-down";
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import ArrowUp from "@lucide/svelte/icons/arrow-up";
  import X from "@lucide/svelte/icons/x";
  import CalendarScrollbar from "$lib/components/calendar/CalendarScrollbar.svelte";

  let { onClose }: { onClose: () => void } = $props();

  interface ShortcutItem {
    keys: string[];
    action: string;
    context?: string;
  }

  interface ShortcutGroup {
    title: string;
    items: ShortcutItem[];
  }

  const SHORTCUT_GROUPS: ShortcutGroup[] = [
    {
      title: "App",
      items: [
        { keys: ["Ctrl + +"], action: "Zoom in" },
        { keys: ["Ctrl + -"], action: "Zoom out" },
        { keys: ["Ctrl + 0"], action: "Reset zoom" },
        { keys: ["Alt + 1"], action: "Open calendar" },
        { keys: ["Alt + 2"], action: "Open to-do" },
        { keys: ["Ctrl + M"], action: "Open music" },
        { keys: ["Ctrl + ,"], action: "Open settings" },
        { keys: ["Ctrl + Shift + L"], action: "Toggle light/dark mode" },
        { keys: ["Ctrl + Shift + P"], action: "Toggle performance panel" },
        { keys: ["F1"], action: "Open help" },
        { keys: ["Ctrl + Tab"], action: "Next view" },
        { keys: ["Ctrl + Shift + Tab"], action: "Previous view" },
        { keys: ["Ctrl + Shift + W"], action: "Close app" },
      ],
    },
    {
      title: "Calendar",
      items: [
        { keys: ["T", "0"], action: "Go to today" },
        { keys: ["D", "1"], action: "Day view" },
        { keys: ["W", "7"], action: "Week view" },
        { keys: ["M", "9"], action: "Month view" },
        { keys: ["Arrow left"], action: "Previous date range" },
        { keys: ["Arrow right"], action: "Next date range" },
        { keys: ["Arrow up", "Arrow down"], action: "Scroll timeline", context: "Day and week views" },
        { keys: ["Arrow up", "Arrow down"], action: "Previous or next date range", context: "Month view" },
        { keys: ["Alt + Arrow left"], action: "Back in calendar history" },
        { keys: ["Alt + Arrow right"], action: "Forward in calendar history" },
        { keys: ["Ctrl + Z"], action: "Undo calendar edit" },
        { keys: ["Ctrl + Y"], action: "Redo calendar edit" },
        { keys: ["Shift + +", "+"], action: "Zoom in the calendar timeline" },
        { keys: ["Shift + -", "-"], action: "Zoom out the calendar timeline" },
        { keys: ["Shift + 0"], action: "Reset calendar timeline zoom" },
      ],
    },
    {
      title: "Music",
      items: [
        { keys: ["Spacebar"], action: "Play or pause" },
        { keys: ["P", "L", "Ctrl + P", "Ctrl + L"], action: "Show or hide playlist" },
        { keys: ["M"], action: "Mute or unmute" },
        { keys: ["S"], action: "Toggle shuffle" },
        { keys: ["0-9"], action: "Jump to 0% through 90%" },
        { keys: ["Arrow left", "Arrow right"], action: "Seek backward or forward" },
        { keys: ["Arrow up", "Arrow down"], action: "Adjust volume" },
        { keys: ["Ctrl + Arrow left", "Ctrl + Shift + Arrow left", "Shift + Arrow left"], action: "Last track" },
        { keys: ["Ctrl + Arrow right", "Ctrl + Shift + Arrow right", "Shift + Arrow right"], action: "Next track" },
        { keys: ["+", "-"], action: "Adjust playback speed" },
      ],
    },
    {
      title: "Event editor",
      items: [
        { keys: ["Ctrl/Cmd + Enter"], action: "Save event" },
        { keys: ["Ctrl/Cmd + D"], action: "Arm or confirm delete" },
      ],
    },
  ];

  function shortcutParts(shortcut: string): string[] {
    return shortcut.split(" + ");
  }

  function arrowIconForKey(key: string): Component | undefined {
    if (key === "Arrow left") return ArrowLeft;
    if (key === "Arrow right") return ArrowRight;
    if (key === "Arrow up") return ArrowUp;
    if (key === "Arrow down") return ArrowDown;
    return undefined;
  }

  let closeButton: HTMLButtonElement | undefined = $state();
  let shortcutsScrollContainer: HTMLElement | undefined = $state();

  onMount(() => {
    closeButton?.focus();

    function handleKeydown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      e.stopPropagation();
    }

    window.addEventListener("keydown", handleKeydown, true);
    return () => window.removeEventListener("keydown", handleKeydown, true);
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 z-70 flex items-center justify-center"
  onclick={(e) => {
    e.stopPropagation();
    onClose();
  }}
>
  <div class="absolute inset-0 bg-black/50"></div>
  <div
    class="relative z-10 flex max-h-[82vh] w-fit max-w-[92vw] flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-2xl dark:bg-background"
    onclick={(e) => e.stopPropagation()}
  >
    <header class="flex shrink-0 items-center justify-between gap-3 px-5 pb-2 pt-4">
      <h2 class="truncate text-[15px] font-semibold text-foreground">Keyboard shortcuts</h2>
      <button
        bind:this={closeButton}
        onclick={onClose}
        class="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        title="Close (Esc key)"
        aria-label="Close shortcuts"
        data-app-tooltip-focus-disabled="true"
      >
        <X size={16} strokeWidth={1.9} />
      </button>
    </header>

    <div class="relative min-h-0 flex-1">
      <div bind:this={shortcutsScrollContainer} class="hide-scrollbar h-full min-h-0 overflow-y-auto px-5 py-4">
        <div class="flex flex-col gap-5">
          {#each SHORTCUT_GROUPS as group}
            <section class="min-w-0">
              <h3 class="mb-2 text-[12px] font-semibold text-muted-foreground">{group.title}</h3>
              <div class="flex flex-col divide-y divide-border/70">
                {#each group.items as item}
                  <div class="grid grid-cols-[14rem_12.5rem] gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0">
                    <div class="min-w-0 text-sm leading-5 text-foreground">
                      <div>{item.action}</div>
                      {#if item.context}
                        <div class="text-xs text-muted-foreground">{item.context}</div>
                      {/if}
                    </div>
                    <div class="flex min-w-0 flex-col items-start gap-1 overflow-hidden">
                      {#each item.keys as key}
                        <span class="flex flex-wrap items-center gap-1">
                          {#each shortcutParts(key) as part, i}
                            {#if i > 0}
                              <span class="text-[11px] leading-5 text-muted-foreground">+</span>
                            {/if}
                            {@const ArrowIcon = arrowIconForKey(part)}
                            <kbd
                              class="inline-flex min-h-6 items-center justify-center rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[11px] leading-5 text-foreground shadow-sm"
                              aria-label={ArrowIcon ? part : undefined}
                              title={ArrowIcon ? part : undefined}
                            >
                              {#if ArrowIcon}
                                <ArrowIcon size={13} strokeWidth={2.1} aria-hidden="true" />
                              {:else}
                                {part}
                              {/if}
                            </kbd>
                          {/each}
                        </span>
                      {/each}
                    </div>
                  </div>
                {/each}
              </div>
            </section>
          {/each}
        </div>
      </div>
      <CalendarScrollbar scrollContainer={shortcutsScrollContainer} wheelPassthrough />
    </div>
  </div>
</div>
