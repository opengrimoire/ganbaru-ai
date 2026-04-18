<script lang="ts">
  import { onMount } from "svelte";
  import { cn } from "$lib/utils";
  import AppearanceSection from "./AppearanceSection.svelte";

  let { onClose }: { onClose: () => void } = $props();

  type SectionId = "appearance";

  const SECTIONS: { id: SectionId; label: string }[] = [
    { id: "appearance", label: "Appearance" },
  ];

  let activeSection = $state<SectionId>("appearance");

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
    class="relative z-10 flex h-[80vh] w-[min(900px,90vw)] overflow-hidden rounded-lg border border-border bg-card shadow-2xl dark:bg-sidebar"
    onclick={(e) => e.stopPropagation()}
  >
    <!-- Sidebar -->
    <aside
      class="flex w-56 shrink-0 flex-col border-r border-border bg-background/40 px-2 py-4 dark:bg-black/20"
    >
      <h2 class="mb-3 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Settings
      </h2>
      <nav class="flex flex-col gap-0.5">
        {#each SECTIONS as section}
          <button
            onclick={() => {
              activeSection = section.id;
            }}
            class={cn(
              "rounded-md px-3 py-1.5 text-left text-[13px] font-medium transition-colors",
              activeSection === section.id
                ? "bg-accent text-accent-foreground"
                : "text-foreground hover:bg-accent/60",
            )}
          >
            {section.label}
          </button>
        {/each}
      </nav>
    </aside>

    <!-- Content -->
    <section class="flex-1 overflow-y-auto px-8 py-6">
      {#if activeSection === "appearance"}
        <AppearanceSection />
      {/if}
    </section>
  </div>
</div>
