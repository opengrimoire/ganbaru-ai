<script lang="ts">
  import type { CalendarEvent, EventColor, PomodoroConfig, RecurringScope, RepeatRule } from "./types";
  import { EVENT_COLOR_OPTIONS, getEventColor } from "./utils";
  import { getTheme } from "$lib/stores/theme.svelte";
  import X from "@lucide/svelte/icons/x";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import Repeat from "@lucide/svelte/icons/repeat";
  import Bell from "@lucide/svelte/icons/bell";
  import Timer from "@lucide/svelte/icons/timer";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";

  const theme = getTheme();

  const PANEL_WIDTH = 300;
  const PANEL_GAP = 8;

  let {
    mode,
    start,
    end,
    event,
    anchor,
    onSave,
    onDelete,
    onClose,
    onChange,
    onScopeChange,
  }: {
    mode: "create" | "edit";
    start?: string;
    end?: string;
    event?: CalendarEvent;
    anchor: { x: number; y: number; width: number; height: number };
    onSave: (data: {
      title: string;
      start: string;
      end: string;
      color?: EventColor;
      description: string;
      repeatRule: RepeatRule;
      notificationMinutes?: number;
      pomodoroConfig: PomodoroConfig;
    }, scope?: RecurringScope) => void;
    onDelete?: (id: string, scope?: RecurringScope) => void;
    onClose: () => void;
    onChange?: (data: Partial<CalendarEvent>) => void;
    onScopeChange?: (scope: RecurringScope) => void;
  } = $props();

  let title = $state("");
  let startTime = $state("");
  let endTime = $state("");
  let startDate = $state("");
  let color: EventColor | undefined = $state(undefined);
  let description = $state("");
  let repeatRule: RepeatRule = $state("none");
  let notificationMinutes: number | undefined = $state(undefined);
  let focusDuration = $state(40);
  let shortBreak = $state(5);
  let longBreak = $state(10);
  let pomodoroCount = $state(4);

  let openDropdown: "repeat" | "notification" | "pomodoro" | null = $state(null);
  let scope: RecurringScope = $state("this");

  let titleInput: HTMLInputElement | undefined = $state();
  let panelEl: HTMLDivElement | undefined = $state();

  // Refs for measuring pill button positions (for fixed dropdowns)
  let repeatBtnEl: HTMLButtonElement | undefined = $state();
  let notifBtnEl: HTMLButtonElement | undefined = $state();
  let pomoBtnEl: HTMLButtonElement | undefined = $state();

  const isRecurring = $derived(
    mode === "edit" && !!event && (!!event.recurringParentId || (!!event.repeatRule && event.repeatRule !== "none")),
  );

  const REPEAT_OPTIONS: { value: RepeatRule; label: string }[] = [
    { value: "none", label: "No repeat" },
    { value: "daily", label: "Daily" },
    { value: "weekdays", label: "Weekdays" },
    { value: "weekly", label: "Weekly" },
    { value: "monthly", label: "Monthly" },
    { value: "yearly", label: "Yearly" },
  ];

  const NOTIFICATION_OPTIONS: { value: number | undefined; label: string }[] = [
    { value: undefined, label: "None" },
    { value: 0, label: "At start" },
    { value: 5, label: "5 min before" },
    { value: 10, label: "10 min before" },
    { value: 15, label: "15 min before" },
    { value: 30, label: "30 min before" },
    { value: 60, label: "1 hour before" },
    { value: 1440, label: "1 day before" },
  ];

  // Reinitialize when props change
  $effect(() => {
    if (mode === "edit" && event) {
      title = event.title;
      startDate = event.start.split(" ")[0] ?? "";
      startTime = event.start.split(" ")[1] ?? "";
      endTime = event.end.split(" ")[1] ?? "";
      color = event.color;
      description = event.description ?? "";
      repeatRule = event.repeatRule ?? "none";
      notificationMinutes = event.notificationMinutes;
      focusDuration = event.pomodoroConfig?.focusDurationMinutes ?? 40;
      shortBreak = event.pomodoroConfig?.shortBreakMinutes ?? 5;
      longBreak = event.pomodoroConfig?.longBreakMinutes ?? 10;
      pomodoroCount = event.pomodoroConfig?.pomodoroCount ?? 4;
    } else if (mode === "create") {
      title = "";
      startDate = (start ?? "").split(" ")[0] ?? "";
      startTime = (start ?? "").split(" ")[1] ?? "";
      endTime = (end ?? "").split(" ")[1] ?? "";
      color = undefined;
      description = "";
      repeatRule = "none";
      notificationMinutes = undefined;
      focusDuration = 40;
      shortBreak = 5;
      longBreak = 10;
      pomodoroCount = 4;
    }
    openDropdown = null;
    scope = "this";
  });

  function emitChange() {
    onChange?.({
      title: title.trim(),
      start: `${startDate} ${startTime}`,
      end: `${startDate} ${endTime}`,
      color,
      description,
      repeatRule,
      notificationMinutes,
      pomodoroConfig: {
        focusDurationMinutes: focusDuration,
        shortBreakMinutes: shortBreak,
        longBreakMinutes: longBreak,
        pomodoroCount,
      },
    });
  }

  // Auto-focus title in create mode
  $effect(() => {
    if (mode === "create" && titleInput) {
      titleInput.select();
    }
  });

  // Compute position: prefer right of anchor, flip left if no room, clamp vertically
  const panelStyle = $derived.by(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left: number;
    const rightSpace = vw - anchor.x - PANEL_GAP;
    const leftSpace = anchor.x - anchor.width - PANEL_GAP;

    if (rightSpace >= PANEL_WIDTH) {
      left = anchor.x + PANEL_GAP;
    } else if (leftSpace >= PANEL_WIDTH) {
      left = anchor.x - anchor.width - PANEL_GAP - PANEL_WIDTH;
    } else {
      left = Math.max(PANEL_GAP, (vw - PANEL_WIDTH) / 2);
    }

    const panelHeight = 420;
    let top = anchor.y;
    if (top + panelHeight > vh - PANEL_GAP) {
      top = vh - PANEL_GAP - panelHeight;
    }
    if (top < PANEL_GAP) top = PANEL_GAP;

    return `position: fixed; left: ${left}px; top: ${top}px; width: ${PANEL_WIDTH}px; z-index: 50;`;
  });

  const colorEntry = $derived(getEventColor(color, theme.isDark));
  const borderColor = $derived(color ? colorEntry.border : "var(--border)");

  const shortDate = $derived.by(() => {
    if (!startDate) return "";
    const [y, m, d] = startDate.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  });

  const repeatLabel = $derived(
    REPEAT_OPTIONS.find((o) => o.value === repeatRule)?.label ?? "No repeat",
  );

  const notificationLabel = $derived(
    NOTIFICATION_OPTIONS.find((o) => o.value === notificationMinutes)?.label ?? "None",
  );

  const pomodoroLabel = $derived(`${focusDuration}/${shortBreak}/${longBreak}`);

  function buildSaveData() {
    let st = startTime;
    let et = endTime;
    if (et < st) [st, et] = [et, st];
    return {
      title: title.trim() || "Focus session",
      start: `${startDate} ${st}`,
      end: `${startDate} ${et}`,
      color,
      description,
      repeatRule,
      notificationMinutes,
      pomodoroConfig: {
        focusDurationMinutes: focusDuration,
        shortBreakMinutes: shortBreak,
        longBreakMinutes: longBreak,
        pomodoroCount,
      },
    };
  }

  function handleSave() {
    onSave(buildSaveData(), isRecurring ? scope : undefined);
  }

  function handleDeleteClick() {
    if (event && onDelete) onDelete(event.id, isRecurring ? scope : undefined);
  }

  function handleScopeClick(s: RecurringScope) {
    scope = s;
    onScopeChange?.(s);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (openDropdown) {
        openDropdown = null;
      } else {
        handleSave();
      }
    }
    if (e.key === "Escape") {
      e.preventDefault();
      if (openDropdown) {
        openDropdown = null;
      } else {
        onClose();
      }
    }
  }

  function toggleDropdown(which: "repeat" | "notification" | "pomodoro") {
    openDropdown = openDropdown === which ? null : which;
  }

  /** Get fixed position for a dropdown anchored below a button element. */
  function dropdownPos(btnEl: HTMLButtonElement | undefined): string {
    if (!btnEl) return "";
    const r = btnEl.getBoundingClientRect();
    return `position: fixed; left: ${r.left}px; top: ${r.bottom + 4}px; z-index: 60;`;
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={panelEl}
  class="rounded-lg border bg-card shadow-xl"
  style="{panelStyle} border-color: {borderColor};"
  onclick={(e) => e.stopPropagation()}
  onkeydown={handleKeydown}
>
  <!-- Color accent bar -->
  <div class="h-1.5 rounded-t-lg" style="background-color: {color ? colorEntry.border : 'var(--primary)'};"></div>

  <div class="flex flex-col gap-2.5 p-3">
    <!-- Header row -->
    <div class="flex items-center justify-end gap-1">
      {#if mode === "edit" && onDelete && event}
        <button
          onclick={handleDeleteClick}
          class="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          title="Delete"
        >
          <Trash2 size={14} />
        </button>
      {/if}
      <button
        onclick={onClose}
        class="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <X size={14} />
      </button>
    </div>

    <!-- Scope selector for recurring events -->
    {#if isRecurring}
      <div class="flex rounded-md border border-border overflow-hidden">
        {#each [["this", "This event"], ["following", "Following"], ["all", "All events"]] as [value, label]}
          <button
            onclick={() => handleScopeClick(value as RecurringScope)}
            class="flex-1 px-2 py-1 text-[11px] font-medium transition-colors {scope === value
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground'}"
          >
            {label}
          </button>
        {/each}
      </div>
    {/if}

    <!-- Title input with color dot -->
    <div class="flex items-center gap-2">
      <div
        class="h-3 w-3 shrink-0 rounded-full"
        style="background-color: {color ? colorEntry.border : 'var(--primary)'};"
      ></div>
      <input
        bind:this={titleInput}
        type="text"
        bind:value={title}
        placeholder="Session title..."
        class="min-w-0 flex-1 border-b border-transparent bg-transparent py-0.5 text-sm font-medium text-foreground outline-none focus:border-b-border"
        oninput={emitChange}
        onkeydown={(e) => e.stopPropagation()}
      />
    </div>

    <!-- Date + time row -->
    <div class="flex items-center gap-2">
      <span class="shrink-0 text-xs text-muted-foreground">{shortDate}</span>
      <input
        type="time"
        bind:value={startTime}
        oninput={emitChange}
        class="w-[72px] rounded border border-border bg-background px-1.5 py-1 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
      />
      <span class="text-xs text-muted-foreground">-</span>
      <input
        type="time"
        bind:value={endTime}
        oninput={emitChange}
        class="w-[72px] rounded border border-border bg-background px-1.5 py-1 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
      />
    </div>

    <!-- Color picker -->
    <div class="flex items-center gap-2">
      {#each EVENT_COLOR_OPTIONS as c}
        {@const entry = getEventColor(c, theme.isDark)}
        <button
          onclick={() => { color = color === c ? undefined : c; emitChange(); }}
          class="h-[18px] w-[18px] shrink-0 rounded-full transition-all"
          style="background-color: {entry.border}; {color === c ? `box-shadow: 0 0 0 2px var(--card), 0 0 0 3.5px ${entry.border}; transform: scale(1.15);` : ''}"
          title={c}
        ></button>
      {/each}
    </div>

    <!-- Description -->
    <textarea
      bind:value={description}
      rows={2}
      placeholder="Add description..."
      class="w-full resize-none rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
      oninput={emitChange}
      onkeydown={(e) => e.stopPropagation()}
    ></textarea>

    <!-- Pill buttons row -->
    <div class="flex flex-wrap gap-1.5">
      <!-- Repeat button -->
      <button
        bind:this={repeatBtnEl}
        onclick={() => toggleDropdown("repeat")}
        class="flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] transition-colors {repeatRule !== 'none'
          ? 'border-primary/40 bg-primary/10 text-primary'
          : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'}"
      >
        <Repeat size={12} />
        <span>{repeatLabel}</span>
        <ChevronDown size={10} class="opacity-50" />
      </button>

      <!-- Notification button -->
      <button
        bind:this={notifBtnEl}
        onclick={() => toggleDropdown("notification")}
        class="flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] transition-colors {notificationMinutes !== undefined
          ? 'border-primary/40 bg-primary/10 text-primary'
          : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'}"
      >
        <Bell size={12} />
        <span>{notificationLabel}</span>
        <ChevronDown size={10} class="opacity-50" />
      </button>

      <!-- Pomodoro button -->
      <button
        bind:this={pomoBtnEl}
        onclick={() => toggleDropdown("pomodoro")}
        class="flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] transition-colors {openDropdown === 'pomodoro'
          ? 'border-primary/40 bg-primary/10 text-primary'
          : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'}"
      >
        <Timer size={12} />
        <span>{pomodoroLabel}</span>
        <ChevronDown size={10} class="opacity-50" />
      </button>
    </div>

    <!-- Save / cancel -->
    <div class="flex items-center gap-2 pt-0.5">
      <button
        onclick={handleSave}
        class="flex-1 rounded-md py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
        style="background-color: {color ? colorEntry.border : 'var(--primary)'};"
      >
        Save
      </button>
      <button
        onclick={onClose}
        class="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        Cancel
      </button>
    </div>
  </div>
</div>

<!-- Fixed-position dropdowns (rendered outside panel to avoid clipping) -->
{#if openDropdown === "repeat"}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="w-36 rounded-md border border-border bg-card py-1 shadow-lg"
    style={dropdownPos(repeatBtnEl)}
    onclick={(e) => e.stopPropagation()}
  >
    {#each REPEAT_OPTIONS as opt}
      <button
        onclick={() => { repeatRule = opt.value; openDropdown = null; emitChange(); }}
        class="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent {repeatRule === opt.value ? 'font-medium text-primary' : 'text-foreground'}"
      >
        {opt.label}
      </button>
    {/each}
  </div>
{/if}

{#if openDropdown === "notification"}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="w-36 rounded-md border border-border bg-card py-1 shadow-lg"
    style={dropdownPos(notifBtnEl)}
    onclick={(e) => e.stopPropagation()}
  >
    {#each NOTIFICATION_OPTIONS as opt}
      <button
        onclick={() => { notificationMinutes = opt.value; openDropdown = null; emitChange(); }}
        class="flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent {notificationMinutes === opt.value ? 'font-medium text-primary' : 'text-foreground'}"
      >
        {opt.label}
      </button>
    {/each}
  </div>
{/if}

{#if openDropdown === "pomodoro"}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="w-48 rounded-md border border-border bg-card p-2.5 shadow-lg"
    style={dropdownPos(pomoBtnEl)}
    onclick={(e) => e.stopPropagation()}
  >
    <div class="flex flex-col gap-2">
      <label class="flex items-center justify-between text-xs text-foreground">
        Focus (min)
        <input
          type="number"
          bind:value={focusDuration}
          min={1}
          max={120}
          oninput={emitChange}
          class="w-14 rounded border border-border bg-background px-1.5 py-0.5 text-right text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
        />
      </label>
      <label class="flex items-center justify-between text-xs text-foreground">
        Short break (min)
        <input
          type="number"
          bind:value={shortBreak}
          min={1}
          max={30}
          oninput={emitChange}
          class="w-14 rounded border border-border bg-background px-1.5 py-0.5 text-right text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
        />
      </label>
      <label class="flex items-center justify-between text-xs text-foreground">
        Long break (min)
        <input
          type="number"
          bind:value={longBreak}
          min={1}
          max={60}
          oninput={emitChange}
          class="w-14 rounded border border-border bg-background px-1.5 py-0.5 text-right text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
        />
      </label>
    </div>
  </div>
{/if}
