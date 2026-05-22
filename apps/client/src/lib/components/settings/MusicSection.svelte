<script lang="ts">
  import { getPreferences } from "$lib/stores/preferences.svelte";
  import ToggleSetting from "./ToggleSetting.svelte";

  const preferences = getPreferences();
</script>

<div class="flex flex-col gap-6">
  <section class="flex flex-col gap-4">
    <h2 class="px-1 text-[0.866667rem] font-semibold text-foreground">Pomodoro</h2>
    <div class="flex flex-col gap-3">
      <ToggleSetting
        label="Pause if the focus session is paused"
        description="Pauses Music when you pause an active focus phase, then resumes it when focus continues."
        checked={preferences.musicPauseOnPomodoroPause}
        onChange={(checked) => preferences.setMusicPauseOnPomodoroPause(checked)}
      />
    </div>
  </section>
</div>
