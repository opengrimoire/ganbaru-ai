<script lang="ts">
  import { slide } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import Bell from "@lucide/svelte/icons/bell";
  import X from "@lucide/svelte/icons/x";
  import Plus from "@lucide/svelte/icons/plus";

  const NOTIF_PRESETS: { value: number; label: string }[] = [
    { value: 0, label: "At start" },
    { value: 5, label: "5 minutes before" },
    { value: 10, label: "10 minutes before" },
    { value: 30, label: "30 minutes before" },
    { value: 60, label: "1 hour before" },
    { value: 1440, label: "1 day before" },
  ];

  const CUSTOM_UNITS: { value: number; label: string }[] = [
    { value: 1, label: "minutes" },
    { value: 60, label: "hours" },
    { value: 1440, label: "days" },
    { value: 10080, label: "weeks" },
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

  let dropdownIdx = $state<number | null>(null);
  let dropdownBtns: (HTMLButtonElement | undefined)[] = $state([]);

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
    if (minutes === 0) return "At start";
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} before`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (minutes < 1440) {
      if (mins === 0) return `${hours} hour${hours === 1 ? "" : "s"} before`;
      return `${hours}h ${mins}m before`;
    }
    const days = Math.floor(minutes / 1440);
    if (minutes % 1440 === 0) return `${days} day${days === 1 ? "" : "s"} before`;
    const remHours = Math.floor((minutes % 1440) / 60);
    return `${days}d ${remHours}h before`;
  }

  const summary = $derived.by(() => {
    if (!enabled) return "";
    const all: number[] = [...selected];
    for (const cn of customNotifs) all.push(cn.amount * cn.unit);
    if (all.length === 0) return "None";
    const sorted = [...new Set(all)].sort((a, b) => a - b);
    return sorted.map((m) => {
      const preset = NOTIF_PRESETS.find((p) => p.value === m);
      return preset ? preset.label : formatMinutes(m);
    }).join(", ");
  });
</script>

<div class="flex flex-col rounded-none overflow-hidden" style="background-color: var(--panel-contrast);">
  <div class="section-header flex items-stretch">
    <button onclick={ontoggle}
      class="flex w-9 shrink-0 items-center justify-center
        {enabled ? 'bg-black/3 dark:bg-black/30 text-foreground' : 'text-muted-foreground/50'}">
      <Bell size={13} />
    </button>
    <button onclick={onexpand}
      class="flex flex-1 items-center gap-2 px-2.5 py-2 text-left">
      <span class="translate-y-[1.13px] text-[11px] {enabled ? 'text-foreground' : 'text-muted-foreground'}">Notifications</span>
      <span class="ml-auto translate-y-[1.13px] truncate text-[10px] text-muted-foreground">{summary}</span>
    </button>
  </div>
  {#if expanded}
    <div transition:slide={{ duration: 180, easing: cubicOut }} data-section="notifications" class="flex flex-col gap-1.5 p-2.5" style="background-color: var(--panel-bg);">
      <div class="flex flex-col gap-0.5">
        {#each NOTIF_PRESETS as opt}
          <button
            onclick={() => toggleNotif(opt.value)}
            class="flex items-center gap-2 rounded-none px-2 py-1.5 text-left text-[11px] text-foreground"
          >
            <div class="size-2.75 shrink-0
              {selected.has(opt.value) ? 'bg-form-indicator' : 'border border-muted-foreground/40'}">
            </div>
            <span>{opt.label}</span>
          </button>
        {/each}
      </div>
      {#each customNotifs as cn, idx}
        <div class="flex items-center gap-1.5 px-2">
          <input type="number" value={cn.amount} min={1} max={999}
            oninput={(e) => updateCustomNotif(idx, parseInt(e.currentTarget.value, 10) || 1, cn.unit)}
            class="num-input w-10 rounded bg-black/5 dark:bg-black/15 px-1 py-0.5 text-center text-[11px] text-event-panel-input-text outline-none"
            onkeydown={(e) => e.stopPropagation()} />
          <button bind:this={dropdownBtns[idx]}
            onclick={() => { dropdownIdx = dropdownIdx === idx ? null : idx; }}
            class="rounded bg-black/5 dark:bg-black/15 px-2 py-0.5 text-[11px]
              {dropdownIdx === idx ? 'ring-1 ring-primary/60' : 'hover:bg-black/5 dark:hover:bg-black/15'}
              text-event-panel-input-text">
            {CUSTOM_UNITS.find((u) => u.value === cn.unit)?.label ?? "minutes"}
          </button>
          <span class="text-[11px] text-muted-foreground">before</span>
          <button onclick={() => { removeCustomNotif(idx); dropdownIdx = null; }}
            class="ml-auto flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
            <X size={12} />
          </button>

          <!-- Floating unit dropdown -->
          {#if dropdownIdx === idx}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="fixed inset-0 z-60" onclick={() => { dropdownIdx = null; }}></div>
            <div class="fixed z-61 rounded-lg bg-popover py-1 shadow-lg ring-1 ring-border/60"
              use:positionDropdown={idx}>
              {#each CUSTOM_UNITS as u}
                <button onclick={() => { updateCustomNotif(idx, cn.amount, u.value); dropdownIdx = null; }}
                  class="flex w-full items-center px-3 py-1.5 text-left text-[11px]
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
          class="flex items-center gap-1 self-start rounded-none px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-black/15">
          <Plus size={12} /> <span>Custom</span>
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
