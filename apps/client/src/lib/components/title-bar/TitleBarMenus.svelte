<script lang="ts">
  import Check from "@lucide/svelte/icons/check";
  import SquareArrowLeft from "@lucide/svelte/icons/square-arrow-left";
  import SquareArrowUpRight from "@lucide/svelte/icons/square-arrow-up-right";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import type { DetachableTabView } from "$lib/navigation";
  import { getPreferences } from "$lib/stores/preferences.svelte";
  import type { TitleBarControlId } from "$lib/stores/preference-options";
  import { cn } from "$lib/utils";

  let {
    showTabContextMenu = $bindable(),
    tabContextView = $bindable(),
    tabContextMenuStyle,
    detachedWindow,
    canDetachTab,
    showTitleBarMenu = $bindable(),
    titleBarMenuStyle,
    controls,
    onTabContextAction,
    onToggleControl,
  }: {
    showTabContextMenu: boolean;
    tabContextView: DetachableTabView | null;
    tabContextMenuStyle: string;
    detachedWindow: boolean;
    canDetachTab: boolean;
    showTitleBarMenu: boolean;
    titleBarMenuStyle: string;
    controls: Array<{ id: TitleBarControlId; label: string }>;
    onTabContextAction: () => void;
    onToggleControl: (id: TitleBarControlId) => void;
  } = $props();

  const preferences = getPreferences();
  const { t } = getLocalization();
</script>

{#if showTabContextMenu && tabContextView}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-40"
    onclick={() => { showTabContextMenu = false; tabContextView = null; }}
    oncontextmenu={(e) => { e.preventDefault(); showTabContextMenu = false; tabContextView = null; }}
  ></div>
  <div
    class="fixed z-50 overflow-hidden rounded-lg border border-border bg-popover/95 text-popover-foreground shadow-2xl backdrop-blur-xl"
    style={tabContextMenuStyle}
    role="menu"
  >
    <div class="p-1">
      <button
        role="menuitem"
        disabled={!detachedWindow && !canDetachTab}
        title={!detachedWindow && !canDetachTab ? t("titleBar.keepOneTabInMainWindow") : undefined}
        onclick={onTabContextAction}
        class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-popover-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:text-muted-foreground disabled:opacity-60"
      >
        {#if detachedWindow}
          <SquareArrowLeft size={15} strokeWidth={2.2} />
          <span class="shrink-0 whitespace-nowrap">{t("titleBar.moveBackToMainWindow")}</span>
        {:else}
          <SquareArrowUpRight size={15} strokeWidth={2.2} />
          <span class="shrink-0 whitespace-nowrap">{t("titleBar.moveToNewWindow")}</span>
        {/if}
      </button>
    </div>
  </div>
{/if}

{#if showTitleBarMenu}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-40"
    onclick={() => { showTitleBarMenu = false; }}
    oncontextmenu={(e) => { e.preventDefault(); showTitleBarMenu = false; }}
  ></div>
  <div
    class="fixed z-50 overflow-hidden rounded-lg border border-border bg-popover/95 text-popover-foreground shadow-2xl backdrop-blur-xl"
    style={titleBarMenuStyle}
    role="menu"
  >
    <div class="p-1">
      {#each controls as control}
        {@const checked = preferences.titleBarVisibility[control.id]}
        <button
          role="menuitemcheckbox"
          aria-checked={checked}
          onclick={() => onToggleControl(control.id)}
          class={cn(
            "flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm transition-colors",
            checked
              ? "text-popover-foreground hover:bg-accent"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          )}
        >
          <span class="flex size-5 shrink-0 items-center justify-center text-primary">
            {#if checked}
              <Check size={15} strokeWidth={2.4} />
            {/if}
          </span>
          <span class="min-w-0 flex-1 truncate">{control.label}</span>
        </button>
      {/each}
      <div class="my-1 h-px bg-border/80"></div>
      <button
        role="menuitemcheckbox"
        aria-checked={preferences.titleBarVisibility.compactTabs}
        onclick={() => onToggleControl("compactTabs")}
        class={cn(
          "flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm transition-colors",
          preferences.titleBarVisibility.compactTabs
            ? "text-popover-foreground hover:bg-accent"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        )}
      >
        <span class="flex size-5 shrink-0 items-center justify-center text-primary">
          {#if preferences.titleBarVisibility.compactTabs}
            <Check size={15} strokeWidth={2.4} />
          {/if}
        </span>
        <span class="min-w-0 flex-1 truncate">{t("titleBar.control.compactTabs")}</span>
      </button>
    </div>
  </div>
{/if}
