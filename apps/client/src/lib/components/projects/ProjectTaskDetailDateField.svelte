<script lang="ts">
  import { tick } from "svelte";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { formatDateTime } from "$lib/i18n/formatters";
  import { portal } from "$lib/utils/portal";
  import { pickSelectPopoverGeometry } from "$lib/components/settings/customSelectPosition";
  import CalendarDays from "@lucide/svelte/icons/calendar-days";
  import X from "@lucide/svelte/icons/x";
  import MiniDatePicker from "$lib/components/calendar/MiniDatePicker.svelte";
  import { cn } from "$lib/utils";

  type MiniDatePickerHighlightMode = "day" | "week" | "workweek" | "none";

  let {
    label = null,
    inline = false,
    value,
    noDateLabel,
    clearLabel,
    pickerOpen,
    selectedDate,
    rangeStartDate = undefined,
    rangeEndDate = undefined,
    highlightToday = undefined,
    highlightMode = undefined,
    onToggle,
    onClear,
    onSelect,
    onCancel,
  }: {
    label?: string | null;
    inline?: boolean;
    value: string;
    noDateLabel: string;
    clearLabel: string;
    pickerOpen: boolean;
    selectedDate: string;
    rangeStartDate?: string | undefined;
    rangeEndDate?: string | undefined;
    highlightToday?: boolean | undefined;
    highlightMode?: MiniDatePickerHighlightMode | undefined;
    onToggle: () => void;
    onClear: () => void;
    onSelect: (date: string) => void;
    onCancel: () => void;
  } = $props();

  const localization = getLocalization();
  const pickerId = $props.id();
  let trigger: HTMLButtonElement | undefined = $state();
  let popup: HTMLDivElement | undefined = $state();
  let popupStyle = $state("visibility: hidden;");
  const displayValue = $derived.by(() => {
    if (!value) return noDateLabel;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? value : formatDateTime(localization.locale, date, {
      day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
    });
  });

  /** Place the calendar beside its field, bounded by the visible viewport. */
  function positionPicker(): void {
    if (!trigger || !popup) return;
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0;
    const top = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? window.innerWidth;
    const height = viewport?.height ?? window.innerHeight;
    const rect = popup.getBoundingClientRect();
    const geometry = pickSelectPopoverGeometry({
      triggerRect: trigger.getBoundingClientRect(),
      boundaryRect: { left, top, right: left + width, bottom: top + height, width, height },
      contentHeight: popup.scrollHeight,
      contentWidth: rect.width,
      horizontalAlign: "end",
    });
    popupStyle = `left: ${geometry.left}px; top: ${geometry.top}px; width: ${geometry.width ?? rect.width}px; max-height: ${geometry.maxHeight}px; max-width: ${geometry.maxWidth}px;`;
  }

  /** Close the calendar without scrolling the editor back to the field. */
  function cancelPicker(): void {
    onCancel();
    trigger?.focus({ preventScroll: true });
  }

  $effect(() => {
    if (!pickerOpen || !popup) return;
    positionPicker();
    void tick().then(() => {
      if (!pickerOpen || !popup) return;
      positionPicker();
      popup.querySelector<HTMLButtonElement>(`[data-date="${selectedDate}"]`)?.focus({ preventScroll: true });
    });
    const observer = new ResizeObserver(positionPicker);
    observer.observe(popup);
    const outside = (event: PointerEvent): void => {
      if (!(event.target instanceof Node)) return;
      if (!trigger?.contains(event.target) && !popup?.contains(event.target)) onCancel();
    };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", positionPicker);
    window.addEventListener("scroll", positionPicker, true);
    window.visualViewport?.addEventListener("resize", positionPicker);
    return () => {
      observer.disconnect();
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", positionPicker);
      window.removeEventListener("scroll", positionPicker, true);
      window.visualViewport?.removeEventListener("resize", positionPicker);
    };
  });
</script>

<div class={cn("min-w-0 text-[0.8rem]", inline ? "task-property-row" : "grid gap-1")}>
  {#if label}<span class="text-muted-foreground">{label}</span>{/if}
  <div class="flex min-w-0 items-center gap-1">
    <button bind:this={trigger} type="button"
      class={cn("flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-left hover:bg-accent/60", !value && "text-muted-foreground")}
      aria-label={label ? `${label}: ${displayValue}` : displayValue}
      aria-haspopup="dialog" aria-expanded={pickerOpen} aria-controls={pickerOpen ? pickerId : undefined}
      onclick={onToggle}>
      <CalendarDays size={14} strokeWidth={1.75} class="shrink-0 text-muted-foreground" />
      <span class="truncate">{displayValue}</span>
    </button>
    {#if value}
      <button type="button" class="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label={clearLabel} onclick={onClear}>
        <X size={12} />
      </button>
    {/if}
  </div>
</div>
{#if pickerOpen}
  <div bind:this={popup} use:portal={trigger?.closest<HTMLElement>("[data-floating-root]") ?? "body"}
    id={pickerId} role="dialog" aria-label={label ?? clearLabel} tabindex="-1" data-app-floating-surface
    class="task-date-popover fixed z-90 w-72 overflow-auto rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-xl"
    style={popupStyle}
    onkeydowncapture={(event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancelPicker();
      }
    }}>
    <MiniDatePicker {selectedDate} {rangeStartDate} {rangeEndDate} small {highlightToday} {highlightMode}
      activeHighlight="primary"
      onselect={(date) => { onSelect(date); trigger?.focus({ preventScroll: true }); }}
      oncancel={cancelPicker} />
  </div>
{/if}
