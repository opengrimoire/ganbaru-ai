<script lang="ts">
  import { tick } from "svelte";
  import { slide } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import { commitIntegerDraft, moveRovingIndex, panelInputKeydown } from "./event-panel-utils";
  import Bell from "@lucide/svelte/icons/bell";
  import X from "@lucide/svelte/icons/x";
  import Plus from "@lucide/svelte/icons/plus";
  import { formatList } from "$lib/i18n/formatters";
  import { getLocalization } from "$lib/i18n/translator.svelte";

  const NOTIF_PRESET_VALUES = [
    0,
    5,
    10,
    30,
    60,
    1440,
  ];

  const CUSTOM_UNIT_VALUES = [
    1,
    60,
    1440,
    10080,
  ];

  let {
    enabled,
    selected = $bindable(new Set<number>()),
    customNotifs = $bindable<{ amount: number; unit: number }[]>([]),
    expanded,
    ontoggle,
    onexpand,
    onchange,
  }: {
    enabled: boolean;
    selected: Set<number>;
    customNotifs: { amount: number; unit: number }[];
    expanded: boolean;
    ontoggle: () => void;
    onexpand: () => void;
    onchange: () => void;
  } = $props();

  const localization = getLocalization();
  const { t } = localization;
  const locale = $derived(localization.locale);
  const NOTIF_PRESETS = $derived.by(() =>
    NOTIF_PRESET_VALUES.map((value) => ({
      value,
      label: formatMinutes(value),
    })),
  );
  const CUSTOM_UNITS = $derived.by(() =>
    CUSTOM_UNIT_VALUES.map((value) => ({ value, label: unitLabel(value) })),
  );

  let dropdownIdx = $state<number | null>(null);
  let dropdownBtns: (HTMLButtonElement | undefined)[] = $state([]);
  let sectionEl: HTMLDivElement | undefined = $state();
  let presetFocusIndex = $state(0);
  let unitFocusIndex = $state(0);
  let customAmountDrafts = $state<string[]>([]);

  $effect(() => {
    customAmountDrafts = customNotifs.map((notif) => String(notif.amount));
  });

  function toggleNotif(minutes: number) {
    const next = new Set(selected);
    if (next.has(minutes)) next.delete(minutes);
    else next.add(minutes);
    selected = next;
    onchange();
  }

  function addCustomNotif() {
    if (customNotifs.length >= 2) return;
    customNotifs = [...customNotifs, { amount: 1, unit: 10080 }];
    onchange();
  }

  function removeCustomNotif(idx: number) {
    customNotifs = customNotifs.filter((_, i) => i !== idx);
    onchange();
  }

  function updateCustomNotif(idx: number, amount: number, unit: number) {
    customNotifs = customNotifs.map((n, i) => i === idx ? { amount, unit } : n);
    onchange();
  }

  async function focusPresetButton(index: number) {
    await tick();
    sectionEl
      ?.querySelector<HTMLButtonElement>(`[data-notification-roving="preset"][data-roving-index="${index}"]`)
      ?.focus();
  }

  async function focusDropdownButton(idx: number) {
    await tick();
    dropdownBtns[idx]?.focus();
  }

  async function focusUnitButton(index: number) {
    await tick();
    sectionEl
      ?.querySelector<HTMLButtonElement>(`[data-notification-unit-index="${index}"]`)
      ?.focus();
  }

  function handlePresetKeydown(e: KeyboardEvent, index: number) {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const nextIndex = moveRovingIndex({
      currentIndex: index,
      itemCount: NOTIF_PRESETS.length,
      key: e.key,
      orientation: "vertical",
    });
    if (nextIndex === index) return;
    e.preventDefault();
    e.stopPropagation();
    presetFocusIndex = nextIndex;
    void focusPresetButton(nextIndex);
  }

  function selectedUnitIndex(unit: number): number {
    return Math.max(0, CUSTOM_UNITS.findIndex((option) => option.value === unit));
  }

  function openDropdown(idx: number, source: "keyboard" | "pointer") {
    dropdownIdx = idx;
    unitFocusIndex = selectedUnitIndex(customNotifs[idx]?.unit ?? 1);
    if (source === "keyboard") void focusUnitButton(unitFocusIndex);
  }

  function closeDropdown(source: "keyboard" | "pointer") {
    const idx = dropdownIdx;
    dropdownIdx = null;
    if (source === "keyboard" && idx !== null) void focusDropdownButton(idx);
  }

  function toggleDropdown(idx: number) {
    if (dropdownIdx === idx) closeDropdown("pointer");
    else openDropdown(idx, "pointer");
  }

  function selectUnit(idx: number, amount: number, unit: number, source: "keyboard" | "pointer") {
    updateCustomNotif(idx, amount, unit);
    closeDropdown(source);
  }

  function handleDropdownButtonKeydown(e: KeyboardEvent, idx: number) {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.key !== "Enter") return;
    e.preventDefault();
    e.stopPropagation();
    openDropdown(idx, "keyboard");
  }

  function handleUnitKeydown(e: KeyboardEvent, idx: number, optionIndex: number, amount: number, unit: number) {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeDropdown("keyboard");
      return;
    }

    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      selectUnit(idx, amount, unit, "keyboard");
      return;
    }

    const nextIndex = moveRovingIndex({
      currentIndex: optionIndex,
      itemCount: CUSTOM_UNITS.length,
      key: e.key,
      orientation: "vertical",
    });
    if (nextIndex === optionIndex) return;
    e.preventDefault();
    e.stopPropagation();
    unitFocusIndex = nextIndex;
    void focusUnitButton(nextIndex);
  }

  function commitCustomAmountDraft(idx: number) {
    const current = customNotifs[idx];
    if (!current) return;
    const result = commitIntegerDraft(customAmountDrafts[idx] ?? "", current.amount, 1, 999);
    const nextDrafts = [...customAmountDrafts];
    nextDrafts[idx] = String(result.value);
    customAmountDrafts = nextDrafts;
    if (result.committed) updateCustomNotif(idx, result.value, current.unit);
  }

  function restoreCustomAmountDraft(idx: number) {
    const current = customNotifs[idx];
    if (!current) return;
    const nextDrafts = [...customAmountDrafts];
    nextDrafts[idx] = String(current.amount);
    customAmountDrafts = nextDrafts;
  }

  function setCustomAmountDraft(idx: number, value: string) {
    const nextDrafts = [...customAmountDrafts];
    nextDrafts[idx] = value;
    customAmountDrafts = nextDrafts;
  }

  function handleNumberDraftKeydown(e: KeyboardEvent, idx: number) {
    if (!e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        commitCustomAmountDraft(idx);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        restoreCustomAmountDraft(idx);
        return;
      }
    }
    panelInputKeydown(e);
  }

  function positionDropdown(node: HTMLElement, idx: number) {
    const btn = dropdownBtns[idx];
    if (!btn) return { destroy() {} };
    const r = btn.getBoundingClientRect();
    const pw = node.offsetWidth || 120;
    let left = r.left;
    left = Math.max(8, Math.min(window.innerWidth - pw - 8, left));
    node.style.left = `${left}px`;
    node.style.top = `${r.bottom + 4}px`;
    return { destroy() {} };
  }

  function formatMinutes(minutes: number): string {
    if (minutes === 0) return t("calendar.notifications.atStart");
    if (minutes < 60) return t("calendar.notifications.minutesBefore", minutes);
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (minutes < 1440) {
      if (mins === 0) return t("calendar.notifications.hoursBefore", hours);
      return t("calendar.notifications.compactHoursMinutesBefore", hours, mins);
    }
    const days = Math.floor(minutes / 1440);
    if (minutes % 10080 === 0) {
      return t("calendar.notifications.weeksBefore", minutes / 10080);
    }
    if (minutes % 1440 === 0) return t("calendar.notifications.daysBefore", days);
    const remHours = Math.floor((minutes % 1440) / 60);
    return t("calendar.notifications.compactDaysHoursBefore", days, remHours);
  }

  function unitLabel(unit: number): string {
    if (unit === 60) return t("calendar.notifications.unitHours");
    if (unit === 1440) return t("calendar.notifications.unitDays");
    if (unit === 10080) return t("calendar.notifications.unitWeeks");
    return t("calendar.notifications.unitMinutes");
  }

  const summary = $derived.by(() => {
    if (!enabled) return "";
    const all: number[] = [...selected];
    for (const cn of customNotifs) all.push(cn.amount * cn.unit);
    if (all.length === 0) return t("calendar.notifications.none");
    const sorted = [...new Set(all)].sort((a, b) => a - b);
    return formatList(locale, sorted.map((m) => {
      const preset = NOTIF_PRESETS.find((p) => p.value === m);
      return preset ? preset.label : formatMinutes(m);
    }));
  });
</script>

<div bind:this={sectionEl} class="flex flex-col rounded-none overflow-hidden" style="background-color: var(--panel-contrast);">
  <div class="section-header flex items-stretch">
    <button onclick={ontoggle}
      class="flex w-10 shrink-0 items-center justify-center
        {enabled ? 'bg-black/3 dark:bg-black/30 text-foreground' : 'text-muted-foreground/50'}">
      <Bell size={14} />
    </button>
    <button onclick={onexpand}
      class="flex flex-1 items-center gap-2.5 px-3 py-2 text-left">
      <span class="translate-y-[1.13px] text-[0.8rem] {enabled ? 'text-foreground' : 'text-muted-foreground'}">{t("calendar.notifications.title")}</span>
      <span class="ml-auto translate-y-[1.13px] truncate text-[0.733333rem] text-muted-foreground">{summary}</span>
    </button>
  </div>
  {#if expanded}
    <div transition:slide={{ duration: 180, easing: cubicOut }} data-section="notifications" class="flex flex-col gap-1.5 p-2.5" style="background-color: var(--panel-bg);">
      <div class="flex flex-col gap-0.5">
        {#each NOTIF_PRESETS as opt, index}
          <button
            onclick={() => toggleNotif(opt.value)}
            onfocus={() => { presetFocusIndex = index; }}
            onkeydown={(e) => handlePresetKeydown(e, index)}
            data-notification-roving="preset"
            data-roving-index={index}
            tabindex={presetFocusIndex === index ? 0 : -1}
            class="flex items-center gap-2.5 rounded-none px-2.5 py-1.5 text-left text-[0.8rem] text-foreground"
          >
            <div class="size-3 shrink-0
              {selected.has(opt.value) ? 'bg-form-indicator' : 'border border-muted-foreground/40'}">
            </div>
            <span>{opt.label}</span>
          </button>
        {/each}
      </div>
      {#each customNotifs as cn, idx}
        <div class="flex items-center gap-2 px-2">
          <input type="number" value={customAmountDrafts[idx] ?? String(cn.amount)} min={1} max={999}
            oninput={(e) => setCustomAmountDraft(idx, e.currentTarget.value)}
            onblur={() => commitCustomAmountDraft(idx)}
            class="num-input w-11 rounded bg-black/5 px-1 py-0.5 text-center text-[0.8rem] text-event-panel-input-text outline-none dark:bg-black/15"
            onkeydown={(e) => handleNumberDraftKeydown(e, idx)} />
          <button bind:this={dropdownBtns[idx]}
            onclick={() => toggleDropdown(idx)}
            onkeydown={(e) => handleDropdownButtonKeydown(e, idx)}
            class="rounded bg-black/5 px-2.5 py-0.5 text-[0.8rem] dark:bg-black/15
              {dropdownIdx === idx ? 'ring-1 ring-primary/60' : 'hover:bg-black/5 dark:hover:bg-black/15'}
              text-event-panel-input-text">
            {CUSTOM_UNITS.find((u) => u.value === cn.unit)?.label ?? t("calendar.notifications.unitMinutes")}
          </button>
          <span class="text-[0.8rem] text-muted-foreground">{t("calendar.notifications.before")}</span>
          <button onclick={() => { removeCustomNotif(idx); dropdownIdx = null; }}
            aria-label={t("calendar.notifications.removeCustom")}
            class="ml-auto flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
            <X size={13} />
          </button>

          <!-- Floating unit dropdown -->
          {#if dropdownIdx === idx}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="fixed inset-0 z-60" onclick={() => closeDropdown("pointer")}></div>
            <div class="fixed z-61 rounded-lg bg-popover py-1 shadow-lg ring-1 ring-border/60"
              use:positionDropdown={idx}>
              {#each CUSTOM_UNITS as u, unitIndex}
                <button onclick={() => selectUnit(idx, cn.amount, u.value, "pointer")}
                  data-notification-unit-index={unitIndex}
                  tabindex={unitFocusIndex === unitIndex ? 0 : -1}
                  onfocus={() => { unitFocusIndex = unitIndex; }}
                  onkeydown={(e) => handleUnitKeydown(e, idx, unitIndex, cn.amount, u.value)}
                  class="flex w-full items-center px-3.5 py-1.5 text-left text-[0.8rem]
                    {cn.unit === u.value
                      ? 'bg-black/5 dark:bg-black/15 text-foreground'
                      : 'text-foreground hover:bg-black/5 dark:hover:bg-black/15'}">
                  {u.label}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
      {#if customNotifs.length < 2}
        <button onclick={addCustomNotif}
          class="flex items-center gap-1.5 self-start rounded-none px-2.5 py-1 text-[0.8rem] text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-black/15">
          <Plus size={13} /> <span>{t("calendar.notifications.custom")}</span>
        </button>
      {/if}
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
