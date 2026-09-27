<script lang="ts">
  import type { Snippet } from "svelte";
  import { EVENT_COLOR_OPTIONS } from "$lib/components/calendar/utils";
  import type { EventColor } from "$lib/components/calendar/types";
  import type { ProjectIconPickerColor } from "$lib/projects/project-icon-picker";
  import type { ProjectLucideIconNode } from "$lib/projects/project-lucide-catalog.generated";
  import { serializeProjectIcon } from "$lib/projects/project-icons";
  import { portal } from "$lib/utils/portal";
  import LucideNodeIcon from "$lib/components/projects/LucideNodeIcon.svelte";
  import ProjectIcon from "$lib/components/projects/ProjectIcon.svelte";

  let {
    rootElement = $bindable<HTMLElement | undefined>(),
    style,
    label,
    slug = "",
    iconNode = null,
    preview,
    disabled = false,
    iconColorLabel,
    iconColorStyle,
    automaticIconColor,
    automaticLabel,
    columns,
    onSelect,
  }: {
    rootElement?: HTMLElement;
    style: string;
    label: string;
    slug?: string;
    iconNode?: readonly ProjectLucideIconNode[] | null;
    preview?: Snippet<[ProjectIconPickerColor]>;
    disabled?: boolean;
    iconColorLabel: (color: ProjectIconPickerColor) => string;
    iconColorStyle: (color: EventColor) => string;
    automaticIconColor: string;
    automaticLabel: string;
    columns: number;
    onSelect: (color: ProjectIconPickerColor) => void;
  } = $props();
</script>

<div
  bind:this={rootElement}
  use:portal
  class="fixed z-100 overflow-y-auto rounded-xl border border-border p-2.5 shadow-xl"
  {style}
  role="dialog"
  data-app-floating-surface
  aria-label={label}
>
  <button
    type="button"
    {disabled}
    class="flex h-5.5 w-full items-center justify-center gap-2 rounded-md text-[0.8rem] text-foreground hover:bg-accent"
    aria-label={automaticLabel}
    data-app-tooltip-disabled="true"
    onclick={(event) => {
      event.stopPropagation();
      onSelect("default");
    }}
  >
    <span
      class="flex size-5.5 shrink-0 items-center justify-center"
      style={`color: ${automaticIconColor};`}
    >
      {#if preview}
        {@render preview("default")}
      {:else if iconNode}
        <LucideNodeIcon {iconNode} size={16} strokeWidth={1.75} />
      {:else}
        <ProjectIcon
          name={serializeProjectIcon({ kind: "lucide", slug, color: "default" })}
          size={16}
          strokeWidth={1.75}
        />
      {/if}
    </span>
    <span class="min-w-0 truncate">{automaticLabel}</span>
  </button>
  <div class="-mx-1 mt-[0.3rem] h-px bg-border/70" aria-hidden="true"></div>
  <div class="mt-2 grid gap-2" style={`grid-template-columns: repeat(${columns}, 1.375rem);`}>
    {#each EVENT_COLOR_OPTIONS as color}
      <button
        type="button"
        {disabled}
        class="flex size-5.5 items-center justify-center rounded-md hover:bg-accent"
        aria-label={iconColorLabel(color)}
        data-app-tooltip-disabled="true"
        onclick={(event) => {
          event.stopPropagation();
          onSelect(color);
        }}
      >
        {#if preview}
          {@render preview(color)}
        {:else if iconNode}
          <LucideNodeIcon
            {iconNode}
            size={16}
            strokeWidth={1.75}
            style={iconColorStyle(color)}
          />
        {:else}
          <ProjectIcon
            name={serializeProjectIcon({ kind: "lucide", slug, color })}
            size={16}
            strokeWidth={1.75}
          />
        {/if}
      </button>
    {/each}
  </div>
</div>
