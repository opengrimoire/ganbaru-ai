<script lang="ts">
  import { tick } from "svelte";
  import Binary from "@lucide/svelte/icons/binary";
  import CalendarDays from "@lucide/svelte/icons/calendar-days";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import Link2 from "@lucide/svelte/icons/link-2";
  import List from "@lucide/svelte/icons/list";
  import ListChecks from "@lucide/svelte/icons/list-checks";
  import Mail from "@lucide/svelte/icons/mail";
  import Paperclip from "@lucide/svelte/icons/paperclip";
  import Phone from "@lucide/svelte/icons/phone";
  import SquareCheckBig from "@lucide/svelte/icons/square-check-big";
  import TextAlignStart from "@lucide/svelte/icons/text-align-start";
  import UserRound from "@lucide/svelte/icons/user-round";
  import {
    pickSelectPopoverGeometry,
    type SelectPopoverGeometry,
    type SelectPopoverRect,
  } from "$lib/utils/select-popover-position";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { projectCustomFieldTypeLabel } from "$lib/projects/display";
  import {
    PROJECT_CUSTOM_FIELD_TYPES,
    type ProjectCustomFieldType,
  } from "$lib/projects/types";
  import { cn } from "$lib/utils";
  import { portal } from "$lib/utils/portal";

  let {
    value = $bindable<ProjectCustomFieldType>(),
    containerClass = "w-32",
  }: {
    value: ProjectCustomFieldType;
    containerClass?: string;
  } = $props();

  const { t } = getLocalization();

  const CUSTOM_FIELD_TYPE_PICKER_ESTIMATED_HEIGHT = 224;
  const DEFAULT_CUSTOM_FIELD_TYPE_PICKER_GEOMETRY: SelectPopoverGeometry = {
    top: 0,
    left: 0,
    width: null,
    minWidth: 0,
    maxWidth: 0,
    maxHeight: 0,
    placement: "below",
  };

  let pickerOpen = $state(false);
  let triggerElement = $state<HTMLButtonElement | undefined>();
  let panelElement = $state<HTMLDivElement | undefined>();
  let pickerGeometry = $state<SelectPopoverGeometry>(DEFAULT_CUSTOM_FIELD_TYPE_PICKER_GEOMETRY);
  let pickerReady = $state(false);

  function toSelectPopoverRect(rect: DOMRect): SelectPopoverRect {
    return {
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    };
  }

  function pickerBoundaryRect(): SelectPopoverRect {
    const viewportRect: SelectPopoverRect = {
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
      left: 0,
      width: window.innerWidth,
      height: window.innerHeight,
    };
    if (!triggerElement) return viewportRect;
    const boundaryElement =
      triggerElement.closest<HTMLElement>("[data-settings-content]")
      ?? triggerElement.closest<HTMLElement>("[data-settings-modal-panel]");
    if (!boundaryElement) return viewportRect;
    const boundary = boundaryElement.getBoundingClientRect();
    const top = Math.max(viewportRect.top, boundary.top);
    const right = Math.min(viewportRect.right, boundary.right);
    const bottom = Math.min(viewportRect.bottom, boundary.bottom);
    const left = Math.max(viewportRect.left, boundary.left);
    return {
      top,
      right,
      bottom,
      left,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    };
  }

  function computePickerPosition(): void {
    if (!triggerElement) return;
    pickerGeometry = pickSelectPopoverGeometry({
      triggerRect: toSelectPopoverRect(triggerElement.getBoundingClientRect()),
      boundaryRect: pickerBoundaryRect(),
      contentHeight: panelElement?.scrollHeight ?? CUSTOM_FIELD_TYPE_PICKER_ESTIMATED_HEIGHT,
      contentWidth: panelElement?.scrollWidth,
      horizontalAlign: "end",
    });
    pickerReady = true;
  }

  function pickerStyle(): string {
    if (!pickerReady) {
      return "top: 0px; left: 0px; min-width: max-content; max-width: max-content; max-height: none; visibility: hidden;";
    }
    const width = pickerGeometry.width === null
      ? ""
      : ` width: ${pickerGeometry.width}px;`;
    return `top: ${pickerGeometry.top}px; left: ${pickerGeometry.left}px;${width} min-width: ${pickerGeometry.minWidth}px; max-width: ${pickerGeometry.maxWidth}px; max-height: ${pickerGeometry.maxHeight}px; visibility: visible;`;
  }

  async function togglePicker(): Promise<void> {
    if (pickerOpen) {
      pickerOpen = false;
      return;
    }
    pickerReady = false;
    pickerOpen = true;
    await tick();
    computePickerPosition();
  }

  function selectFieldType(fieldType: ProjectCustomFieldType): void {
    value = fieldType;
    pickerOpen = false;
  }

  $effect(() => {
    if (!pickerOpen) return;
    function handleClickOutside(event: MouseEvent): void {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (triggerElement?.contains(target)) return;
      if (panelElement?.contains(target)) return;
      pickerOpen = false;
    }
    function handleScroll(event: Event): void {
      if (event.target instanceof Node && panelElement?.contains(event.target)) return;
      pickerOpen = false;
    }
    function handleResize(): void {
      computePickerPosition();
    }
    function handleKeydown(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      pickerOpen = false;
    }
    window.addEventListener("mousedown", handleClickOutside, true);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleResize);
    window.addEventListener("keydown", handleKeydown, true);
    return () => {
      window.removeEventListener("mousedown", handleClickOutside, true);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("keydown", handleKeydown, true);
    };
  });
</script>

{#snippet fieldTypeIcon(fieldType: ProjectCustomFieldType)}
  {#if fieldType === "text"}
    <TextAlignStart size={14} strokeWidth={1.8} />
  {:else if fieldType === "number"}
    <Binary size={15.5} strokeWidth={1.8} />
  {:else if fieldType === "select"}
    <List size={14} strokeWidth={1.8} />
  {:else if fieldType === "multi_select"}
    <ListChecks size={14} strokeWidth={1.8} />
  {:else if fieldType === "status"}
    <CircleCheck size={14} strokeWidth={1.8} />
  {:else if fieldType === "date"}
    <CalendarDays size={14} strokeWidth={1.8} />
  {:else if fieldType === "person"}
    <UserRound size={14} strokeWidth={1.8} />
  {:else if fieldType === "files"}
    <Paperclip size={14} strokeWidth={1.8} />
  {:else if fieldType === "checkbox"}
    <SquareCheckBig size={14} strokeWidth={1.8} />
  {:else if fieldType === "url"}
    <Link2 size={14} strokeWidth={1.8} />
  {:else if fieldType === "phone"}
    <Phone size={14} strokeWidth={1.8} />
  {:else}
    <Mail size={14} strokeWidth={1.8} />
  {/if}
{/snippet}

<div class={cn("relative min-w-0", containerClass)}>
  <button
    bind:this={triggerElement}
    type="button"
    class="flex h-7 w-full max-w-full items-center justify-between gap-2 rounded-md border border-border bg-card px-2.5 text-left text-[0.8rem] font-medium text-foreground transition-colors hover:bg-accent dark:bg-transparent"
    aria-haspopup="listbox"
    aria-expanded={pickerOpen}
    aria-label={t("projects.customFields.fieldType")}
    onclick={() => { void togglePicker(); }}
  >
    <span class="min-w-0 flex-1 truncate">{projectCustomFieldTypeLabel(value, t)}</span>
    <ChevronDown
      size={13}
      strokeWidth={2}
      class={cn("shrink-0 text-muted-foreground transition-transform", pickerOpen && "rotate-180")}
    />
  </button>
  {#if pickerOpen}
    <div
      bind:this={panelElement}
      use:portal
      role="listbox"
      data-app-floating-surface
      class="fixed z-80 overflow-x-hidden overflow-y-auto rounded-lg border border-border bg-popover p-1.5 shadow-lg"
      style={pickerStyle()}
    >
      <div class="grid min-w-64 grid-cols-2 gap-1">
        {#each PROJECT_CUSTOM_FIELD_TYPES as fieldType}
          {@const selected = fieldType === value}
          <button
            type="button"
            role="option"
            aria-selected={selected}
            class={cn(
              "flex min-h-9 min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 text-left text-[0.8rem] transition-colors",
              selected
                ? "bg-accent/70 font-semibold text-foreground"
                : "text-foreground hover:bg-accent/45",
            )}
            onclick={() => selectFieldType(fieldType)}
          >
            <span class="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground">
              {@render fieldTypeIcon(fieldType)}
            </span>
            <span class="min-w-0 truncate">{projectCustomFieldTypeLabel(fieldType, t)}</span>
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>
