<script lang="ts">
  import { onMount, type Component } from "svelte";
  import { cn } from "$lib/utils";
  import Palette from "@lucide/svelte/icons/palette";
  import CalendarDays from "@lucide/svelte/icons/calendar-days";
  import Keyboard from "@lucide/svelte/icons/keyboard";
  import SettingsIcon from "@lucide/svelte/icons/settings";
  import X from "@lucide/svelte/icons/x";
  import AppearanceSection from "./AppearanceSection.svelte";
  import ShortcutsSection from "./ShortcutsSection.svelte";
  import { getThemeEditor } from "$lib/stores/themeEditor.svelte";
  import { getViewport } from "$lib/stores/viewport.svelte";
  import { hasOnlyShortcutModifier } from "$lib/keyboard-shortcuts";
  import type { SectionId } from "./types";

  let {
    onClose,
    initialSection,
  }: { onClose: () => void; initialSection?: SectionId } = $props();

  const themeEditor = getThemeEditor();
  const viewport = getViewport();

  // When the user opens a theme in the floating editor, step out of the way
  // so the modal backdrop does not block clicking through to the app.
  $effect(() => {
    if (themeEditor.editingId) onClose();
  });

  interface SectionMeta {
    id: SectionId;
    label: string;
    icon: Component;
  }

  // To add a new settings page, add an entry with an icon and a matching
  // branch in the content switch below.
  const SECTIONS: SectionMeta[] = [
    { id: "appearance", label: "Appearance", icon: Palette },
    { id: "calendars", label: "Calendar", icon: CalendarDays },
    { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
  ];

  let activeSection = $state<SectionId>("appearance");
  const useTopNav = $derived(viewport.below("compact"));
  const useIconRail = $derived(!useTopNav && viewport.below("regular"));
  type CalendarsSectionComponent = typeof import("./CalendarsSection.svelte").default;
  let CalendarsSection = $state<CalendarsSectionComponent | null>(null);
  let loadingCalendarsSection: Promise<void> | null = null;

  function loadCalendarsSection(): Promise<void> {
    if (CalendarsSection) return Promise.resolve();
    loadingCalendarsSection ??= import("./CalendarsSection.svelte")
      .then((module) => {
        CalendarsSection = module.default;
      })
      .finally(() => {
        loadingCalendarsSection = null;
      });
    return loadingCalendarsSection;
  }

  // Apply the launcher's target section when it is set, including on first
  // mount. The modal is unmounted/remounted on each open, so this fires at
  // most once per open and never overrides a subsequent sidebar click (the
  // prop does not change during the modal's lifetime).
  $effect.pre(() => {
    if (initialSection) activeSection = initialSection;
  });

  $effect(() => {
    if (activeSection === "calendars") void loadCalendarsSection();
  });

  function focusShortcutsSearch(): void {
    const input = document.querySelector<HTMLInputElement>(
      "[data-shortcuts-search-input]",
    );
    input?.focus();
    input?.select();
  }

  onMount(() => {
    function handleKeydown(e: KeyboardEvent) {
      if (hasOnlyShortcutModifier(e) && e.key === ",") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (activeSection === "shortcuts" && hasOnlyShortcutModifier(e) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        e.stopPropagation();
        focusShortcutsSearch();
        return;
      }
      if (e.key === "F1") {
        e.preventDefault();
        e.stopPropagation();
        activeSection = "shortcuts";
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      // Keep the modal from leaking shortcuts to underlying panels
      e.stopPropagation();
    }
    window.addEventListener("keydown", handleKeydown, true);
    return () => window.removeEventListener("keydown", handleKeydown, true);
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class={cn(
    "fixed inset-0 z-70 flex",
    useTopNav ? "items-stretch justify-center p-1" : "items-center justify-center p-2",
  )}
  onclick={(e) => {
    e.stopPropagation();
    onClose();
  }}
>
  <div class="absolute inset-0 bg-black/50"></div>
  <div
    data-settings-modal-panel
    class={cn(
      "relative z-10 flex overflow-hidden border border-border bg-card shadow-2xl dark:bg-background",
      useTopNav
        ? "h-[calc(100dvh-0.5rem)] w-full flex-col rounded-md"
        : "h-[80vh] rounded-lg",
      !useTopNav && useIconRail ? "w-[min(760px,94vw)]" : "",
      !useTopNav && !useIconRail ? "w-[min(900px,90vw)]" : "",
    )}
    onclick={(e) => e.stopPropagation()}
  >
    {#if useTopNav}
      <header class="flex shrink-0 items-center gap-2 border-b border-border bg-background/40 px-2 py-2 dark:bg-black/20">
        <nav class="flex min-w-0 flex-1 gap-1 overflow-x-auto rounded-md bg-card/60 p-0.5 dark:bg-background/60">
          {#each SECTIONS as section}
            {@const Icon = section.icon}
            <button
              onclick={() => {
                activeSection = section.id;
              }}
              class={cn(
                "flex h-8 shrink-0 items-center gap-1.5 rounded px-2.5 text-[0.8rem] font-medium transition-colors",
                activeSection === section.id
                  ? "bg-accent text-accent-foreground"
                  : "text-foreground hover:bg-accent/60",
              )}
            >
              <Icon size={14} strokeWidth={1.75} class="shrink-0" />
              <span>{section.label}</span>
            </button>
          {/each}
        </nav>
        <button
          type="button"
          onclick={onClose}
          aria-label="Close settings"
          data-app-tooltip-disabled="true"
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X size={15} strokeWidth={2} />
        </button>
      </header>
    {:else}
      <!-- Sidebar -->
      <aside
        class={cn(
          "flex shrink-0 flex-col gap-3 bg-background/40 dark:bg-black/20",
          useIconRail ? "w-14 px-1 py-3" : "w-60 px-2 py-4",
        )}
      >
        <div class={cn("flex items-center", useIconRail ? "justify-center" : "justify-between")}>
          {#if !useIconRail}
            <span class="flex h-7 min-w-0 items-center gap-2.5 px-3 text-[0.866667rem] font-semibold text-muted-foreground">
              <SettingsIcon size={15} strokeWidth={1.75} class="shrink-0" />
              <span class="truncate">Settings</span>
            </span>
          {/if}
          <button
            type="button"
            onclick={onClose}
            aria-label="Close settings"
            data-app-tooltip-disabled="true"
            class="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>
        <nav class="flex flex-col gap-0.5">
          {#each SECTIONS as section}
            {@const Icon = section.icon}
            <button
              onclick={() => {
                activeSection = section.id;
              }}
              aria-label={section.label}
              data-app-tooltip-disabled="true"
              class={cn(
                "flex items-center rounded-md text-left text-[0.866667rem] font-medium transition-colors",
                useIconRail ? "h-9 justify-center px-0" : "gap-2.5 px-3 py-1.5",
                activeSection === section.id
                  ? "bg-accent text-accent-foreground"
                  : "text-foreground hover:bg-accent/60",
              )}
            >
              <Icon size={15} strokeWidth={1.75} class="shrink-0" />
              {#if !useIconRail}
                <span>{section.label}</span>
              {/if}
            </button>
          {/each}
        </nav>
      </aside>
    {/if}

    <!-- Content -->
    <section
      data-settings-content
      class={cn(
        "min-h-0 flex-1 bg-background/40 dark:bg-black/20",
        activeSection === "shortcuts" ? "overflow-hidden" : "overflow-y-auto",
        useTopNav ? "px-3 py-4" : useIconRail ? "px-5 py-5" : "p-8",
      )}
    >
      {#if activeSection === "appearance"}
        <AppearanceSection />
      {:else if activeSection === "calendars"}
        {#if CalendarsSection}
          {@const Section = CalendarsSection}
          <Section />
        {/if}
      {:else if activeSection === "shortcuts"}
        <ShortcutsSection />
      {/if}
    </section>
  </div>
</div>
