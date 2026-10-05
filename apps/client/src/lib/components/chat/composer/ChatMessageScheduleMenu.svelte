<script lang="ts">
  import { onMount } from "svelte";
  import Check from "@lucide/svelte/icons/check";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import Clock3 from "@lucide/svelte/icons/clock-3";
  import X from "@lucide/svelte/icons/x";
  import { Temporal } from "@js-temporal/polyfill";
  import type { ChatScheduledMessageId, ChatScheduledMessageRead } from "$lib/chat/contracts";
  import {
    chatScheduleIsFuture,
    chatScheduleSuggestions,
    chatScheduleUtc,
    defaultChatScheduleSelection,
    type ChatScheduleSelection,
    type ChatScheduleSuggestion,
  } from "$lib/chat/composer/message-scheduling";
  import MiniDatePicker from "$lib/components/ui/MiniDatePicker.svelte";
  import TimePicker from "$lib/components/ui/TimePicker.svelte";
  import { formatTimeLabel } from "$lib/calendar/utils";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { localTimezone } from "$lib/stores/calendar/event-payloads";
  import { getChat } from "$lib/stores/chat.svelte";
  import { getPreferences } from "$lib/stores/preferences.svelte";
  import { portal } from "$lib/utils/portal";
  import ChatScheduledMessagePreview from "./ChatScheduledMessagePreview.svelte";

  type ScheduleMenuMode = "choose" | "manage";

  let {
    mode = "choose",
    align = "left",
    selectedScheduledFor = null,
    scheduledMessages = [],
    disabled = false,
    onselect = () => {},
    onclear = () => {},
    onclose = () => {},
    onmessageschange = () => {},
  }: {
    mode?: ScheduleMenuMode;
    align?: "left" | "right";
    selectedScheduledFor?: string | null;
    scheduledMessages?: ChatScheduledMessageRead[];
    disabled?: boolean;
    onselect?: (scheduledFor: string) => void;
    onclear?: () => void;
    onclose?: () => void;
    onmessageschange?: (messages: ChatScheduledMessageRead[]) => void;
  } = $props();

  const chat = getChat();
  const localization = getLocalization();
  const { t } = localization;
  const preferences = getPreferences();
  const initialNow = Temporal.Now.plainDateTimeISO();
  const initialSelection = defaultChatScheduleSelection(initialNow);
  const TIME_PICKER_PANEL_WIDTH = 160;
  const TIME_PICKER_PANEL_HEIGHT = 200;
  const TIME_PICKER_PANEL_MIN_HEIGHT = 96;
  const FLOATING_PANEL_GAP = 6;
  const FLOATING_PANEL_MARGIN = 8;

  let customScheduleOpen = $state(false);
  let scheduleTimePickerOpen = $state(false);
  let scheduleTimeTrigger = $state<HTMLButtonElement | undefined>();
  let scheduleDate = $state(initialSelection.date);
  let scheduleTime = $state(initialSelection.time);
  let scheduleToday = $state(initialNow.toPlainDate().toString());
  let scheduleSuggestions = $state<ChatScheduleSuggestion[]>(chatScheduleSuggestions(initialNow));
  let pendingMessageIds = $state<Set<ChatScheduledMessageId>>(new Set());
  let error = $state<string | null>(null);

  const customScheduledFor = $derived(chatScheduleUtc(
    { date: scheduleDate, time: scheduleTime },
    localTimezone(),
  ));
  const customScheduleValid = $derived(chatScheduleIsFuture(customScheduledFor));

  onMount(() => {
    const now = Temporal.Now.plainDateTimeISO();
    const defaults = selectionFromInstant(selectedScheduledFor) ?? defaultChatScheduleSelection(now);
    scheduleDate = defaults.date;
    scheduleTime = defaults.time;
    scheduleToday = now.toPlainDate().toString();
    scheduleSuggestions = chatScheduleSuggestions(now);
  });

  function selectionFromInstant(value: string | null): ChatScheduleSelection | null {
    if (!value) return null;
    try {
      const local = Temporal.Instant.from(value).toZonedDateTimeISO(localTimezone()).toPlainDateTime();
      return {
        date: local.toPlainDate().toString(),
        time: `${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")}`,
      };
    } catch {
      return null;
    }
  }

  function scheduleSuggestionLabel(kind: ChatScheduleSuggestion["kind"]): string {
    if (kind === "later_today") return t("chat.organization.laterToday");
    if (kind === "tomorrow_morning") return t("chat.organization.tomorrowMorning");
    return t("chat.organization.mondayMorning");
  }

  function formatLocalSchedule(date: string, time: string): string {
    const value = new Date(`${date}T${time}:00`);
    if (!Number.isFinite(value.getTime())) return `${date} ${time}`;
    const dateLabel = new Intl.DateTimeFormat(localization.locale, {
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(value);
    return `${dateLabel}, ${formatTimeLabel(time, preferences.calendarTimeFormat)}`;
  }

  function isSelected(selection: ChatScheduleSelection): boolean {
    const scheduledFor = chatScheduleUtc(selection, localTimezone());
    return scheduledFor !== null && scheduledFor === selectedScheduledFor;
  }

  function selectSchedule(selection: ChatScheduleSelection): void {
    if (disabled) return;
    const scheduledFor = chatScheduleUtc(selection, localTimezone());
    if (scheduledFor === null || !chatScheduleIsFuture(scheduledFor)) {
      error = t("chat.organization.invalidScheduleTime");
      return;
    }
    onselect(scheduledFor);
    onclose();
  }

  function clearSchedule(): void {
    onclear();
    onclose();
  }

  async function cancelScheduledMessage(id: ChatScheduledMessageId): Promise<void> {
    if (pendingMessageIds.has(id)) return;
    pendingMessageIds = new Set([...pendingMessageIds, id]);
    error = null;
    try {
      await chat.cancelScheduledOrganizationalMessage(id);
      const remaining = scheduledMessages.filter((message) => message.id !== id);
      onmessageschange(remaining);
      if (remaining.length === 0) onclose();
    } catch (cause: unknown) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      pendingMessageIds = new Set([...pendingMessageIds].filter((messageId) => messageId !== id));
    }
  }

  async function retryScheduledMessage(id: ChatScheduledMessageId): Promise<void> {
    if (pendingMessageIds.has(id)) return;
    pendingMessageIds = new Set([...pendingMessageIds, id]);
    error = null;
    try {
      const retried = await chat.retryScheduledOrganizationalMessage(id);
      onmessageschange(scheduledMessages.map((message) => message.id === id ? retried : message));
    } catch (cause: unknown) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      pendingMessageIds = new Set([...pendingMessageIds].filter((messageId) => messageId !== id));
    }
  }

  async function sendScheduledMessageNow(id: ChatScheduledMessageId): Promise<void> {
    if (pendingMessageIds.has(id)) return;
    pendingMessageIds = new Set([...pendingMessageIds, id]);
    error = null;
    try {
      await chat.sendScheduledOrganizationalMessageNow(id);
      const remaining = scheduledMessages.filter((message) => message.id !== id);
      onmessageschange(remaining);
      if (remaining.length === 0) onclose();
    } catch (cause: unknown) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      pendingMessageIds = new Set([...pendingMessageIds].filter((messageId) => messageId !== id));
    }
  }

  function positionTimePickerPanel(node: HTMLElement) {
    function updatePosition(): void {
      if (!scheduleTimeTrigger) return;
      const triggerRect = scheduleTimeTrigger.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const usableHeight = Math.max(0, viewportHeight - FLOATING_PANEL_MARGIN * 2);
      const preferredHeight = Math.min(TIME_PICKER_PANEL_HEIGHT, usableHeight);
      const minimumHeight = Math.min(TIME_PICKER_PANEL_MIN_HEIGHT, usableHeight);
      const belowTop = triggerRect.bottom + FLOATING_PANEL_GAP;
      const aboveBottom = triggerRect.top - FLOATING_PANEL_GAP;
      const belowSpace = Math.max(0, viewportHeight - FLOATING_PANEL_MARGIN - belowTop);
      const aboveSpace = Math.max(0, aboveBottom - FLOATING_PANEL_MARGIN);
      const preferBelow = belowSpace >= preferredHeight || belowSpace >= aboveSpace;
      const availableHeight = preferBelow ? belowSpace : aboveSpace;
      const maxHeight = Math.max(minimumHeight, Math.min(preferredHeight, availableHeight || usableHeight));
      const panelWidth = node.offsetWidth || TIME_PICKER_PANEL_WIDTH;
      const left = Math.max(
        FLOATING_PANEL_MARGIN,
        Math.min(triggerRect.left, viewportWidth - panelWidth - FLOATING_PANEL_MARGIN),
      );
      const unclampedTop = preferBelow ? belowTop : aboveBottom - maxHeight;
      const top = Math.max(
        FLOATING_PANEL_MARGIN,
        Math.min(unclampedTop, viewportHeight - FLOATING_PANEL_MARGIN - maxHeight),
      );
      node.style.left = `${Math.round(left)}px`;
      node.style.top = `${Math.round(top)}px`;
      node.style.setProperty("--chat-schedule-time-picker-max-height", `${Math.round(maxHeight)}px`);
    }

    const frame = requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return {
      destroy() {
        cancelAnimationFrame(frame);
        window.removeEventListener("resize", updatePosition);
        window.removeEventListener("scroll", updatePosition, true);
      },
    };
  }
</script>

<div class:align-right={align === "right"} class:manage={mode === "manage"} class="schedule-menu" role="dialog" aria-label={mode === "manage" ? t("chat.organization.scheduledMessages") : t("chat.organization.scheduleMessage")}>
  {#if mode === "manage"}
    <div class="schedule-header">
      <strong>{t("chat.organization.scheduledMessagesCount", scheduledMessages.length)}</strong>
      <button class="header-icon" type="button" aria-label={t("chat.organization.closeScheduledMessages")} onclick={onclose}><X size={14} /></button>
    </div>
    <div class="scheduled-list">
      {#each scheduledMessages as scheduled (scheduled.id)}
        <ChatScheduledMessagePreview
          message={scheduled}
          pending={pendingMessageIds.has(scheduled.id)}
          onsendnow={() => { void sendScheduledMessageNow(scheduled.id); }}
          onretry={() => { void retryScheduledMessage(scheduled.id); }}
          oncancel={() => { void cancelScheduledMessage(scheduled.id); }}
        />
      {/each}
    </div>
  {:else}
    <div class="schedule-header">
      {#if customScheduleOpen}
        <button class="header-icon" type="button" aria-label={t("chat.organization.backToScheduleOptions")} onclick={() => { customScheduleOpen = false; scheduleTimePickerOpen = false; }}><ChevronLeft size={14} /></button>
      {/if}
      <strong>{t("chat.organization.scheduleMessage")}</strong>
      {#if selectedScheduledFor && !customScheduleOpen}
        <button class="clear-schedule" type="button" onclick={clearSchedule}>{t("chat.organization.sendNowInstead")}</button>
      {/if}
    </div>
    {#if customScheduleOpen}
      <div class="custom-schedule">
        <MiniDatePicker
          selectedDate={scheduleDate}
          minDate={scheduleToday}
          small
          highlightMode="none"
          activeHighlight="primary"
          onselect={(date) => { scheduleDate = date; }}
          oncancel={() => { customScheduleOpen = false; scheduleTimePickerOpen = false; }}
        />
        <button
          bind:this={scheduleTimeTrigger}
          type="button"
          class="schedule-time-button"
          aria-haspopup="dialog"
          aria-expanded={scheduleTimePickerOpen}
          onclick={() => { scheduleTimePickerOpen = !scheduleTimePickerOpen; }}
        >
          <Clock3 size={13} />
          <span>{formatTimeLabel(scheduleTime, preferences.calendarTimeFormat)}</span>
        </button>
        {#if scheduleTimePickerOpen}
          <div
            use:portal
            use:positionTimePickerPanel
            class="schedule-time-picker fixed z-100 w-40 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-sm"
            role="dialog"
            aria-label={t("chat.organization.chooseTime")}
          >
            <TimePicker
              currentTime={scheduleTime}
              activeTime={scheduleTime}
              scrollTime={scheduleTime}
              focusOnOpen
              onselect={(time) => { scheduleTime = time; scheduleTimePickerOpen = false; }}
              oncancel={() => { scheduleTimePickerOpen = false; }}
            />
          </div>
        {/if}
        <button
          type="button"
          class="schedule-submit"
          disabled={disabled || !customScheduleValid}
          onclick={() => selectSchedule({ date: scheduleDate, time: scheduleTime })}
        >{t("chat.organization.useScheduleTime")}</button>
      </div>
    {:else}
      <div class="schedule-choices">
        {#each scheduleSuggestions as suggestion (suggestion.kind)}
          {@const selected = isSelected(suggestion)}
          <button type="button" class:selected disabled={disabled} aria-pressed={selected} onclick={() => selectSchedule(suggestion)}>
            <span>{scheduleSuggestionLabel(suggestion.kind)}</span>
            <small>{formatLocalSchedule(suggestion.date, suggestion.time)}</small>
            {#if selected}<Check class="choice-check" size={14} />{/if}
          </button>
        {/each}
        <button type="button" class="custom-schedule-button" class:selected={Boolean(selectedScheduledFor) && !scheduleSuggestions.some(isSelected)} onclick={() => { customScheduleOpen = true; }}>
          <span>{t("chat.organization.customDateTime")}</span>
          {#if selectedScheduledFor && !scheduleSuggestions.some(isSelected)}<Check class="choice-check" size={14} />{/if}
        </button>
      </div>
    {/if}
  {/if}
  {#if error}<p class="schedule-error" role="alert">{error}</p>{/if}
</div>

<style>
  .schedule-menu { position:absolute; z-index:70; bottom:calc(100% + 0.35rem); left:0; width:min(18rem,calc(100vw - 1rem)); max-height:min(30rem,calc(100vh - 1rem)); border:1px solid var(--border); border-radius:0.6rem; background:var(--popover); padding:0.35rem; box-shadow:0 10px 30px rgb(0 0 0 / 0.16); }
  .schedule-menu.align-right { right:0; left:auto; }
  .schedule-menu.manage { width:min(36rem,calc(100vw - 1rem)); padding:0.35rem 0.25rem 0.25rem; }
  .schedule-header { display:flex; min-height:2rem; align-items:center; gap:0.35rem; padding:0.2rem 0.35rem 0.35rem; }
  .schedule-header strong { min-width:0; flex:1; font-size: calc(0.75rem * var(--type-scale)); font-weight:600; }
  .header-icon { display:grid; width:1.65rem; height:1.65rem; place-items:center; border-radius:0.4rem; color:var(--muted-foreground); }
  .header-icon:hover { background:var(--accent); color:var(--foreground); }
  .clear-schedule { flex:0 0 auto; border-radius:0.35rem; padding:0.25rem 0.35rem; color:var(--muted-foreground); font-size: calc(0.68rem * var(--type-scale)); }
  .clear-schedule:hover { background:var(--accent); color:var(--foreground); }
  .schedule-choices { display:grid; gap:0.1rem; }
  .schedule-choices > button { position:relative; display:grid; min-height:2.55rem; gap:0.05rem; border-radius:0.45rem; padding:0.35rem 2rem 0.35rem 0.5rem; text-align:left; }
  .schedule-choices > button:hover:not(:disabled),.schedule-choices > button.selected { background:var(--accent); color:var(--foreground); }
  .schedule-choices > button:disabled { opacity:0.45; }
  .schedule-choices span { font-size: calc(0.75rem * var(--type-scale)); }
  .schedule-choices small { color:var(--muted-foreground); font-size: calc(0.66rem * var(--type-scale)); }
  .schedule-choices .custom-schedule-button { min-height:2.25rem; }
  :global(.choice-check) { position:absolute; top:50%; right:0.55rem; color:var(--foreground); transform:translateY(-50%); }
  .custom-schedule { display:grid; gap:0.4rem; padding:0.15rem 0.25rem 0.3rem; }
  .schedule-time-button { display:flex; min-height:2rem; align-items:center; gap:0.5rem; border-radius:0.4rem; padding:0.35rem 0.5rem; color:var(--muted-foreground); font-size: calc(0.75rem * var(--type-scale)); text-align:left; }
  .schedule-time-button:hover,.schedule-time-button[aria-expanded="true"] { background:var(--accent); color:var(--foreground); }
  .schedule-submit { min-height:2.15rem; border-radius:0.5rem; background:var(--primary); color:var(--primary-foreground); font-size: calc(0.75rem * var(--type-scale)); font-weight:600; }
  .schedule-submit:disabled { opacity:0.45; }
  .scheduled-list { max-height:min(28rem,calc(100vh - 7rem)); overflow-y:auto; overscroll-behavior:contain; }
  .schedule-error { padding:0.4rem 0.35rem 0.2rem; color:var(--destructive); font-size: calc(0.7rem * var(--type-scale)); }
  :global(.schedule-time-picker .time-picker-scroll) { max-height:var(--chat-schedule-time-picker-max-height,12.5rem); }
  @media (forced-colors:active) { .schedule-menu { border:1px solid CanvasText; } }
</style>
