<script lang="ts">
  import type { PomodoroCompletionKind } from "$lib/stores/pomodoro-completion";
  import { onMount } from "svelte";

  let {
    kind,
    onDismiss,
  }: {
    kind: PomodoroCompletionKind;
    onDismiss: () => void;
  } = $props();

  const copy: Record<PomodoroCompletionKind, { title: string; subtitle: string }> = {
    event: {
      title: "Event finished",
      subtitle: "press any key or click to continue",
    },
    day: {
      title: "Pomodoro day complete",
      subtitle: "press any key or click to continue",
    },
    workweek: {
      title: "Pomodoro workweek complete",
      subtitle: "press any key or click to continue",
    },
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
  class="fixed inset-0 z-60 flex select-none flex-col items-center justify-center bg-black"
  role="dialog"
  aria-modal="true"
  tabindex="0"
  onclick={dismiss}
  onkeydown={dismiss}
>
  <div class="flex flex-col items-center gap-4 text-center">
    <p class="completion-title text-5xl font-light">
      {copy[kind].title}
    </p>
    <p class="completion-copy text-sm">
      {copy[kind].subtitle}
    </p>
  </div>
</div>

<style>
  .completion-title {
    color: #FFFFFF;
  }

  .completion-copy {
    color: #9CA3AF;
  }
</style>
