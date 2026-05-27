<script lang="ts">
  import Plus from "@lucide/svelte/icons/plus";
  import ShieldCheck from "@lucide/svelte/icons/shield-check";
  import ShieldX from "@lucide/svelte/icons/shield-x";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import { type Component } from "svelte";
  import { cn } from "$lib/utils";
  import type { ProcrastinationStopperMode } from "$lib/procrastination-stopper";
  import { getProcrastinationStopper } from "$lib/stores/procrastination-stopper.svelte";
  import ToggleSetting from "./ToggleSetting.svelte";

  const stopper = getProcrastinationStopper();

  type WebsiteListKind = "blocked" | "exception" | "allowed";

  interface WebsiteListSection {
    kind: WebsiteListKind;
    id: string;
    heading: string;
    description: string;
    placeholder: string;
    emptyText: string;
    errorText: string;
    websites: () => readonly string[];
    add: (text: string) => boolean;
    remove: (website: string) => void;
  }

  const modeOptions: ReadonlyArray<{
    mode: ProcrastinationStopperMode;
    label: string;
    description: string;
    icon: Component;
  }> = [
    {
      mode: "blacklist",
      label: "Blacklist mode",
      description: "Block selected websites while everything else stays available",
      icon: ShieldX,
    },
    {
      mode: "whitelist",
      label: "Whitelist mode",
      description: "Only allow selected websites while everything else is blocked",
      icon: ShieldCheck,
    },
  ];

  const websiteSections = {
    blocked: {
      kind: "blocked",
      id: "doomscrolling-blocked-websites",
      heading: "Blocked websites",
      description: "Add domains like reddit.com or youtube.com",
      placeholder: "reddit.com",
      emptyText: "No blocked websites yet",
      errorText: "Enter a domain like reddit.com",
      websites: () => stopper.blockedHosts,
      add: (text: string) => stopper.addBlockedHostsText(text),
      remove: (website: string) => stopper.removeBlockedHost(website),
    },
    exception: {
      kind: "exception",
      id: "doomscrolling-exception-websites",
      heading: "Exceptions",
      description: "Keep specific subdomains available inside Blacklist mode",
      placeholder: "music.youtube.com",
      emptyText: "No exceptions yet",
      errorText: "Enter a domain like music.youtube.com",
      websites: () => stopper.exceptionHosts,
      add: (text: string) => stopper.addExceptionHostsText(text),
      remove: (website: string) => stopper.removeExceptionHost(website),
    },
    allowed: {
      kind: "allowed",
      id: "doomscrolling-allowed-websites",
      heading: "Allowed websites",
      description: "Everything else is blocked in Whitelist mode",
      placeholder: "github.com",
      emptyText: "No allowed websites yet",
      errorText: "Enter a domain like github.com",
      websites: () => stopper.allowedHosts,
      add: (text: string) => stopper.addAllowedHostsText(text),
      remove: (website: string) => stopper.removeAllowedHost(website),
    },
  } satisfies Record<WebsiteListKind, WebsiteListSection>;
  const blacklistWebsiteSections: readonly WebsiteListSection[] = [
    websiteSections.blocked,
    websiteSections.exception,
  ];
  const whitelistWebsiteSections: readonly WebsiteListSection[] = [
    websiteSections.allowed,
  ];

  let websiteDrafts = $state<Record<WebsiteListKind, string>>({
    blocked: "",
    exception: "",
    allowed: "",
  });
  let websiteErrors = $state<Record<WebsiteListKind, string>>({
    blocked: "",
    exception: "",
    allowed: "",
  });

  function addWebsite(section: WebsiteListSection): void {
    if (section.add(websiteDrafts[section.kind])) {
      websiteDrafts[section.kind] = "";
      websiteErrors[section.kind] = "";
      return;
    }
    websiteErrors[section.kind] = section.errorText;
  }

  function clearWebsiteError(kind: WebsiteListKind): void {
    websiteErrors[kind] = "";
  }

  function submitAdd(event: SubmitEvent, section: WebsiteListSection): void {
    event.preventDefault();
    addWebsite(section);
  }
</script>

{#snippet modeWebsiteSection(title: string, sections: readonly WebsiteListSection[])}
  <section class="flex flex-col gap-4">
    <h2 class="px-1 text-[0.866667rem] font-semibold text-foreground">{title}</h2>
    <div class="flex flex-col gap-4">
      {#each sections as section (section.kind)}
        {@render websiteSubsection(section)}
      {/each}
    </div>
  </section>
{/snippet}

{#snippet websiteSubsection(section: WebsiteListSection)}
  <div class="flex flex-col gap-2 px-1 py-1">
    <div class="min-w-0">
      <label for={section.id} class="text-[0.866667rem] text-foreground">{section.heading}</label>
      <div class="mt-0.5 text-[0.8rem] text-muted-foreground">
        {section.description}
      </div>
    </div>
    <form class="flex gap-2 max-[480px]:flex-col" onsubmit={(event) => submitAdd(event, section)}>
      <input
        id={section.id}
        bind:value={websiteDrafts[section.kind]}
        oninput={() => clearWebsiteError(section.kind)}
        type="text"
        spellcheck="false"
        placeholder={section.placeholder}
        class="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-3 font-mono text-[0.8rem] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring"
      />
      <button
        type="submit"
        disabled={!websiteDrafts[section.kind].trim()}
        class="flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 text-[0.8rem] font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 dark:bg-transparent"
      >
        <Plus size={13} strokeWidth={2.25} />
        <span>Add</span>
      </button>
    </form>
    {#if websiteErrors[section.kind]}
      <div class="text-[0.8rem] text-destructive">{websiteErrors[section.kind]}</div>
    {/if}
    {@render websiteRows(section.websites(), section.remove, section.emptyText)}
  </div>
{/snippet}

{#snippet websiteRows(websites: readonly string[], removeHost: (host: string) => void, emptyText: string)}
  <div class="flex flex-col gap-1.5">
    {#each websites as website (website)}
      <div class="flex h-9 items-center justify-between gap-3 rounded-md border border-border bg-background/60 px-3 dark:bg-transparent">
        <span class="flex h-7 min-w-0 flex-1 items-center truncate font-mono text-[0.8rem] leading-none text-foreground">{website}</span>
        <button
          type="button"
          onclick={() => removeHost(website)}
          aria-label={`Remove ${website}`}
          data-app-tooltip-disabled="true"
          class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 size={13} strokeWidth={2.25} />
        </button>
      </div>
    {:else}
      <div class="rounded-md border border-dashed border-border px-3 py-2 text-[0.8rem] text-muted-foreground">
        {emptyText}
      </div>
    {/each}
  </div>
{/snippet}

<div class="flex flex-col gap-6">
  <section class="flex flex-col gap-4">
    <h2 class="px-1 text-[0.866667rem] font-semibold text-foreground">Browser configuration</h2>
    <div class="flex flex-col gap-3" aria-label="Blocking schedule">
      <ToggleSetting
        label="Enable during focus"
        description="Apply website rules while a focus session is running"
        checked={stopper.enabled}
        onChange={(checked) => stopper.setEnabled(checked)}
      />
      <ToggleSetting
        label="Block during short breaks"
        description="Apply website rules during short breaks"
        checked={stopper.blockDuringShortBreaks}
        onChange={(checked) => stopper.setBlockDuringShortBreaks(checked)}
      />
      <ToggleSetting
        label="Block during long breaks"
        description="Apply website rules during long breaks"
        checked={stopper.blockDuringLongBreaks}
        onChange={(checked) => stopper.setBlockDuringLongBreaks(checked)}
      />
    </div>

    <div class="flex flex-col gap-2 px-1">
      <div class="min-w-0">
        <h3 class="text-[0.866667rem] text-foreground">Website mode</h3>
        <div class="mt-0.5 text-[0.8rem] text-muted-foreground">
          Choose whether Doomscrolling blocks selected websites or only allows selected websites
        </div>
      </div>
      <div class="grid grid-cols-2 gap-2 max-[560px]:grid-cols-1">
        {#each modeOptions as option}
          {@const Icon = option.icon}
          {@const active = stopper.mode === option.mode}
          <button
            type="button"
            onclick={() => stopper.setMode(option.mode)}
            class={cn(
              "flex min-h-18 items-start gap-2.5 rounded-md border px-3 py-2 text-left transition-colors",
              active
                ? "border-primary bg-accent/70 text-foreground"
                : "border-border bg-background/60 text-foreground hover:bg-accent/40 dark:bg-transparent",
            )}
            aria-pressed={active}
          >
            <Icon size={16} strokeWidth={2} class="mt-0.5 shrink-0" />
            <span class="min-w-0">
              <span class="block text-[0.866667rem] font-medium">{option.label}</span>
              <span class="mt-0.5 block text-[0.8rem] text-muted-foreground">{option.description}</span>
            </span>
          </button>
        {/each}
      </div>
    </div>
  </section>

  <div class="h-px bg-border/70" aria-hidden="true"></div>

  {#if stopper.mode === "blacklist"}
    {@render modeWebsiteSection("Blacklist mode", blacklistWebsiteSections)}
  {:else}
    {@render modeWebsiteSection("Whitelist mode", whitelistWebsiteSections)}
  {/if}
</div>
