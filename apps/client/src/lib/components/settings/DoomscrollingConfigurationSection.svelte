<script lang="ts">
  import type { DoomscrollingMode } from "$lib/doomscrolling";
  import { cn } from "$lib/utils";
  import DoomscrollingModeSelector from "./DoomscrollingModeSelector.svelte";
  import ToggleSetting from "./ToggleSetting.svelte";

  type ScheduleToggle = "enabled" | "focus" | "shortBreaks" | "longBreaks";

  let {
    title,
    enabled,
    blockDuringFocus,
    blockDuringShortBreaks,
    blockDuringLongBreaks,
    mode = "blacklist",
    enabledLabel,
    enabledDescription,
    focusDescription,
    shortBreakDescription,
    longBreakDescription,
    showMode = true,
    modeHeading = "Website mode",
    modeDescription = "Choose how listed websites are handled",
    blacklistDescription = "Blocks listed websites",
    whitelistDescription = "Only allows listed websites",
    onScheduleChange,
    onModeChange,
  }: {
    title: string;
    enabled: boolean;
    blockDuringFocus: boolean;
    blockDuringShortBreaks: boolean;
    blockDuringLongBreaks: boolean;
    mode?: DoomscrollingMode;
    enabledLabel: string;
    enabledDescription: string;
    focusDescription: string;
    shortBreakDescription: string;
    longBreakDescription: string;
    showMode?: boolean;
    modeHeading?: string;
    modeDescription?: string;
    blacklistDescription?: string;
    whitelistDescription?: string;
    onScheduleChange: (toggle: ScheduleToggle, checked: boolean) => void;
    onModeChange?: (mode: DoomscrollingMode) => void;
  } = $props();
</script>

<section class="flex flex-col gap-4">
  <h2 class="px-1 text-[0.866667rem] font-semibold text-foreground">{title}</h2>
  <div class="flex flex-col gap-3">
    <ToggleSetting
      label={enabledLabel}
      description={enabledDescription}
      checked={enabled}
      onChange={(checked) => onScheduleChange("enabled", checked)}
    />

    <fieldset
      disabled={!enabled}
      aria-disabled={!enabled}
      class={cn(
        "m-0 flex min-w-0 flex-col gap-4 border-0 p-0 transition-opacity",
        !enabled && "opacity-50",
      )}
    >
      <div class="flex flex-col gap-3" aria-label="Blocking schedule">
        <ToggleSetting
          label="Block during focus"
          description={focusDescription}
          checked={blockDuringFocus}
          onChange={(checked) => onScheduleChange("focus", checked)}
        />
        <ToggleSetting
          label="Block during short breaks"
          description={shortBreakDescription}
          checked={blockDuringShortBreaks}
          onChange={(checked) => onScheduleChange("shortBreaks", checked)}
        />
        <ToggleSetting
          label="Block during long breaks"
          description={longBreakDescription}
          checked={blockDuringLongBreaks}
          onChange={(checked) => onScheduleChange("longBreaks", checked)}
        />
      </div>

      {#if showMode && onModeChange}
        <div class="flex flex-col gap-2 px-1">
          <div class="min-w-0">
            <h3 class="text-[0.866667rem] text-foreground">{modeHeading}</h3>
            <div class="mt-0.5 text-[0.8rem] text-muted-foreground">
              {modeDescription}
            </div>
          </div>
          <DoomscrollingModeSelector
            {mode}
            {blacklistDescription}
            {whitelistDescription}
            onChange={onModeChange}
          />
        </div>
      {/if}
    </fieldset>
  </div>
</section>
