<script lang="ts">
  import type { EventColor } from "$lib/components/calendar/types";
  import { EVENT_COLOR_OPTIONS } from "$lib/components/calendar/utils";
  import type { ProjectIconPickerColor } from "$lib/projects/project-icon-picker";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { cn } from "$lib/utils";

  let {
    open = $bindable(false), color, label, askEveryTime, colorSelectionBorder,
    automaticColor, colorLabel, colorSwatch, onSelect, onOpen,
    onAskEveryTimeChange, disabled = false,
  }: {
    open?: boolean;
    color: ProjectIconPickerColor;
    label: string;
    askEveryTime: boolean;
    colorSelectionBorder: string;
    automaticColor: string;
    colorLabel: (color: ProjectIconPickerColor) => string;
    colorSwatch: (color: EventColor) => string;
    onSelect: (color: ProjectIconPickerColor) => void;
    onOpen: () => void;
    onAskEveryTimeChange: (enabled: boolean) => void;
    disabled?: boolean;
  } = $props();
  const { t } = getLocalization();
</script>

<div class="relative shrink-0" data-icon-picker-inline-panel>
  <button
    type="button"
    {disabled}
    class={cn(
      "flex h-8 w-8 items-center justify-center rounded-md border border-border hover:bg-accent",
      open && "bg-accent text-foreground",
    )}
    aria-label={label}
    data-app-tooltip-disabled="true"
    onclick={(event) => {
      event.stopPropagation();
      const nextOpen = !open;
      open = nextOpen;
      if (nextOpen) onOpen();
    }}
  >
    <span
      class="h-4 w-4 rounded-full border border-border"
      style={`background: ${color === "default" ? automaticColor : colorSwatch(color)};`}
    ></span>
  </button>
  {#if open}
    <div
      class="absolute right-0 top-9 z-10 w-40 rounded-lg border border-border px-2.5 py-2 shadow-lg"
      style={`background-color: var(--icon-picker-bg); color: var(--icon-picker-text); --project-icon-color-selection-border: ${colorSelectionBorder};`}
    >
      <button
        type="button"
        {disabled}
        class={cn(
          "grid h-8 w-full items-center justify-center gap-2 rounded-md text-left text-[0.8rem] text-foreground hover:bg-accent",
          color === "default" && "bg-accent/70",
        )}
        style="grid-template-columns: repeat(4, 1.375rem);"
        aria-label={colorLabel("default")}
        data-app-tooltip-disabled="true"
        onclick={(event) => {
          event.stopPropagation();
          onSelect("default");
          open = false;
        }}
      >
        <span
          class="size-5.5 rounded-full"
          style={`background-color: ${automaticColor};`}
        ></span>
        <span class="col-span-3 min-w-0 truncate">{colorLabel("default")}</span>
      </button>
      <div class="mt-1 grid justify-center gap-2" style="grid-template-columns: repeat(4, 1.375rem);">
        {#each EVENT_COLOR_OPTIONS as slot}
          <button
            type="button"
            {disabled}
            class={cn(
              "project-icon-color-swatch relative size-5.5 rounded-full",
              color === slot && "swatch-selected",
            )}
            style={`background-color: ${colorSwatch(slot)};`}
            aria-label={colorLabel(slot)}
            data-app-tooltip-disabled="true"
            onclick={(event) => {
              event.stopPropagation();
              onSelect(slot);
              open = false;
            }}
          ></button>
        {/each}
      </div>
      <div class="mx-1.5 mt-2 h-px bg-border/70" aria-hidden="true"></div>
      <button
        type="button"
        {disabled}
        role="switch"
        aria-checked={askEveryTime}
        class="mt-1 flex h-8 w-full items-center justify-between rounded-md px-1.5 text-left text-[0.8rem] text-foreground hover:bg-accent"
        onclick={(event) => {
          event.stopPropagation();
          onAskEveryTimeChange(!askEveryTime);
        }}
      >
        <span>{t("projects.iconPicker.askEveryTime")}</span>
        <span
          class={cn(
            "flex h-4 w-7 shrink-0 items-center rounded-full p-0.5",
            askEveryTime ? "justify-end bg-primary" : "justify-start bg-muted-foreground/30",
          )}
        >
          <span class="h-3 w-3 rounded-full bg-background shadow-sm"></span>
        </span>
      </button>
    </div>
  {/if}
</div>

<style>
  .project-icon-color-swatch {
    overflow: hidden;
  }

  .project-icon-color-swatch.swatch-selected::after {
    content: "";
    position: absolute;
    inset: 0;
    border: 2px solid var(--project-icon-color-selection-border);
    border-radius: inherit;
    pointer-events: none;
  }
</style>
