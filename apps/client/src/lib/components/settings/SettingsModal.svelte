<script lang="ts">
  import { onMount, type Component } from "svelte";
  import { cn } from "$lib/utils";
  import Palette from "@lucide/svelte/icons/palette";
  import CalendarDays from "@lucide/svelte/icons/calendar-days";
  import AppearanceSection from "./AppearanceSection.svelte";
  import { getThemeEditor } from "$lib/stores/themeEditor.svelte";
  import type { SectionId } from "./types";

  let {
    onClose,
    initialSection,
  }: { onClose: () => void; initialSection?: SectionId } = $props();

  const themeEditor = getThemeEditor();

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

  // Sections are grouped under headings (like Obsidian's "Options", "Core
  // plugins"). Each group ships its own list. To add a new section, add an
  // entry with an icon and a matching branch in the content switch below.
  const SECTION_GROUPS: { heading: string; items: SectionMeta[] }[] = [
    {
      heading: "Options",
      items: [{ id: "appearance", label: "Appearance", icon: Palette }],
    },
    {
      heading: "Data",
      items: [{ id: "calendars", label: "Calendars", icon: CalendarDays }],
    },
  ];

  let activeSection = $state<SectionId>("appearance");
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

  onMount(() => {
    function handleKeydown(e: KeyboardEvent) {
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
  class="fixed inset-0 z-[70] flex items-center justify-center"
  onclick={(e) => {
    e.stopPropagation();
    onClose();
  }}
>
  <div class="absolute inset-0 bg-black/50"></div>
  <div
    class="relative z-10 flex h-[80vh] w-[min(900px,90vw)] overflow-hidden rounded-lg border border-border bg-card shadow-2xl dark:bg-background"
    onclick={(e) => e.stopPropagation()}
  >
    <!-- Sidebar -->
    <aside
      class="flex w-60 shrink-0 flex-col gap-4 border-r border-border bg-background/40 px-2 py-4 dark:bg-black/20"
    >
      {#each SECTION_GROUPS as group}
        <div class="flex flex-col gap-1">
          <h3
            class="px-3 pb-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
          >
            {group.heading}
          </h3>
          <nav class="flex flex-col gap-0.5">
            {#each group.items as section}
              {@const Icon = section.icon}
              <button
                onclick={() => {
                  activeSection = section.id;
                }}
                class={cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-1.5 text-left text-[13px] font-medium transition-colors",
                  activeSection === section.id
                    ? "bg-accent text-accent-foreground"
                    : "text-foreground hover:bg-accent/60",
                )}
              >
                <Icon size={15} strokeWidth={1.75} class="shrink-0" />
                <span>{section.label}</span>
              </button>
            {/each}
          </nav>
        </div>
      {/each}
    </aside>

    <!-- Content -->
    <section
      class="flex-1 overflow-y-auto bg-background/40 px-8 py-6 dark:bg-black/20"
    >
      {#if activeSection === "appearance"}
        <AppearanceSection />
      {:else if activeSection === "calendars"}
        {#if CalendarsSection}
          {@const Section = CalendarsSection}
          <Section />
        {/if}
      {/if}
    </section>
  </div>
</div>
