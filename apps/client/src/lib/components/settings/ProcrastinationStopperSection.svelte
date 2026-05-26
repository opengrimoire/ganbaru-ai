<script lang="ts">
  import { evaluateStopperUrl } from "$lib/procrastination-stopper";
  import { getProcrastinationStopper } from "$lib/stores/procrastination-stopper.svelte";
  import ToggleSetting from "./ToggleSetting.svelte";

  const stopper = getProcrastinationStopper();
  let testUrl = $state("");
  const testDecision = $derived(
    testUrl.trim()
      ? evaluateStopperUrl(testUrl.trim(), {
          enabled: stopper.enabled,
          blockDuringBreaks: stopper.blockDuringBreaks,
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
        label="Keep blocking during breaks"
        description="Applies the same host rules during short and long breaks."
        checked={stopper.blockDuringBreaks}
        onChange={(checked) => stopper.setBlockDuringBreaks(checked)}
      />
    </div>
  </section>

  <section class="flex flex-col gap-3">
    <h2 class="px-1 text-[0.866667rem] font-semibold text-foreground">Blocked hosts</h2>
    <textarea
      value={stopper.blockedHostsText}
      oninput={(event) => stopper.setBlockedHostsText(textAreaValue(event.currentTarget))}
      spellcheck="false"
      placeholder="reddit.com&#10;youtube.com"
      class="min-h-30 resize-y rounded-md border border-border bg-background px-3 py-2 font-mono text-[0.8rem] leading-5 text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring"
    ></textarea>
  </section>

  <section class="flex flex-col gap-3">
    <h2 class="px-1 text-[0.866667rem] font-semibold text-foreground">Allowed hosts</h2>
    <textarea
      value={stopper.allowedHostsText}
      oninput={(event) => stopper.setAllowedHostsText(textAreaValue(event.currentTarget))}
      spellcheck="false"
      placeholder="music.youtube.com&#10;developer.mozilla.org"
      class="min-h-24 resize-y rounded-md border border-border bg-background px-3 py-2 font-mono text-[0.8rem] leading-5 text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring"
    ></textarea>
  </section>

  <section class="flex flex-col gap-3">
    <h2 class="px-1 text-[0.866667rem] font-semibold text-foreground">Rule tester</h2>
    <input
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
  </section>
</div>
