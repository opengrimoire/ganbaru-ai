<script lang="ts">
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";
  import {
    DEFAULT_FOCUS_IDLE_THRESHOLD_MINUTES,
    FOCUS_IDLE_THRESHOLD_MINUTES_MAX,
    FOCUS_IDLE_THRESHOLD_MINUTES_MIN,
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

  let showDisableIdlePauseConfirm = $state(false);

  function handleIdleThresholdChange(value: string): void {
    const minutes = Number(value);
    if (!Number.isFinite(minutes)) return;
    preferences.setFocusIdleThresholdMinutes(minutes);
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
