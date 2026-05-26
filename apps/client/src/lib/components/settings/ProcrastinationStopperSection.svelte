<script lang="ts">
  import { evaluateStopperUrl } from "$lib/procrastination-stopper";
  import { getProcrastinationStopper } from "$lib/stores/procrastination-stopper.svelte";
  import ToggleSetting from "./ToggleSetting.svelte";

  const stopper = getProcrastinationStopper();
  const blockedHostsId = "doomscrolling-blocked-hosts";
  const allowedHostsId = "doomscrolling-allowed-hosts";
  const testUrlId = "doomscrolling-test-url";
  let testUrl = $state("");
  const testDecision = $derived(
    testUrl.trim()
      ? evaluateStopperUrl(testUrl.trim(), {
          enabled: stopper.enabled,
          blockDuringShortBreaks: stopper.blockDuringShortBreaks,
          blockDuringLongBreaks: stopper.blockDuringLongBreaks,
          blockedHosts: [...stopper.blockedHosts],
          allowedHosts: [...stopper.allowedHosts],
        })
      : null,
  );

  function textAreaValue(target: EventTarget | null): string {
    return target instanceof HTMLTextAreaElement ? target.value : "";
  }
</script>

<div class="flex flex-col gap-6">
  <section class="flex flex-col gap-4">
    <h2 class="px-1 text-[0.866667rem] font-semibold text-foreground">Browser blocking</h2>
    <div class="flex flex-col gap-3">
      <ToggleSetting
        label="Enable during focus"
        description="Blocks configured hosts while a focus phase is active."
        checked={stopper.enabled}
        onChange={(checked) => stopper.setEnabled(checked)}
      />
      <ToggleSetting
        label="Block during short breaks"
        description="Applies the same host rules during short breaks."
        checked={stopper.blockDuringShortBreaks}
        onChange={(checked) => stopper.setBlockDuringShortBreaks(checked)}
      />
      <ToggleSetting
        label="Block during long breaks"
        description="Applies the same host rules during long breaks."
        checked={stopper.blockDuringLongBreaks}
        onChange={(checked) => stopper.setBlockDuringLongBreaks(checked)}
      />
    </div>
  </section>

  <div class="h-px bg-border/70" aria-hidden="true"></div>

  <section class="flex flex-col gap-4">
    <h2 class="px-1 text-[0.866667rem] font-semibold text-foreground">Blocked hosts</h2>
    <div class="flex flex-col gap-2 px-1 py-1">
      <div class="min-w-0">
        <label for={blockedHostsId} class="text-[0.866667rem] text-foreground">Hosts to block</label>
        <div class="mt-0.5 text-[0.8rem] text-muted-foreground">
          Add domains that should be blocked during enabled Pomodoro phases.
        </div>
      </div>
      <textarea
        id={blockedHostsId}
        value={stopper.blockedHostsText}
        oninput={(event) => stopper.setBlockedHostsText(textAreaValue(event.currentTarget))}
        spellcheck="false"
        placeholder="reddit.com&#10;youtube.com"
        class="min-h-30 resize-y rounded-md border border-border bg-background px-3 py-2 font-mono text-[0.8rem] leading-5 text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring"
      ></textarea>
    </div>
  </section>

  <div class="h-px bg-border/70" aria-hidden="true"></div>

  <section class="flex flex-col gap-4">
    <h2 class="px-1 text-[0.866667rem] font-semibold text-foreground">Allowed hosts</h2>
    <div class="flex flex-col gap-2 px-1 py-1">
      <div class="min-w-0">
        <label for={allowedHostsId} class="text-[0.866667rem] text-foreground">Hosts to allow</label>
        <div class="mt-0.5 text-[0.8rem] text-muted-foreground">
          Add exceptions that stay available even when a broader blocked host matches.
        </div>
      </div>
      <textarea
        id={allowedHostsId}
        value={stopper.allowedHostsText}
        oninput={(event) => stopper.setAllowedHostsText(textAreaValue(event.currentTarget))}
        spellcheck="false"
        placeholder="music.youtube.com&#10;developer.mozilla.org"
        class="min-h-24 resize-y rounded-md border border-border bg-background px-3 py-2 font-mono text-[0.8rem] leading-5 text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring"
      ></textarea>
    </div>
  </section>

  <div class="h-px bg-border/70" aria-hidden="true"></div>

  <section class="flex flex-col gap-4">
    <h2 class="px-1 text-[0.866667rem] font-semibold text-foreground">Rule tester</h2>
    <div class="flex flex-col gap-2 px-1 py-1">
      <div class="min-w-0">
        <label for={testUrlId} class="text-[0.866667rem] text-foreground">Test a URL</label>
        <div class="mt-0.5 text-[0.8rem] text-muted-foreground">
          Check which saved rule would apply before opening a site.
        </div>
      </div>
      <input
        id={testUrlId}
        type="url"
        bind:value={testUrl}
        placeholder="https://reddit.com/r/all"
        class="h-8 rounded-md border border-border bg-background px-3 text-[0.866667rem] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring"
      />
      {#if testDecision && testDecision.host}
        <div class="rounded-md border border-border bg-card px-3 py-2 text-[0.8rem] text-foreground">
          {#if testDecision.blocked}
            Blocked by {testDecision.matchedRule}
          {:else if testDecision.matchedRule}
            Allowed by {testDecision.matchedRule}
          {:else}
            Allowed by default
          {/if}
        </div>
      {:else if testUrl.trim()}
        <div class="rounded-md border border-border bg-card px-3 py-2 text-[0.8rem] text-muted-foreground">
          Unsupported or invalid URL.
        </div>
      {/if}
    </div>
  </section>
</div>
