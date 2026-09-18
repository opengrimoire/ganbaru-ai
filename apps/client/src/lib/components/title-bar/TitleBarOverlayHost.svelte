<script lang="ts">
  import { onMount } from "svelte";
  import type { StartupMemorySnapshot } from "$lib/components/perf/memoryReport";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { getSettingsLauncher } from "$lib/stores/settingsLauncher.svelte";
  import { getThemeEditor } from "$lib/stores/themeEditor.svelte";
  import SettingsModal from "$lib/components/settings/SettingsModal.svelte";
  import MusicPanel from "$lib/components/music/MusicPanel.svelte";
  import QuickNotesPanel from "$lib/components/quick-notes/QuickNotesPanel.svelte";
  import { preloadQuickNotesInitialSnapshot } from "$lib/quick-notes/initial-snapshot";
  import { startMusicFirstUsePreload } from "$lib/music/music-first-use-preload";
  import { preloadDataSection } from "$lib/components/settings/settings-sections";

  type PerformancePopoverComponent = typeof import("$lib/components/perf/PerformancePopover.svelte").default;
  type FloatingThemeEditorComponent = typeof import("$lib/components/settings/FloatingThemeEditor.svelte").default;
  type ThemeQuickSwitcherComponent = typeof import("$lib/components/ThemeQuickSwitcher.svelte").default;

  let {
    showPerformance = $bindable(),
    performancePinned = $bindable(),
    showThemeQuickSwitcher = $bindable(),
    showQuickNotes = $bindable(),
    showMusic = $bindable(),
    shellStartupMs,
    startupMemorySnapshot,
    ensureBenchmarkOverlay,
  }: {
    showPerformance: boolean;
    performancePinned: boolean;
    showThemeQuickSwitcher: boolean;
    showQuickNotes: boolean;
    showMusic: boolean;
    shellStartupMs: number | null;
    startupMemorySnapshot: StartupMemorySnapshot;
    ensureBenchmarkOverlay: () => Promise<void>;
  } = $props();

  const settingsLauncher = getSettingsLauncher();
  const themeEditor = getThemeEditor();
  const { t } = getLocalization();

  let PerformancePopover = $state<PerformancePopoverComponent | null>(null);
  let FloatingThemeEditor = $state<FloatingThemeEditorComponent | null>(null);
  let ThemeQuickSwitcher = $state<ThemeQuickSwitcherComponent | null>(null);
  let performanceLoad: Promise<void> | null = null;
  let editorLoad: Promise<void> | null = null;
  let switcherLoad: Promise<void> | null = null;

  function loadPerformance(): Promise<void> {
    if (PerformancePopover) return Promise.resolve();
    performanceLoad ??= import("$lib/components/perf/PerformancePopover.svelte")
      .then((module) => { PerformancePopover = module.default; })
      .finally(() => { performanceLoad = null; });
    return performanceLoad;
  }

  function loadEditor(): Promise<void> {
    if (FloatingThemeEditor) return Promise.resolve();
    editorLoad ??= import("$lib/components/settings/FloatingThemeEditor.svelte")
      .then((module) => { FloatingThemeEditor = module.default; })
      .finally(() => { editorLoad = null; });
    return editorLoad;
  }

  function loadSwitcher(): Promise<void> {
    if (ThemeQuickSwitcher) return Promise.resolve();
    switcherLoad ??= import("$lib/components/ThemeQuickSwitcher.svelte")
      .then((module) => { ThemeQuickSwitcher = module.default; })
      .finally(() => { switcherLoad = null; });
    return switcherLoad;
  }

  $effect(() => {
    if (showPerformance) void loadPerformance();
    if (themeEditor.editingId) void loadEditor();
    if (showThemeQuickSwitcher) void loadSwitcher();
  });

  onMount(() => {
    const stopMusicPreload = startMusicFirstUsePreload();
    void preloadDataSection().catch((error: unknown) => {
      console.warn("Data settings preload failed", error);
    });
    void preloadQuickNotesInitialSnapshot().catch((error: unknown) => {
      console.warn("Quick notes preload failed", error);
    });
    return stopMusicPreload;
  });
</script>

{#if showPerformance}
  {#if !performancePinned}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="fixed inset-0 z-40"
      onclick={() => { showPerformance = false; }}
      onkeydown={(event) => { if (event.key === "Escape") showPerformance = false; }}
    ></div>
  {/if}
  {#if PerformancePopover}
    {@const Popover = PerformancePopover}
    <Popover
      {shellStartupMs}
      {startupMemorySnapshot}
      pinned={performancePinned}
      onPinnedChange={(nextPinned: boolean) => { performancePinned = nextPinned; }}
      {ensureBenchmarkOverlay}
    />
  {:else}
    <div
      class="fixed z-50 overflow-hidden rounded-lg border border-border bg-popover px-3 py-3 text-xs text-muted-foreground shadow-lg"
      style="top: calc(var(--titlebar-h) + 4px); right: 8px; width: min(18rem, calc(100vw - 16px)); max-height: calc(100dvh - var(--titlebar-h) - 12px);"
    >
      {t("common.loading")}...
    </div>
  {/if}
{/if}

{#if showQuickNotes}
  <QuickNotesPanel onclose={() => { showQuickNotes = false; }} />
{/if}

{#if showMusic}
  <MusicPanel onclose={() => { showMusic = false; }} />
{/if}

{#if showThemeQuickSwitcher && ThemeQuickSwitcher}
  {@const Switcher = ThemeQuickSwitcher}
  <Switcher onClose={() => { showThemeQuickSwitcher = false; }} />
{/if}

{#if settingsLauncher.isOpen}
  <SettingsModal
    onClose={() => settingsLauncher.close()}
    initialSection={settingsLauncher.targetSection}
    initialDoomscrollingTab={settingsLauncher.targetDoomscrollingTab}
    initialChatSubsection={settingsLauncher.targetChatSubsection}
    initialChatTeammateId={settingsLauncher.targetChatTeammateId}
    initialChatChannelId={settingsLauncher.targetChatChannelId}
    initialChatCreateTeammate={settingsLauncher.targetChatCreateTeammate}
  />
{/if}

{#if themeEditor.editingId && FloatingThemeEditor}
  {@const Editor = FloatingThemeEditor}
  <Editor
    onBackToList={() => {
      settingsLauncher.open("appearance");
    }}
  />
{/if}
