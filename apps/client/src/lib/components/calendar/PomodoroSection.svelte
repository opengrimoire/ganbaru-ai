<script lang="ts">
  import { slide } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import Timer from "@lucide/svelte/icons/timer";

  type PomodoroPreset = "auto" | "deep" | "creative" | "extended" | "custom";

  const POMO_PRESETS: Record<Exclude<PomodoroPreset, "custom">, { focus: number; short: number; long: number; label: string; desc: string }> = {
    auto: { focus: 40, short: 5, long: 10, label: "Automatic", desc: "Default" },
    deep: { focus: 40, short: 5, long: 10, label: "Deep focus", desc: "F 40 / SB 5 / LB 10" },
    creative: { focus: 25, short: 5, long: 15, label: "Creative", desc: "F 25 / SB 5 / LB 15" },
    extended: { focus: 50, short: 10, long: 10, label: "Extended", desc: "F 50 / SB 10 / LB 10" },
  };

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

  const summary = $derived.by(() => {
    if (!enabled) return "";
    if (preset === "custom") return `Custom (${focusDuration}/${shortBreak}/${longBreak})`;
    return POMO_PRESETS[preset]?.label ?? "Custom";
  });
</script>

<div class="flex flex-col rounded-none overflow-hidden" style="background-color: var(--panel-contrast);">
  <div class="section-header flex items-stretch">
    <button onclick={ontoggle}
      class="flex w-9 shrink-0 items-center justify-center
        {enabled ? 'bg-black/3 dark:bg-black/30 text-foreground' : 'text-muted-foreground/50'}">
      <Timer size={13} />
    </button>
    <button onclick={onexpand}
      class="flex flex-1 items-center gap-2 px-2.5 py-2 text-left">
      <span class="translate-y-[1.13px] text-[11px] {enabled ? 'text-foreground' : 'text-muted-foreground'}">Pomodoro</span>
      <span class="ml-auto translate-y-[1.13px] truncate text-[10px] text-muted-foreground">{summary}</span>
    </button>
  </div>
  {#if expanded}
    <div transition:slide={{ duration: 180, easing: cubicOut }} data-section="pomodoro" class="flex flex-col gap-1 p-2.5" style="background-color: var(--panel-bg);">
      {#each Object.entries(POMO_PRESETS) as [key, val]}
        <button
          onclick={() => applyPreset(key as PomodoroPreset)}
          class="flex items-center gap-2 rounded-none px-2.5 py-1.5 text-left text-[11px]
            {preset === key
              ? 'bg-black/5 dark:bg-black/15 text-foreground'
              : 'text-foreground'}"
        >
          <span>{val.label}</span>
          <span class="ml-auto text-[10px] {preset === key ? 'text-muted-foreground' : 'text-muted-foreground'}">{val.desc}</span>
        </button>
      {/each}
      <button
        onclick={() => applyPreset("custom")}
        class="flex items-center gap-2 rounded-none px-2.5 py-1.5 text-left text-[11px]
          {preset === 'custom'
            ? 'bg-black/5 dark:bg-black/15 text-foreground'
            : 'text-foreground'}"
      >
        <span>Custom</span>
      </button>
      {#if preset === "custom"}
        <div class="flex flex-col gap-1.5 px-2.5 pt-1">
          {#each [
            { label: "Focus", value: focusDuration, set: (v: number) => { focusDuration = v; onchange(); }, min: 1, max: 120 },
            { label: "Short break", value: shortBreak, set: (v: number) => { shortBreak = v; onchange(); }, min: 1, max: 30 },
            { label: "Long break", value: longBreak, set: (v: number) => { longBreak = v; onchange(); }, min: 1, max: 60 },
          ] as field}
            <label class="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span class="w-16">{field.label}</span>
              <input type="number" value={field.value} min={field.min} max={field.max}
                oninput={(e) => field.set(parseInt(e.currentTarget.value, 10) || field.min)}
                class="num-input w-8 rounded bg-black/5 dark:bg-black/15 px-0.5 py-0.5 text-center text-[10px] text-event-panel-input-text outline-none"
                onkeydown={(e) => e.stopPropagation()} />
              <span class="text-muted-foreground">min</span>
            </label>
          {/each}
        </div>
      {/if}
      <div class="border-t border-border/40 mt-1 pt-0.5 px-0">
        <button
          onclick={() => { idleTimeoutEnabled = !idleTimeoutEnabled; onchange(); }}
          class="flex items-center gap-2 rounded-none px-2 py-1.5 text-left text-[11px] w-full text-foreground"
        >
          <div class="size-2.75 shrink-0
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
