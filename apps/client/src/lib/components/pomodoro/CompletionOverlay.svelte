<script lang="ts">
  import type { PomodoroCompletionKind } from "$lib/stores/pomodoro-completion";
  import { onMount } from "svelte";
  import PomodoroBlockedScreen from "./PomodoroBlockedScreen.svelte";
  import type { PomodoroCompletionScreenState } from "./blocked-screen";

  let {
    kind,
    onDismiss,
  }: {
    kind: PomodoroCompletionKind;
    onDismiss: () => void;
  } = $props();

  const screenStateForKind: Record<PomodoroCompletionKind, PomodoroCompletionScreenState> = {
    event: "event_finished",
    day: "day_complete",
    workweek: "workweek_complete",
  };

  let dismissed = false;

  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    onDismiss();
  }

  onMount(() => {
    function handleKeydown(event: KeyboardEvent) {
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    }
    window.addEventListener("keydown", handleKeydown, true);
    return () => window.removeEventListener("keydown", handleKeydown, true);
  });
</script>

<div
  class="fixed inset-0 z-60 h-screen w-screen"
  role="dialog"
  aria-modal="true"
  tabindex="0"
  onclick={dismiss}
  onkeydown={dismiss}
>
  <PomodoroBlockedScreen state={screenStateForKind[kind]} seconds={0} />
</div>
