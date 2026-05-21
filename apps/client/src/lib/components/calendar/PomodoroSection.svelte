<script lang="ts">
  import { tick } from "svelte";
  import { slide } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import { commitIntegerDraft, moveRovingIndex, panelInputKeydown } from "./event-panel-utils";
  import Timer from "@lucide/svelte/icons/timer";

  type PomodoroPreset = "auto" | "deep" | "creative" | "extended" | "custom";
  type BuiltInPomodoroPreset = Exclude<PomodoroPreset, "custom">;

  const POMO_PRESETS: Record<BuiltInPomodoroPreset, { focus: number; short: number; long: number; label: string; desc: string }> = {
    auto: { focus: 40, short: 5, long: 10, label: "Automatic", desc: "Default" },
    deep: { focus: 40, short: 5, long: 10, label: "Deep focus", desc: "F 40 / SB 5 / LB 10" },
    creative: { focus: 25, short: 5, long: 15, label: "Creative", desc: "F 25 / SB 5 / LB 15" },
    extended: { focus: 50, short: 10, long: 10, label: "Extended", desc: "F 50 / SB 10 / LB 10" },
  };
  const POMO_PRESET_ENTRIES = Object.entries(POMO_PRESETS) as Array<[BuiltInPomodoroPreset, typeof POMO_PRESETS[BuiltInPomodoroPreset]]>;
  const POMO_OPTION_COUNT = POMO_PRESET_ENTRIES.length + 1;

  let {
    enabled,
    preset = $bindable<PomodoroPreset>("auto"),
    focusDuration = $bindable(40),
    shortBreak = $bindable(5),
    longBreak = $bindable(10),
    idleTimeoutEnabled = $bindable(true),
    expanded,
    ontoggle,
    onexpand,
    onchange,
  }: {
    enabled: boolean;
    preset: PomodoroPreset;
    focusDuration: number;
    shortBreak: number;
    longBreak: number;
    idleTimeoutEnabled: boolean;
    expanded: boolean;
    ontoggle: () => void;
    onexpand: () => void;
    onchange: () => void;
  } = $props();

  let sectionEl: HTMLDivElement | undefined = $state();
  let presetFocusIndex = $state(0);
  let focusDurationDraft = $state("40");
  let shortBreakDraft = $state("5");
  let longBreakDraft = $state("10");

  $effect(() => {
    focusDurationDraft = String(focusDuration);
  });

  $effect(() => {
    shortBreakDraft = String(shortBreak);
  });

  $effect(() => {
    longBreakDraft = String(longBreak);
  });

  $effect(() => {
    const index = preset === "custom"
      ? POMO_PRESET_ENTRIES.length
      : POMO_PRESET_ENTRIES.findIndex(([key]) => key === preset);
    if (index >= 0) presetFocusIndex = index;
  });

  function applyPreset(p: PomodoroPreset) {
    preset = p;
    if (p !== "custom") {
      const vals = POMO_PRESETS[p];
      focusDuration = vals.focus;
      shortBreak = vals.short;
      longBreak = vals.long;
    }
    onchange();
  }

  async function focusPresetButton(index: number) {
    await tick();
    sectionEl
      ?.querySelector<HTMLButtonElement>(`[data-pomodoro-roving="preset"][data-roving-index="${index}"]`)
      ?.focus();
  }

  function handlePresetKeydown(e: KeyboardEvent, index: number) {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const nextIndex = moveRovingIndex({
      currentIndex: index,
      itemCount: POMO_OPTION_COUNT,
      key: e.key,
      orientation: "vertical",
    });
    if (nextIndex === index) return;
    e.preventDefault();
    e.stopPropagation();
    presetFocusIndex = nextIndex;
    void focusPresetButton(nextIndex);
  }

  function commitFocusDurationDraft() {
    const result = commitIntegerDraft(focusDurationDraft, focusDuration, 1, 120);
    focusDurationDraft = String(result.value);
    if (!result.committed) return;
    focusDuration = result.value;
    onchange();
  }

  function commitShortBreakDraft() {
    const result = commitIntegerDraft(shortBreakDraft, shortBreak, 1, 30);
    shortBreakDraft = String(result.value);
    if (!result.committed) return;
    shortBreak = result.value;
    onchange();
  }

  function commitLongBreakDraft() {
    const result = commitIntegerDraft(longBreakDraft, longBreak, 1, 60);
    longBreakDraft = String(result.value);
    if (!result.committed) return;
    longBreak = result.value;
    onchange();
  }

  function handleNumberDraftKeydown(e: KeyboardEvent, commit: () => void, restore: () => void) {
    if (!e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        commit();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        restore();
        return;
      }
    }
    panelInputKeydown(e);
  }

  const summary = $derived.by(() => {
    if (!enabled) return "";
    if (preset === "custom") return `Custom (${focusDuration}/${shortBreak}/${longBreak})`;
    return POMO_PRESETS[preset]?.label ?? "Custom";
  });
</script>

<div bind:this={sectionEl} class="flex flex-col rounded-none overflow-hidden" style="background-color: var(--panel-contrast);">
  <div class="section-header flex items-stretch">
    <button onclick={ontoggle}
      class="flex w-10 shrink-0 items-center justify-center
        {enabled ? 'bg-black/3 dark:bg-black/30 text-foreground' : 'text-muted-foreground/50'}">
      <Timer size={14} />
    </button>
    <button onclick={onexpand}
      class="flex flex-1 items-center gap-2.5 px-3 py-2 text-left">
      <span class="translate-y-[1.13px] text-[0.8rem] {enabled ? 'text-foreground' : 'text-muted-foreground'}">Pomodoro</span>
      <span class="ml-auto translate-y-[1.13px] truncate text-[0.733333rem] text-muted-foreground">{summary}</span>
    </button>
  </div>
  {#if expanded}
    <div transition:slide={{ duration: 180, easing: cubicOut }} data-section="pomodoro" class="flex flex-col gap-1 p-2.5" style="background-color: var(--panel-bg);">
      {#each POMO_PRESET_ENTRIES as [key, val], index}
        <button
          onclick={() => applyPreset(key as PomodoroPreset)}
          onfocus={() => { presetFocusIndex = index; }}
          onkeydown={(e) => handlePresetKeydown(e, index)}
          data-pomodoro-roving="preset"
          data-roving-index={index}
          tabindex={presetFocusIndex === index ? 0 : -1}
          class="flex items-center gap-2.5 rounded-none px-3 py-1.5 text-left text-[0.8rem]
            {preset === key
              ? 'bg-black/5 dark:bg-black/15 text-foreground'
              : 'text-foreground'}"
        >
          <span>{val.label}</span>
          <span class="ml-auto text-[0.733333rem] {preset === key ? 'text-muted-foreground' : 'text-muted-foreground'}">{val.desc}</span>
        </button>
      {/each}
      <button
        onclick={() => applyPreset("custom")}
        onfocus={() => { presetFocusIndex = POMO_PRESET_ENTRIES.length; }}
        onkeydown={(e) => handlePresetKeydown(e, POMO_PRESET_ENTRIES.length)}
        data-pomodoro-roving="preset"
        data-roving-index={POMO_PRESET_ENTRIES.length}
        tabindex={presetFocusIndex === POMO_PRESET_ENTRIES.length ? 0 : -1}
        class="flex items-center gap-2.5 rounded-none px-3 py-1.5 text-left text-[0.8rem]
          {preset === 'custom'
            ? 'bg-black/5 dark:bg-black/15 text-foreground'
            : 'text-foreground'}"
      >
        <span>Custom</span>
      </button>
      {#if preset === "custom"}
        <div class="flex flex-col gap-1.5 px-3 pt-1">
          {#each [
            { label: "Focus", value: focusDurationDraft, setDraft: (v: string) => { focusDurationDraft = v; }, commit: commitFocusDurationDraft, restore: () => { focusDurationDraft = String(focusDuration); }, min: 1, max: 120 },
            { label: "Short break", value: shortBreakDraft, setDraft: (v: string) => { shortBreakDraft = v; }, commit: commitShortBreakDraft, restore: () => { shortBreakDraft = String(shortBreak); }, min: 1, max: 30 },
            { label: "Long break", value: longBreakDraft, setDraft: (v: string) => { longBreakDraft = v; }, commit: commitLongBreakDraft, restore: () => { longBreakDraft = String(longBreak); }, min: 1, max: 60 },
          ] as field}
            <label class="flex items-center gap-2 text-[0.733333rem] text-muted-foreground">
              <span class="w-18">{field.label}</span>
              <input type="number" value={field.value} min={field.min} max={field.max}
                oninput={(e) => field.setDraft(e.currentTarget.value)}
                onblur={field.commit}
                class="num-input w-9 rounded bg-black/5 px-1 py-0.5 text-center text-[0.733333rem] text-event-panel-input-text outline-none dark:bg-black/15"
                onkeydown={(e) => handleNumberDraftKeydown(e, field.commit, field.restore)} />
              <span class="text-muted-foreground">min</span>
            </label>
          {/each}
        </div>
      {/if}
      <div class="mt-1 border-t border-border/40 px-0 pt-0.5">
        <button
          onclick={() => { idleTimeoutEnabled = !idleTimeoutEnabled; onchange(); }}
          class="flex w-full items-center gap-2.5 rounded-none px-2.5 py-1.5 text-left text-[0.8rem] text-foreground"
        >
          <div class="size-3 shrink-0
            {idleTimeoutEnabled ? 'bg-form-indicator' : 'border border-muted-foreground/40'}">
          </div>
          <span>Pause on inactivity</span>
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .num-input {
    -moz-appearance: textfield;
    appearance: textfield;
  }
  .num-input::-webkit-inner-spin-button,
  .num-input::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
</style>
