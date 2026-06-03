<script lang="ts">
  import { cn } from "$lib/utils";
  import type { DoomscrollingLimitEditorTarget, DoomscrollingSettingsTab } from "./types";
  import DoomscrollingBrowserSettings from "./DoomscrollingBrowserSettings.svelte";
  import DoomscrollingMobileSettings from "./DoomscrollingMobileSettings.svelte";
  import DoomscrollingDesktopSettings from "./DoomscrollingDesktopSettings.svelte";
  import DoomscrollingLimitsSettings from "./DoomscrollingLimitsSettings.svelte";

  let {
    initialTab = "limits",
    onOpenLimitEditor = () => {},
  }: {
    initialTab?: DoomscrollingSettingsTab;
    onOpenLimitEditor?: (target: DoomscrollingLimitEditorTarget) => void;
  } = $props();

  const tabs: ReadonlyArray<{
    id: DoomscrollingSettingsTab;
    label: string;
  }> = [
    { id: "limits", label: "Limits" },
    { id: "browser", label: "Browser" },
    { id: "mobile", label: "Mobile apps" },
    { id: "desktop", label: "Desktop apps" },
  ];

  let activeTab = $state<DoomscrollingSettingsTab>("limits");

  $effect.pre(() => {
    activeTab = initialTab;
  });
</script>

<div class="flex flex-col gap-6">
  <div
    class="grid grid-cols-2 gap-1 rounded-md border border-border bg-card p-1 min-[500px]:grid-cols-4 dark:bg-transparent"
    role="tablist"
    aria-label="Doomscrolling settings"
  >
    {#each tabs as tab}
      {@const active = activeTab === tab.id}
      <button
        type="button"
        role="tab"
        aria-selected={active}
        class={cn(
          "flex min-h-8 items-center justify-center rounded-sm px-2.5 text-center text-[0.8rem] font-medium text-muted-foreground",
          active && "bg-background text-foreground dark:bg-foreground/5",
        )}
        onclick={() => {
          activeTab = tab.id;
        }}
      >
        {tab.label}
      </button>
    {/each}
  </div>

  {#if activeTab === "limits"}
    <DoomscrollingLimitsSettings {onOpenLimitEditor} />
  {:else if activeTab === "browser"}
    <DoomscrollingBrowserSettings />
  {:else if activeTab === "mobile"}
    <DoomscrollingMobileSettings />
  {:else}
    <DoomscrollingDesktopSettings />
  {/if}
</div>
