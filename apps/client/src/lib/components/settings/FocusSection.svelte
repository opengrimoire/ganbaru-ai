<script lang="ts">
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";
  import {
    DEFAULT_FOCUS_IDLE_THRESHOLD_MINUTES,
    DEFAULT_FOCUS_BREAK_END_WARNING_SECONDS,
    DEFAULT_FOCUS_BREAK_FINISHED_REPEAT_SECONDS,
    DEFAULT_FOCUS_PAUSE_NOTIFICATION_INTERVAL_MINUTES,
    FOCUS_IDLE_THRESHOLD_MINUTES_MAX,
    FOCUS_IDLE_THRESHOLD_MINUTES_MIN,
    FOCUS_BREAK_SOUND_INTERVAL_SECONDS,
    FOCUS_PAUSE_NOTIFICATION_INTERVAL_MINUTES,
  } from "$lib/stores/preferences";
  import { getPreferences } from "$lib/stores/preferences.svelte";
  import CustomSelect from "./CustomSelect.svelte";
  import ToggleSetting from "./ToggleSetting.svelte";

  const preferences = getPreferences();

  type SelectOption = { value: string; label: string };

  const idleThresholdOptions: readonly SelectOption[] = Array.from(
    {
      length: FOCUS_IDLE_THRESHOLD_MINUTES_MAX - FOCUS_IDLE_THRESHOLD_MINUTES_MIN + 1,
    },
    (_, index) => {
      const minutes = FOCUS_IDLE_THRESHOLD_MINUTES_MIN + index;
      return { value: String(minutes), label: `${minutes} min` };
    },
  );

  const breakFinishedRepeatOptions: readonly SelectOption[] =
    FOCUS_BREAK_SOUND_INTERVAL_SECONDS.map((seconds) => {
      if (seconds === 0) return { value: String(seconds), label: "None" };
      if (seconds === 60) return { value: String(seconds), label: "Every minute" };
      return { value: String(seconds), label: `Every ${seconds} seconds` };
    });

  const breakEndWarningOptions: readonly SelectOption[] =
    FOCUS_BREAK_SOUND_INTERVAL_SECONDS.map((seconds) => {
      if (seconds === 0) return { value: String(seconds), label: "None" };
      if (seconds === 60) return { value: String(seconds), label: "1 minute before" };
      return { value: String(seconds), label: `${seconds} seconds before` };
    });

  const pausedFocusWarningOptions: readonly SelectOption[] =
    FOCUS_PAUSE_NOTIFICATION_INTERVAL_MINUTES.map((minutes) => {
      if (minutes === 0) return { value: String(minutes), label: "None" };
      return { value: String(minutes), label: `Every ${minutes} minutes` };
    });

  let showDisableIdlePauseConfirm = $state(false);

  function handleIdleThresholdChange(value: string): void {
    const minutes = Number(value);
    if (!Number.isFinite(minutes)) return;
    preferences.setFocusIdleThresholdMinutes(minutes);
  }

  function handleBreakFinishedRepeatChange(value: string): void {
    const seconds = Number(value);
    if (!Number.isFinite(seconds)) return;
    preferences.setFocusBreakFinishedRepeatSeconds(seconds);
  }

  function handleBreakEndWarningChange(value: string): void {
    const seconds = Number(value);
    if (!Number.isFinite(seconds)) return;
    preferences.setFocusBreakEndWarningSeconds(seconds);
  }

  function handlePausedFocusWarningChange(value: string): void {
    const minutes = Number(value);
    if (!Number.isFinite(minutes)) return;
    preferences.setFocusPauseNotificationIntervalMinutes(minutes);
  }

  function handleIdlePauseDefaultChange(checked: boolean): void {
    if (checked) {
      preferences.setFocusIdlePauseOnEventCreate(true);
      return;
    }
    showDisableIdlePauseConfirm = true;
  }

  function confirmDisableIdlePauseDefault(): void {
    preferences.setFocusIdlePauseOnEventCreate(false);
    showDisableIdlePauseConfirm = false;
  }

  function cancelDisableIdlePauseDefault(): void {
    showDisableIdlePauseConfirm = false;
  }
</script>

<div class="flex flex-col gap-6">
  <section class="flex flex-col gap-4">
    <h2 class="px-1 text-[0.866667rem] font-semibold text-foreground">Idle detection</h2>
    <div class="flex flex-col gap-3">
      <CustomSelect
        label="Idle threshold"
        description="Pause focus after this much inactivity"
        value={String(preferences.focusIdleThresholdMinutes)}
        options={idleThresholdOptions}
        onChange={handleIdleThresholdChange}
        canReset={preferences.focusIdleThresholdMinutes !== DEFAULT_FOCUS_IDLE_THRESHOLD_MINUTES}
        onReset={() => preferences.resetFocusIdleThresholdMinutes()}
      />
      <ToggleSetting
        label="Idle pause by default"
        description="Turns on Pause on inactivity for new Pomodoro events"
        checked={preferences.focusIdlePauseOnEventCreate}
        onChange={handleIdlePauseDefaultChange}
      />
    </div>
  </section>

  <div class="h-px bg-border/70" aria-hidden="true"></div>

  <section class="flex flex-col gap-4">
    <h2 class="px-1 text-[0.866667rem] font-semibold text-foreground">Notification</h2>
    <div class="flex flex-col gap-3">
      <CustomSelect
        label="Paused focus warning"
        description="Remind you to resume paused focus sessions"
        value={String(preferences.focusPauseNotificationIntervalMinutes)}
        options={pausedFocusWarningOptions}
        onChange={handlePausedFocusWarningChange}
        canReset={preferences.focusPauseNotificationIntervalMinutes !== DEFAULT_FOCUS_PAUSE_NOTIFICATION_INTERVAL_MINUTES}
        onReset={() => preferences.resetFocusPauseNotificationIntervalMinutes()}
      />
    </div>
  </section>

  <div class="h-px bg-border/70" aria-hidden="true"></div>

  <section class="flex flex-col gap-4">
    <h2 class="px-1 text-[0.866667rem] font-semibold text-foreground">Break screen</h2>
    <div class="flex flex-col gap-3">
      <CustomSelect
        label="Repeat after break ends"
        description="Replay the break-complete sound until you return"
        value={String(preferences.focusBreakFinishedRepeatSeconds)}
        options={breakFinishedRepeatOptions}
        onChange={handleBreakFinishedRepeatChange}
        canReset={preferences.focusBreakFinishedRepeatSeconds !== DEFAULT_FOCUS_BREAK_FINISHED_REPEAT_SECONDS}
        onReset={() => preferences.resetFocusBreakFinishedRepeatSeconds()}
      />
      <CustomSelect
        label="Warning before break ends"
        description="Play the same sound once before the break completes"
        value={String(preferences.focusBreakEndWarningSeconds)}
        options={breakEndWarningOptions}
        onChange={handleBreakEndWarningChange}
        canReset={preferences.focusBreakEndWarningSeconds !== DEFAULT_FOCUS_BREAK_END_WARNING_SECONDS}
        onReset={() => preferences.resetFocusBreakEndWarningSeconds()}
      />
    </div>
  </section>
</div>

{#if showDisableIdlePauseConfirm}
  <ConfirmDialog
    title="Turn off idle pause by default?"
    message="Idle pause is an important productivity feature. It keeps focus time honest when you step away. Without it, away time can count as focus."
    confirmLabel="Turn off (Enter)"
    cancelLabel="Keep on (Esc)"
    onConfirm={confirmDisableIdlePauseDefault}
    onCancel={cancelDisableIdlePauseDefault}
  />
{/if}
