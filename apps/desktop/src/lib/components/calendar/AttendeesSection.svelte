<script lang="ts">
  import type { EventAttendee, EventOrganizer } from "./types";
  import { createSmoothScroll } from "./utils";
  import { slide } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import Users from "@lucide/svelte/icons/users";
  import X from "@lucide/svelte/icons/x";
  import Plus from "@lucide/svelte/icons/plus";
  import Check from "@lucide/svelte/icons/check";
  import Minus from "@lucide/svelte/icons/minus";
  import CircleHelp from "@lucide/svelte/icons/circle-help";
  import Flag from "@lucide/svelte/icons/flag";
  import Pencil from "@lucide/svelte/icons/pencil";
  import UserPlus from "@lucide/svelte/icons/user-plus";
  import Eye from "@lucide/svelte/icons/eye";

  let {
    attendees = $bindable([]),
    guestCanModify = $bindable(false),
    guestCanInviteOthers = $bindable(true),
    guestCanSeeOtherGuests = $bindable(true),
    organizer,
    readOnly = false,
    onchange,
  }: {
    attendees: EventAttendee[];
    guestCanModify: boolean;
    guestCanInviteOthers: boolean;
    guestCanSeeOtherGuests: boolean;
    organizer?: EventOrganizer;
    readOnly?: boolean;
    onchange: () => void;
  } = $props();

  let expanded = $state(false);
  let attendeeInput = $state("");

  function addAttendee() {
    const email = attendeeInput.trim();
    if (!email || attendees.some((a) => a.email === email)) return;
    attendees = [...attendees, {
      id: crypto.randomUUID(),
      email,
      role: "req-participant",
      status: "needs-action",
      rsvp: true,
    }];
    attendeeInput = "";
    onchange();
  }

  function removeAttendee(id: string) {
    attendees = attendees.filter((a) => a.id !== id);
    onchange();
  }

  function toggleAttendeeOptional(id: string) {
    attendees = attendees.map((a) =>
      a.id === id
        ? { ...a, role: a.role === "opt-participant" ? "req-participant" : "opt-participant" }
        : a,
    );
    onchange();
  }

  function setAttendeeStatus(id: string, status: EventAttendee["status"]) {
    attendees = attendees.map((a) => a.id === id ? { ...a, status } : a);
    onchange();
  }

  // ─── Scroll fade ────────────────────────────────────────────────
  let scrollEl: HTMLDivElement | undefined = $state(undefined);
  let fadeTop = $state(false);
  let fadeBottom = $state(false);

  function updateFade() {
    const el = scrollEl;
    if (!el) { fadeTop = false; fadeBottom = false; return; }
    fadeTop = el.scrollTop > 2;
    fadeBottom = el.scrollTop + el.clientHeight < el.scrollHeight - 2;
  }

  function observeResize(node: HTMLElement) {
    const ro = new ResizeObserver(() => updateFade());
    ro.observe(node);
    return { destroy: () => ro.disconnect() };
  }

  const onWheel = createSmoothScroll(() => scrollEl, 0.4, 0.075);
</script>

<div class="border-t border-border/40">
  <button onclick={() => { expanded = !expanded; }}
    class="flex w-full items-center gap-2.5 px-3 py-2 text-[11px] leading-none transition-colors hover:bg-black/5 dark:hover:bg-black/15">
    <Users size={13} class="shrink-0 text-foreground" />
    {#if attendees.length === 0}
      <span class="min-w-0 flex-1 truncate text-left text-muted-foreground/40">Add attendees</span>
    {:else}
      {@const nAcc = attendees.filter((a) => a.status === "accepted").length}
      {@const nPen = attendees.filter((a) => a.status === "needs-action").length}
      {@const nTen = attendees.filter((a) => a.status === "tentative").length}
      {@const nDec = attendees.filter((a) => a.status === "declined").length}
      {@const statParts = [
        nAcc > 0 ? { n: nAcc, bg: "bg-emerald-500", Icon: Check } : null,
        nPen > 0 ? { n: nPen, bg: "bg-muted-foreground/30", Icon: Minus } : null,
        nTen > 0 ? { n: nTen, bg: "bg-amber-500", Icon: CircleHelp } : null,
        nDec > 0 ? { n: nDec, bg: "bg-red-500", Icon: X } : null,
      ].filter((p): p is { n: number; bg: string; Icon: typeof Check } => p !== null)}
      <span class="text-muted-foreground">{attendees.length} attendee{attendees.length !== 1 ? "s" : ""}</span>
      {#if statParts.length > 0}
        <span class="flex items-center gap-0 text-[10px] text-muted-foreground/60">
          <span>(</span>
          {#each statParts as part, i}
            {#if i > 0}<span class="mx-0.5">,</span>{/if}
            <span class="flex items-center gap-px">
              <span>{part.n}</span>
              <span class="flex h-2.5 w-2.5 items-center justify-center rounded-[2px] {part.bg}"><part.Icon size={7} strokeWidth={3} class="block text-white" /></span>
            </span>
          {/each}
          <span>)</span>
        </span>
      {/if}
    {/if}
  </button>
  {#if expanded}
    <div transition:slide={{ duration: 180, easing: cubicOut }} class="flex flex-col px-3 pb-2">
      <!-- Guest permissions -->
      {#if !readOnly && attendees.length > 0}
        <div class="flex items-center gap-2 border-b border-border/40 pb-1.5 mb-1">
          <span class="text-[10px] uppercase tracking-wider text-muted-foreground">Guests can:</span>
          {#each [
            { icon: Pencil, label: "Edit", title: "Modify event", get: () => guestCanModify, set: (v: boolean) => { guestCanModify = v; onchange(); } },
            { icon: UserPlus, label: "Invite", title: "Invite others", get: () => guestCanInviteOthers, set: (v: boolean) => { guestCanInviteOthers = v; onchange(); } },
            { icon: Eye, label: "See guests", title: "See guest list", get: () => guestCanSeeOtherGuests, set: (v: boolean) => { guestCanSeeOtherGuests = v; onchange(); } },
          ] as perm}
            <button onclick={() => perm.set(!perm.get())} title={perm.title}
              class="flex items-center gap-1 rounded px-1 py-0.5 transition-colors active:scale-95
                {perm.get() ? 'bg-foreground/10 text-foreground' : 'bg-foreground/5 text-muted-foreground/30 hover:text-muted-foreground/50'}">
              <perm.icon size={11} strokeWidth={2} />
              <span class="text-[9px]">{perm.label}</span>
            </button>
          {/each}
        </div>
      {/if}
      <!-- Attendee list (scrollable after 3) -->
      <!-- svelte-ignore binding_property_non_reactive -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div bind:this={scrollEl} onscroll={updateFade} onwheel={onWheel}
        use:observeResize
        class="relative max-h-[72px] overflow-y-auto scrollbar-thin pr-3"
        style:mask-image={fadeTop && fadeBottom ? 'linear-gradient(to bottom, transparent, black 10px, black calc(100% - 10px), transparent)' : fadeTop ? 'linear-gradient(to bottom, transparent, black 10px)' : fadeBottom ? 'linear-gradient(to bottom, black calc(100% - 10px), transparent)' : 'none'}
        style:-webkit-mask-image={fadeTop && fadeBottom ? 'linear-gradient(to bottom, transparent, black 10px, black calc(100% - 10px), transparent)' : fadeTop ? 'linear-gradient(to bottom, transparent, black 10px)' : fadeBottom ? 'linear-gradient(to bottom, black calc(100% - 10px), transparent)' : 'none'}>
      {#if organizer}
        <div class="flex items-center gap-2 py-0.5 text-[11px]">
          <span class="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] bg-emerald-500"><Check size={10} strokeWidth={2.5} class="block text-white" /></span>
          <span class="min-w-0 flex-1 truncate text-foreground">{organizer.name ?? organizer.email}</span>
          <span class="shrink-0 text-[10px] text-muted-foreground/60">organizer</span>
        </div>
      {/if}
      {#each attendees as att (att.id)}
        {@const sqBg = att.status === "accepted" ? "bg-emerald-500" : att.status === "tentative" ? "bg-amber-500" : att.status === "declined" ? "bg-red-500" : "bg-muted-foreground/30"}
        {@const StatusIcon = att.status === "accepted" ? Check : att.status === "tentative" ? CircleHelp : att.status === "declined" ? X : Minus}
        {@const statusLabel = att.status === "needs-action" ? "pending" : att.status}
        <div class="flex items-center gap-2 py-0.5 text-[11px]">
          {#if !readOnly}
            <button
              onclick={() => {
                const cycle: EventAttendee["status"][] = ["needs-action", "accepted", "tentative", "declined"];
                const idx = cycle.indexOf(att.status);
                setAttendeeStatus(att.id, cycle[(idx + 1) % cycle.length]);
              }}
              class="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] {sqBg} active:scale-75 transition-transform">
              <StatusIcon size={10} strokeWidth={2.5} class="block text-white" />
            </button>
          {:else}
            <span class="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] {sqBg}">
              <StatusIcon size={10} strokeWidth={2.5} class="block text-white" />
            </span>
          {/if}
          <span class="min-w-0 flex-1 truncate text-foreground">{att.name ?? att.email}</span>
          {#if att.role === "opt-participant"}
            <span class="shrink-0 text-[10px] text-muted-foreground/60 italic">(optional)</span>
          {/if}
          {#if !readOnly}
            <div class="flex shrink-0 items-center gap-0.5">
              <button onclick={() => toggleAttendeeOptional(att.id)}
                class="rounded p-0.5 transition-colors
                  {att.role === 'opt-participant' ? 'text-muted-foreground/40' : 'text-foreground'}
                  hover:text-foreground">
                <Flag size={11} />
              </button>
              <button onclick={() => removeAttendee(att.id)}
                class="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground">
                <X size={11} />
              </button>
            </div>
          {:else}
            <span class="shrink-0 text-[10px] text-muted-foreground/60">{statusLabel}</span>
          {/if}
        </div>
      {/each}
      </div>
      {#if !readOnly}
        <div class="flex items-center gap-2 py-1">
          <span class="h-3.5 w-3.5 shrink-0"></span>
          <input type="email" bind:value={attendeeInput}
            placeholder="Add email..."
            class="min-w-0 flex-1 bg-transparent text-[11px] leading-none text-foreground outline-none placeholder:text-muted-foreground/40"
            onkeydown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") { e.preventDefault(); addAttendee(); }
            }} />
          {#if attendeeInput.trim()}
            <button onclick={addAttendee}
              class="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground">
              <Plus size={11} />
            </button>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .scrollbar-thin {
    scrollbar-width: thin;
  }
</style>
