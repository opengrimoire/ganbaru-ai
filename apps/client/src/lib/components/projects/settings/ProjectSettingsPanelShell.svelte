<script lang="ts">
  import type { Snippet } from "svelte";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import Save from "@lucide/svelte/icons/save";
  import X from "@lucide/svelte/icons/x";
  import CalendarScrollbar from "$lib/components/calendar/CalendarScrollbar.svelte";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { cn } from "$lib/utils";

  let {
    presentation,
    draftReady,
    dirty,
    saving,
    busy = false,
    error,
    title,
    discardLabel,
    closeLabel,
    saveLabel,
    onDiscard,
    onClose,
    onSave,
    children,
    scrollElement = $bindable<HTMLElement | undefined>(),
  }: {
    presentation: "side" | "popover";
    draftReady: boolean;
    dirty: boolean;
    saving: boolean;
    busy?: boolean;
    error: string | null;
    title: string;
    discardLabel: string;
    closeLabel: string;
    saveLabel: string;
    onDiscard: () => void;
    onClose: () => void;
    onSave: () => void;
    children: Snippet;
    scrollElement?: HTMLElement;
  } = $props();

  const { t } = getLocalization();

  let contentElement = $state<HTMLElement | undefined>();
  let discardConfirmOpen = $state(false);
  let scrollable = $state(false);
  let canScrollUp = $state(false);
  let canScrollDown = $state(false);
  let scrollStateFrame: number | null = null;

  function refreshScrollState(): void {
    scrollStateFrame = null;
    const element = scrollElement;
    if (!element) {
      scrollable = false;
      canScrollUp = false;
      canScrollDown = false;
      return;
    }
    const maxScrollTop = element.scrollHeight - element.clientHeight;
    scrollable = maxScrollTop > 1;
    canScrollUp = element.scrollTop > 1;
    canScrollDown = element.scrollTop < maxScrollTop - 1;
  }

  function requestScrollStateRefresh(): void {
    if (scrollStateFrame !== null) cancelAnimationFrame(scrollStateFrame);
    scrollStateFrame = requestAnimationFrame(refreshScrollState);
  }

  function confirmDiscard(): void {
    discardConfirmOpen = false;
    onDiscard();
  }

  $effect(() => {
    const element = scrollElement;
    if (!element) return;
    const resizeObserver = new ResizeObserver(requestScrollStateRefresh);
    resizeObserver.observe(element);
    if (contentElement) resizeObserver.observe(contentElement);
    requestScrollStateRefresh();
    return () => {
      resizeObserver.disconnect();
      if (scrollStateFrame !== null) {
        cancelAnimationFrame(scrollStateFrame);
        scrollStateFrame = null;
      }
    };
  });
</script>

<aside
  class={cn(
    "project-settings-panel flex min-h-0 flex-col bg-card",
    presentation === "popover"
      ? "h-full w-full"
      : "w-[min(23rem,42vw)] min-w-64 shrink-0 border-l border-border max-[760px]:fixed max-[760px]:inset-2 max-[760px]:z-30 max-[760px]:w-auto max-[760px]:rounded-md max-[760px]:border",
  )}
>
  <header class="sticky top-0 z-10 flex shrink-0 items-center gap-2 bg-card px-3 pb-1 pt-2">
    <div class="min-w-0 flex-1">
      <div class="truncate text-[0.8125rem] font-medium">{title}</div>
    </div>
    <button
      type="button"
      class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
      aria-label={discardLabel}
      title={discardLabel}
      disabled={!draftReady || !dirty || saving}
      onclick={() => {
        if (dirty) discardConfirmOpen = true;
      }}
    >
      <RotateCcw size={14} strokeWidth={1.75} />
    </button>
    <button
      type="button"
      class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
      aria-label={closeLabel}
      title={closeLabel}
      disabled={saving}
      onclick={onClose}
    >
      <X size={15} strokeWidth={1.75} />
    </button>
  </header>

  <form class="flex min-h-0 flex-1 flex-col" onsubmit={(event) => { event.preventDefault(); }}>
    {#if draftReady}
      <div class="relative min-h-0 flex-1">
        <div
          bind:this={scrollElement}
          data-settings-content
          class={cn(
            "project-settings-scroll-area hide-scrollbar h-full min-h-0 overflow-y-auto px-3 pb-3 pt-1",
            scrollable && canScrollUp && canScrollDown && "project-settings-scroll-both",
            scrollable && canScrollUp && !canScrollDown && "project-settings-scroll-top",
            scrollable && !canScrollUp && canScrollDown && "project-settings-scroll-bottom",
          )}
          onscroll={refreshScrollState}
        >
          <fieldset bind:this={contentElement} disabled={saving} inert={saving} class="flex min-w-0 flex-col gap-3 border-0 p-0">
            {@render children()}
          </fieldset>
        </div>
        <CalendarScrollbar
          scrollContainer={scrollElement}
          stickyTop={8}
          stickyBottom={8}
          wheelPassthrough
        />
      </div>

      <footer class="flex shrink-0 items-center gap-2 bg-card px-3 pb-2 pt-1">
        {#if error}
          <div class="min-w-0 flex-1 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[0.766667rem] text-destructive">
            {error}
          </div>
        {:else}
          <div class="min-w-0 flex-1"></div>
        {/if}
        <button
          type="button"
          class={cn(
            "flex min-h-8 shrink-0 items-center gap-1.5 rounded-md bg-primary px-2 text-[0.8rem] font-medium text-primary-foreground disabled:cursor-not-allowed",
            dirty || saving ? "hover:bg-primary/90" : "opacity-60",
          )}
          disabled={saving || busy || !dirty}
          onclick={onSave}
        >
          <Save size={14} strokeWidth={1.75} />
          <span>{saveLabel}</span>
        </button>
      </footer>
    {/if}
  </form>
</aside>

{#if discardConfirmOpen}
  <ConfirmDialog
    title={t("calendar.view.discardUnsavedTitle")}
    message={t("calendar.view.changesLost")}
    confirmLabel={t("calendar.view.discard")}
    cancelLabel={t("common.cancel")}
    onConfirm={confirmDiscard}
    onCancel={() => {
      discardConfirmOpen = false;
    }}
  />
{/if}

<style>
  .project-settings-panel {
    --cal-scrollbar-thumb: color-mix(in srgb, var(--card-foreground) 18%, var(--card));
    --cal-scrollbar-thumb-hover: color-mix(in srgb, var(--card-foreground) 36%, var(--card));
  }

  .project-settings-scroll-area {
    --project-settings-scroll-fade-size: 2rem;

    transition: -webkit-mask-image 120ms ease, mask-image 120ms ease;
  }

  .project-settings-scroll-top {
    -webkit-mask-image: linear-gradient(to bottom, transparent, black var(--project-settings-scroll-fade-size), black);
    mask-image: linear-gradient(to bottom, transparent, black var(--project-settings-scroll-fade-size), black);
  }

  .project-settings-scroll-bottom {
    -webkit-mask-image: linear-gradient(to bottom, black, black calc(100% - var(--project-settings-scroll-fade-size)), transparent);
    mask-image: linear-gradient(to bottom, black, black calc(100% - var(--project-settings-scroll-fade-size)), transparent);
  }

  .project-settings-scroll-both {
    -webkit-mask-image: linear-gradient(
      to bottom,
      transparent,
      black var(--project-settings-scroll-fade-size),
      black calc(100% - var(--project-settings-scroll-fade-size)),
      transparent
    );
    mask-image: linear-gradient(
      to bottom,
      transparent,
      black var(--project-settings-scroll-fade-size),
      black calc(100% - var(--project-settings-scroll-fade-size)),
      transparent
    );
  }
</style>
