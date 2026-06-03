<script lang="ts">
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import { openUrl } from "@tauri-apps/plugin-opener";

  interface SoundCredit {
    appUse: string;
    filename: string;
    sourceSound: string;
    sourceUrl: string;
    author: string;
    authorUrl: string;
    license: string;
  }

  const LICENSE_URL = "https://github.com/opengrimoire/ganbaru-ai/blob/main/LICENSE";
  const SOUND_FILE_BASE_URL = "https://github.com/opengrimoire/ganbaru-ai/blob/main/apps/client/static/sfx/";
  const FREESOUND_URL = "https://freesound.org/";

  const linkButtonClass =
    "inline-flex min-w-0 max-w-full items-center gap-1 text-left text-primary underline-offset-2 transition-colors hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-ring";
  const actionButtonClass =
    "inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-[0.8rem] font-medium text-foreground transition-colors hover:bg-accent focus:outline-none focus-visible:ring-1 focus-visible:ring-ring dark:bg-transparent";

  const soundCredits: readonly SoundCredit[] = [
    {
      appUse: "Event notification",
      filename: "event-notification.wav",
      sourceSound: "Short Success Sound Glockenspiel Treasure Video Game.mp3",
      sourceUrl: "https://freesound.org/people/FunWithSound/sounds/456965/",
      author: "FunWithSound",
      authorUrl: "https://freesound.org/people/FunWithSound/",
      license: "Creative Commons 0",
    },
    {
      appUse: "Idle alert",
      filename: "idle-alert.wav",
      sourceSound: "Soft Short App Melody",
      sourceUrl: "https://freesound.org/people/CogFireStudios/sounds/619837/",
      author: "CogFireStudios",
      authorUrl: "https://freesound.org/people/CogFireStudios/",
      license: "Creative Commons 0",
    },
    {
      appUse: "Focus failure after long idle",
      filename: "focus-session-failed-long-idle.wav",
      sourceSound: "Game Over 8 (One wrong step) .aif",
      sourceUrl: "https://freesound.org/people/SilverIllusionist/sounds/562103/",
      author: "SilverIllusionist",
      authorUrl: "https://freesound.org/people/SilverIllusionist/",
      license: "Attribution 4.0",
    },
    {
      appUse: "One minute before break",
      filename: "focus-ending-warning.wav",
      sourceSound: "sfx_rpg_ui_focus",
      sourceUrl: "https://freesound.org/people/MATUSTRM/sounds/848972/",
      author: "MATUSTRM",
      authorUrl: "https://freesound.org/people/MATUSTRM/",
      license: "Creative Commons 0",
    },
    {
      appUse: "Break start",
      filename: "break-start.wav",
      sourceSound: "Success 03",
      sourceUrl: "https://freesound.org/people/rhodesmas/sounds/322930/",
      author: "rhodesmas",
      authorUrl: "https://freesound.org/people/rhodesmas/",
      license: "Attribution 4.0",
    },
    {
      appUse: "Break finish",
      filename: "break-finished.wav",
      sourceSound: "Achievement Happy Beeps Jingle",
      sourceUrl: "https://freesound.org/people/CogFireStudios/sounds/619838/",
      author: "CogFireStudios",
      authorUrl: "https://freesound.org/people/CogFireStudios/",
      license: "Attribution 4.0",
    },
    {
      appUse: "Event finish",
      filename: "event-finished.wav",
      sourceSound: "Reflective Guitar Chords #1",
      sourceUrl: "https://freesound.org/people/SilverIllusionist/sounds/843310/",
      author: "SilverIllusionist",
      authorUrl: "https://freesound.org/people/SilverIllusionist/",
      license: "Creative Commons 0",
    },
    {
      appUse: "Day completed!",
      filename: "pomodoro-day-complete.wav",
      sourceSound: "Victory Fanfare (Light Wills Ever) no drums",
      sourceUrl: "https://freesound.org/people/SilverIllusionist/sounds/669323/",
      author: "SilverIllusionist",
      authorUrl: "https://freesound.org/people/SilverIllusionist/",
      license: "Attribution 4.0",
    },
    {
      appUse: "Workweek completed!",
      filename: "pomodoro-workweek-complete.wav",
      sourceSound: "Victory Fanfare (RPG or High Fantasy)",
      sourceUrl: "https://freesound.org/people/SilverIllusionist/sounds/659751/",
      author: "SilverIllusionist",
      authorUrl: "https://freesound.org/people/SilverIllusionist/",
      license: "Attribution 4.0",
    },
    {
      appUse: "AI response finished",
      filename: "ai-response-finished.wav",
      sourceSound: "Three-Note Doorbell or Notification",
      sourceUrl: "https://freesound.org/people/eqylizer/sounds/624599/",
      author: "eqylizer",
      authorUrl: "https://freesound.org/people/eqylizer/",
      license: "Creative Commons 0",
    },
  ];

  async function openExternalUrl(url: string): Promise<void> {
    try {
      await openUrl(url);
    } catch (error: unknown) {
      console.warn("Failed to open external URL:", error);
    }
  }

  function soundFileUrl(filename: string): string {
    return `${SOUND_FILE_BASE_URL}${encodeURIComponent(filename)}`;
  }
</script>

<div class="flex flex-col gap-6">
  <section class="flex flex-col gap-4">
    <h2 class="px-1 text-[0.866667rem] font-semibold text-foreground">License</h2>

    <div class="flex flex-col gap-3">
      <div class="flex items-start justify-between gap-4 px-1 py-1 max-[480px]:flex-col max-[480px]:items-stretch max-[480px]:gap-2">
        <div class="min-w-0 flex-1">
          <div class="text-[0.866667rem] text-foreground">AGPL 3.0</div>
          <div class="mt-0.5 text-[0.8rem] leading-5 text-muted-foreground">
            Ganbaru AI is licensed under AGPL 3.0.
          </div>
        </div>
        <button
          type="button"
          class={actionButtonClass}
          onclick={() => {
            void openExternalUrl(LICENSE_URL);
          }}
        >
          <span>View LICENSE</span>
          <ExternalLink size={13} strokeWidth={2.25} aria-hidden="true" />
        </button>
      </div>

      <div class="px-1 py-1">
        <div class="text-[0.866667rem] text-foreground">TL;DR</div>
        <div class="mt-0.5 text-[0.8rem] leading-5 text-muted-foreground">
          It's free. You can use it for commercial purposes. You can modify the app's
          source code freely. You can distribute your source code changes freely. If
          you distribute or host a modified version of the app, keep that
          redistribution AGPL 3.0 so it remains open and free. Authors are not
          responsible for any damages or issues arising from your use of this software.
        </div>
      </div>
    </div>
  </section>

  <div class="h-px bg-border/70" aria-hidden="true"></div>

  <section class="flex flex-col gap-4">
    <h2 class="px-1 text-[0.866667rem] font-semibold text-foreground">Acknowledgments</h2>

    <div class="flex flex-col gap-3">
      <div class="px-1 py-1">
        <div class="text-[0.866667rem] text-foreground">Sound effects</div>
        <div class="mt-0.5 text-[0.8rem] leading-5 text-muted-foreground">
          Sound effects are sourced from
          <button
            type="button"
            class={linkButtonClass}
            onclick={() => {
              void openExternalUrl(FREESOUND_URL);
            }}
          >
            Freesound
            <ExternalLink size={11} strokeWidth={2.25} aria-hidden="true" />
          </button>
          under Attribution 4.0 and CC0 licenses.
        </div>
      </div>

      <div class="flex min-w-0 flex-col gap-2 px-1">
        {#each soundCredits as credit}
          <article class="flex min-w-0 flex-col gap-2.5 rounded-md border border-border bg-card/70 px-3 py-3 text-[0.8rem] dark:bg-transparent">
            <div class="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1">
              <h3 class="wrap-break-word min-w-0 text-[0.866667rem] font-medium text-foreground">
                {credit.appUse}
              </h3>
              <span class="shrink-0 rounded border border-border bg-background px-1.5 py-0.5 text-[0.733333rem] text-muted-foreground">
                {credit.license}
              </span>
            </div>

            <div class="grid min-w-0 gap-1.5">
              <div class="grid min-w-0 grid-cols-[4rem_minmax(0,1fr)] items-start gap-2 max-[420px]:grid-cols-1 max-[420px]:gap-0.5">
                <span class="text-[0.733333rem] leading-5 text-muted-foreground">File</span>
                <button
                  type="button"
                  class={linkButtonClass}
                  onclick={() => {
                    void openExternalUrl(soundFileUrl(credit.filename));
                  }}
                >
                  <span class="wrap-break-word">{credit.filename}</span>
                  <ExternalLink size={11} strokeWidth={2.25} class="shrink-0" aria-hidden="true" />
                </button>
              </div>

              <div class="grid min-w-0 grid-cols-[4rem_minmax(0,1fr)] items-start gap-2 max-[420px]:grid-cols-1 max-[420px]:gap-0.5">
                <span class="text-[0.733333rem] leading-5 text-muted-foreground">Source</span>
                <button
                  type="button"
                  class={linkButtonClass}
                  onclick={() => {
                    void openExternalUrl(credit.sourceUrl);
                  }}
                >
                  <span class="wrap-break-word">{credit.sourceSound}</span>
                  <ExternalLink size={11} strokeWidth={2.25} class="shrink-0" aria-hidden="true" />
                </button>
              </div>

              <div class="grid min-w-0 grid-cols-[4rem_minmax(0,1fr)] items-start gap-2 max-[420px]:grid-cols-1 max-[420px]:gap-0.5">
                <span class="text-[0.733333rem] leading-5 text-muted-foreground">Author</span>
                <button
                  type="button"
                  class={linkButtonClass}
                  onclick={() => {
                    void openExternalUrl(credit.authorUrl);
                  }}
                >
                  <span class="wrap-break-word">{credit.author}</span>
                  <ExternalLink size={11} strokeWidth={2.25} class="shrink-0" aria-hidden="true" />
                </button>
              </div>
            </div>
          </article>
        {/each}
      </div>
    </div>
  </section>
</div>
