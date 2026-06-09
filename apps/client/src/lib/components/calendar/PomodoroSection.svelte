<script lang="ts">
  import { tick } from "svelte";
  import { slide } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import { commitIntegerDraft, moveRovingIndex, panelInputKeydown } from "./event-panel-utils";
  import Timer from "@lucide/svelte/icons/timer";
  import Plus from "@lucide/svelte/icons/plus";
  import CopyIcon from "@lucide/svelte/icons/copy";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import ArrowUp from "@lucide/svelte/icons/arrow-up";
  import ArrowDown from "@lucide/svelte/icons/arrow-down";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import {
    COUNT_PRESET_RHYTHMS,
    MAX_FOCUS_MINUTES,
    MAX_LONG_BREAK_MINUTES,
    MAX_RHYTHM_POSITIONS,
    MAX_SHORT_BREAK_MINUTES,
    MIN_FOCUS_MINUTES,
    MIN_LONG_BREAK_MINUTES,
    MIN_RHYTHM_POSITIONS,
    MIN_SHORT_BREAK_MINUTES,
    type PomodoroBreakPhase,
    type SequencePomodoroRhythmStep,
  } from "$lib/pomodoro/rhythm";

  type PomodoroPreset = "auto" | "deep" | "creative" | "extended" | "custom";
  type BuiltInPomodoroPreset = Exclude<PomodoroPreset, "custom">;
  type CustomRhythmMode = "simple" | "sequence";

  const POMO_PRESETS = COUNT_PRESET_RHYTHMS;
  const POMO_PRESET_ENTRIES = Object.entries(POMO_PRESETS) as Array<[
    BuiltInPomodoroPreset,
    typeof POMO_PRESETS[BuiltInPomodoroPreset],
  ]>;
  const POMO_OPTION_COUNT = POMO_PRESET_ENTRIES.length + 1;

  let {
    enabled,
    preset = $bindable<PomodoroPreset>("auto"),
    focusDuration = $bindable(40),
    shortBreak = $bindable(5),
    longBreak = $bindable(10),
    longBreakAfterFocusCount = $bindable(4),
    customRhythmMode = $bindable<CustomRhythmMode>("simple"),
    sequenceSteps = $bindable<SequencePomodoroRhythmStep[]>([]),
    idleTimeoutEnabled = $bindable(true),
    expanded,
    readonlyInteractive = false,
    ontoggle,
    onexpand,
    onchange,
  }: {
    enabled: boolean;
    preset: PomodoroPreset;
    focusDuration: number;
    shortBreak: number;
    longBreak: number;
    longBreakAfterFocusCount: number;
    customRhythmMode: CustomRhythmMode;
    sequenceSteps: SequencePomodoroRhythmStep[];
    idleTimeoutEnabled: boolean;
    expanded: boolean;
    readonlyInteractive?: boolean;
    ontoggle: () => void;
    onexpand: () => void;
    onchange: () => void;
  } = $props();

  const { t } = getLocalization();
  let sectionEl: HTMLDivElement | undefined = $state();
  let presetFocusIndex = $state(0);
  let focusDurationDraft = $state("40");
  let shortBreakDraft = $state("5");
  let longBreakDraft = $state("10");
  let longBreakAfterDraft = $state("4");

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
    longBreakAfterDraft = String(longBreakAfterFocusCount);
  });

  $effect(() => {
    const index = preset === "custom"
      ? POMO_PRESET_ENTRIES.length
      : POMO_PRESET_ENTRIES.findIndex(([key]) => key === preset);
    if (index >= 0) presetFocusIndex = index;
  });

  const localizedPresetEntries = $derived(
    POMO_PRESET_ENTRIES.map(([key, val]) => ({
      key,
      label: presetLabel(key),
      desc: presetDescription(key, val),
    })),
  );

  const customFields = $derived([
    {
      label: t("calendar.pomodoro.focus"),
      value: focusDurationDraft,
      setDraft: (v: string) => { focusDurationDraft = v; },
      commit: commitFocusDurationDraft,
      restore: () => { focusDurationDraft = String(focusDuration); },
      min: MIN_FOCUS_MINUTES,
      max: MAX_FOCUS_MINUTES,
    },
    {
      label: t("calendar.pomodoro.shortBreak"),
      value: shortBreakDraft,
      setDraft: (v: string) => { shortBreakDraft = v; },
      commit: commitShortBreakDraft,
      restore: () => { shortBreakDraft = String(shortBreak); },
      min: MIN_SHORT_BREAK_MINUTES,
      max: MAX_SHORT_BREAK_MINUTES,
    },
    {
      label: t("calendar.pomodoro.longBreak"),
      value: longBreakDraft,
      setDraft: (v: string) => { longBreakDraft = v; },
      commit: commitLongBreakDraft,
      restore: () => { longBreakDraft = String(longBreak); },
      min: MIN_LONG_BREAK_MINUTES,
      max: MAX_LONG_BREAK_MINUTES,
    },
    {
      label: t("calendar.pomodoro.longBreakAfter"),
      value: longBreakAfterDraft,
      setDraft: (v: string) => { longBreakAfterDraft = v; },
      commit: commitLongBreakAfterDraft,
      restore: () => { longBreakAfterDraft = String(longBreakAfterFocusCount); },
      min: MIN_RHYTHM_POSITIONS,
      max: MAX_RHYTHM_POSITIONS,
    },
  ]);

  const summary = $derived.by(() => {
    if (!enabled) return "";
    if (preset === "custom") {
      if (customRhythmMode === "sequence") {
        return t("calendar.pomodoro.sequenceSummary", sequenceSteps.length);
      }
      return t("calendar.pomodoro.customSummary", focusDuration, shortBreak, longBreak);
    }
    return presetLabel(preset) ?? t("calendar.pomodoro.custom");
  });
  const readonlyInteractiveClass = $derived(readonlyInteractive ? "readonly-interactive" : "");
  const readonlyInteractiveInputClass = $derived(
    readonlyInteractive ? "readonly-interactive-input" : "",
  );

  function presetLabel(p: BuiltInPomodoroPreset): string {
    if (p === "auto") return t("calendar.pomodoro.automatic");
    if (p === "deep") return t("calendar.pomodoro.deepFocus");
    if (p === "creative") return t("calendar.pomodoro.creative");
    return t("calendar.pomodoro.extended");
  }

  function presetDescription(
    p: BuiltInPomodoroPreset,
    val: typeof COUNT_PRESET_RHYTHMS[BuiltInPomodoroPreset],
  ): string {
    if (p === "auto") return t("calendar.pomodoro.default");
    return t(
      "calendar.pomodoro.durationSummary",
      val.focusDurationMinutes,
      val.shortBreakMinutes,
      val.longBreakMinutes,
    );
  }

  function applyPreset(p: PomodoroPreset) {
    preset = p;
    if (p !== "custom") {
      const vals = POMO_PRESETS[p];
      focusDuration = vals.focusDurationMinutes;
      shortBreak = vals.shortBreakMinutes;
      longBreak = vals.longBreakMinutes;
      longBreakAfterFocusCount = vals.longBreakAfterFocusCount;
      customRhythmMode = "simple";
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
    const result = commitIntegerDraft(
      focusDurationDraft,
      focusDuration,
      MIN_FOCUS_MINUTES,
      MAX_FOCUS_MINUTES,
    );
    focusDurationDraft = String(result.value);
    if (!result.committed) return;
    focusDuration = result.value;
    onchange();
  }

  function commitShortBreakDraft() {
    const result = commitIntegerDraft(
      shortBreakDraft,
      shortBreak,
      MIN_SHORT_BREAK_MINUTES,
      MAX_SHORT_BREAK_MINUTES,
    );
    shortBreakDraft = String(result.value);
    if (!result.committed) return;
    shortBreak = result.value;
    onchange();
  }

  function commitLongBreakDraft() {
    const result = commitIntegerDraft(
      longBreakDraft,
      longBreak,
      MIN_LONG_BREAK_MINUTES,
      MAX_LONG_BREAK_MINUTES,
    );
    longBreakDraft = String(result.value);
    if (!result.committed) return;
    longBreak = result.value;
    onchange();
  }

  function commitLongBreakAfterDraft() {
    const result = commitIntegerDraft(
      longBreakAfterDraft,
      longBreakAfterFocusCount,
      MIN_RHYTHM_POSITIONS,
      MAX_RHYTHM_POSITIONS,
    );
    longBreakAfterDraft = String(result.value);
    if (!result.committed) return;
    longBreakAfterFocusCount = result.value;
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

  function clampMinutes(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, Math.round(value)));
  }

  function sequenceBreakMax(phase: PomodoroBreakPhase): number {
    return phase === "long_break" ? MAX_LONG_BREAK_MINUTES : MAX_SHORT_BREAK_MINUTES;
  }

  function sequenceBreakMin(phase: PomodoroBreakPhase): number {
    return phase === "long_break" ? MIN_LONG_BREAK_MINUTES : MIN_SHORT_BREAK_MINUTES;
  }

  function updateStep(index: number, patch: Partial<SequencePomodoroRhythmStep>) {
    sequenceSteps = sequenceSteps.map((step, stepIndex) => {
      if (stepIndex !== index) return step;
      const nextPhase = patch.breakPhase ?? step.breakPhase;
      return {
        focusDurationMinutes: clampMinutes(
          patch.focusDurationMinutes ?? step.focusDurationMinutes,
          MIN_FOCUS_MINUTES,
          MAX_FOCUS_MINUTES,
        ),
        breakPhase: nextPhase,
        breakDurationMinutes: clampMinutes(
          patch.breakDurationMinutes ?? step.breakDurationMinutes,
          sequenceBreakMin(nextPhase),
          sequenceBreakMax(nextPhase),
        ),
      };
    });
    onchange();
  }

  function ensureSequenceStep(): SequencePomodoroRhythmStep {
    return {
      focusDurationMinutes: focusDuration,
      breakPhase: "short_break",
      breakDurationMinutes: shortBreak,
    };
  }

  function setCustomRhythmMode(mode: CustomRhythmMode) {
    customRhythmMode = mode;
    if (mode === "sequence" && sequenceSteps.length === 0) {
      sequenceSteps = [ensureSequenceStep()];
    }
    onchange();
  }

  function addStep() {
    if (sequenceSteps.length >= MAX_RHYTHM_POSITIONS) return;
    sequenceSteps = [...sequenceSteps, ensureSequenceStep()];
    onchange();
  }

  function deleteStep(index: number) {
    if (sequenceSteps.length <= MIN_RHYTHM_POSITIONS) return;
    sequenceSteps = sequenceSteps.filter((_, stepIndex) => stepIndex !== index);
    onchange();
  }

  function duplicateStep(index: number) {
    if (sequenceSteps.length >= MAX_RHYTHM_POSITIONS) return;
    const step = sequenceSteps[index];
    if (!step) return;
    sequenceSteps = [
      ...sequenceSteps.slice(0, index + 1),
      { ...step },
      ...sequenceSteps.slice(index + 1),
    ];
    onchange();
  }

  function moveStep(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= sequenceSteps.length) return;
    const next = [...sequenceSteps];
    const current = next[index];
    const other = next[target];
    if (!current || !other) return;
    next[index] = other;
    next[target] = current;
    sequenceSteps = next;
    onchange();
  }
</script>

<div bind:this={sectionEl} class="flex flex-col overflow-hidden rounded-none" style="background-color: var(--panel-contrast);">
  <div class="section-header flex items-stretch">
    <button onclick={ontoggle}
      class="flex w-10 shrink-0 items-center justify-center
        {readonlyInteractiveClass}
        {enabled ? 'bg-black/3 text-foreground dark:bg-black/30' : 'text-muted-foreground/50'}">
      <Timer size={14} />
    </button>
    <button onclick={onexpand}
      class="flex flex-1 items-center gap-2.5 px-3 py-2 text-left {readonlyInteractiveClass}">
      <span class="translate-y-[1.13px] text-[0.8rem] {enabled ? 'text-foreground' : 'text-muted-foreground'}">{t("calendar.pomodoro.title")}</span>
      <span class="ml-auto translate-y-[1.13px] truncate text-[0.733333rem] text-muted-foreground">{summary}</span>
    </button>
  </div>
  {#if expanded}
    <div transition:slide={{ duration: 180, easing: cubicOut }} data-section="pomodoro" class="flex flex-col gap-1 p-2.5" style="background-color: var(--panel-bg);">
      {#each localizedPresetEntries as { key, label, desc }, index}
        <button
          onclick={() => applyPreset(key as PomodoroPreset)}
          onfocus={() => { presetFocusIndex = index; }}
          onkeydown={(e) => handlePresetKeydown(e, index)}
          data-pomodoro-roving="preset"
          data-roving-index={index}
          tabindex={presetFocusIndex === index ? 0 : -1}
          class="flex items-center gap-2.5 rounded-none px-3 py-1.5 text-left text-[0.8rem]
            {readonlyInteractiveClass}
            {preset === key ? 'bg-black/5 text-foreground dark:bg-black/15' : 'text-foreground'}"
        >
          <span>{label}</span>
          <span class="ml-auto text-[0.733333rem] text-muted-foreground">{desc}</span>
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
          {readonlyInteractiveClass}
          {preset === 'custom' ? 'bg-black/5 text-foreground dark:bg-black/15' : 'text-foreground'}"
      >
        <span>{t("calendar.pomodoro.custom")}</span>
      </button>
      {#if preset === "custom"}
        <div class="flex gap-1 px-3 pt-1">
          <button
            onclick={() => setCustomRhythmMode("simple")}
            class="rounded-none px-2 py-1 text-[0.733333rem] {customRhythmMode === 'simple' ? 'bg-black/5 text-foreground dark:bg-black/15' : 'text-muted-foreground'} {readonlyInteractiveClass}">
            {t("calendar.pomodoro.simple")}
          </button>
          <button
            onclick={() => setCustomRhythmMode("sequence")}
            class="rounded-none px-2 py-1 text-[0.733333rem] {customRhythmMode === 'sequence' ? 'bg-black/5 text-foreground dark:bg-black/15' : 'text-muted-foreground'} {readonlyInteractiveClass}">
            {t("calendar.pomodoro.pattern")}
          </button>
        </div>
        {#if customRhythmMode === "simple"}
          <div class="flex flex-col gap-1.5 px-3 pt-1">
            {#each customFields as field}
              <label class="flex items-center gap-2 text-[0.733333rem] text-muted-foreground">
                <span class="w-24">{field.label}</span>
                <input type="number" value={field.value} min={field.min} max={field.max}
                  oninput={(e) => field.setDraft(e.currentTarget.value)}
                  onblur={field.commit}
                  class="num-input w-11 rounded bg-black/5 px-1 py-0.5 text-center text-[0.733333rem] text-event-panel-input-text outline-none dark:bg-black/15 {readonlyInteractiveInputClass}"
                  onkeydown={(e) => handleNumberDraftKeydown(e, field.commit, field.restore)} />
                <span class="text-muted-foreground">
                  {field.label === t("calendar.pomodoro.longBreakAfter")
                    ? t("calendar.pomodoro.positionsShort")
                    : t("calendar.pomodoro.minutesShort")}
                </span>
              </label>
            {/each}
          </div>
        {:else}
          <div class="flex flex-col gap-1.5 px-3 pt-1">
            {#each sequenceSteps as step, index}
              <div class="grid grid-cols-[minmax(0,1fr)_auto_auto_auto_auto_auto] items-center gap-1 text-[0.733333rem] text-muted-foreground">
                <label class="flex min-w-0 items-center gap-1">
                  <span class="shrink-0">{t("calendar.pomodoro.focus")}</span>
                  <input
                    type="number"
                    value={step.focusDurationMinutes}
                    min={MIN_FOCUS_MINUTES}
                    max={MAX_FOCUS_MINUTES}
                    onblur={(e) => updateStep(index, { focusDurationMinutes: Number(e.currentTarget.value) })}
                    onkeydown={panelInputKeydown}
                    class="num-input w-10 rounded bg-black/5 px-1 py-0.5 text-center text-[0.733333rem] text-event-panel-input-text outline-none dark:bg-black/15 {readonlyInteractiveInputClass}" />
                </label>
                <span class="text-muted-foreground">-&gt;</span>
                <select
                  value={step.breakPhase}
                  onchange={(e) => updateStep(index, { breakPhase: e.currentTarget.value as PomodoroBreakPhase })}
                  class="rounded-none bg-black/5 px-1 py-0.5 text-[0.733333rem] text-event-panel-input-text outline-none dark:bg-black/15 {readonlyInteractiveInputClass}">
                  <option value="short_break">{t("calendar.pomodoro.shortBreak")}</option>
                  <option value="long_break">{t("calendar.pomodoro.longBreak")}</option>
                </select>
                <input
                  type="number"
                  value={step.breakDurationMinutes}
                  min={sequenceBreakMin(step.breakPhase)}
                  max={sequenceBreakMax(step.breakPhase)}
                  onblur={(e) => updateStep(index, { breakDurationMinutes: Number(e.currentTarget.value) })}
                  onkeydown={panelInputKeydown}
                  class="num-input w-10 rounded bg-black/5 px-1 py-0.5 text-center text-[0.733333rem] text-event-panel-input-text outline-none dark:bg-black/15 {readonlyInteractiveInputClass}" />
                <div class="flex">
                  <button type="button" title={t("calendar.pomodoro.moveUp")} onclick={() => moveStep(index, -1)} class="icon-button {readonlyInteractiveClass}" disabled={index === 0}>
                    <ArrowUp size={12} />
                  </button>
                  <button type="button" title={t("calendar.pomodoro.moveDown")} onclick={() => moveStep(index, 1)} class="icon-button {readonlyInteractiveClass}" disabled={index === sequenceSteps.length - 1}>
                    <ArrowDown size={12} />
                  </button>
                </div>
                <div class="flex">
                  <button type="button" title={t("calendar.pomodoro.duplicateStep")} onclick={() => duplicateStep(index)} class="icon-button {readonlyInteractiveClass}" disabled={sequenceSteps.length >= MAX_RHYTHM_POSITIONS}>
                    <CopyIcon size={12} />
                  </button>
                  <button type="button" title={t("calendar.pomodoro.deleteStep")} onclick={() => deleteStep(index)} class="icon-button {readonlyInteractiveClass}" disabled={sequenceSteps.length <= MIN_RHYTHM_POSITIONS}>
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            {/each}
            <button type="button" onclick={addStep} class="flex w-fit items-center gap-1 rounded-none px-2 py-1 text-[0.733333rem] text-foreground {readonlyInteractiveClass}" disabled={sequenceSteps.length >= MAX_RHYTHM_POSITIONS}>
              <Plus size={12} />
              <span>{t("calendar.pomodoro.addStep")}</span>
            </button>
          </div>
        {/if}
      {/if}
      <div class="mt-1 border-t border-border/40 px-0 pt-0.5">
        <button
          onclick={() => { idleTimeoutEnabled = !idleTimeoutEnabled; onchange(); }}
          class="flex w-full items-center gap-2.5 rounded-none px-2.5 py-1.5 text-left text-[0.8rem] text-foreground {readonlyInteractiveClass}"
        >
          <div class="size-3 shrink-0
            {idleTimeoutEnabled ? 'bg-form-indicator' : 'border border-muted-foreground/40'}">
          </div>
          <span>{t("calendar.pomodoro.pauseOnInactivity")}</span>
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
  .icon-button {
    display: inline-flex;
    height: 1.35rem;
    width: 1.35rem;
    align-items: center;
    justify-content: center;
    color: hsl(var(--muted-foreground));
  }
  .icon-button:disabled {
    opacity: 0.35;
  }
</style>
