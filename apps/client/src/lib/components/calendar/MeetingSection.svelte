<script lang="ts">
  import type { EventAttendee, EventOrganizer, EventSurfaceStatus, GeoCoordinates } from "./types";
  import { bounceIcon, panelInputKeydown } from "./event-panel-utils";
  import { createSmoothScroll } from "./utils";
  import DescriptionEditor from "./DescriptionEditor.svelte";
  import { slide } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import Users from "@lucide/svelte/icons/users";
  import MapPin from "@lucide/svelte/icons/map-pin";
  import Video from "@lucide/svelte/icons/video";
  import Check from "@lucide/svelte/icons/check";
  import CircleHelp from "@lucide/svelte/icons/circle-help";
  import Minus from "@lucide/svelte/icons/minus";
  import X from "@lucide/svelte/icons/x";
  import Flag from "@lucide/svelte/icons/flag";
  import Plus from "@lucide/svelte/icons/plus";
  import Pencil from "@lucide/svelte/icons/pencil";
  import UserPlus from "@lucide/svelte/icons/user-plus";
  import Eye from "@lucide/svelte/icons/eye";

  let {
    enabled,
    url = $bindable(""),
    location = $bindable(""),
    geo,
    attendees = $bindable([]),
    localParticipationStatus = $bindable(undefined),
    guestCanModify = $bindable(false),
    guestCanInviteOthers = $bindable(true),
    guestCanSeeOtherGuests = $bindable(true),
    organizer,
    selfEmail,
    description,
    readOnly = false,
    expanded,
    onchange,
    ondescriptionchange,
    onexpand,
    onsurfacestatuschange,
    ontoggle,
  }: {
    enabled: boolean;
    url: string;
    location: string;
    geo?: GeoCoordinates;
    attendees: EventAttendee[];
    localParticipationStatus?: EventAttendee["status"];
    guestCanModify: boolean;
    guestCanInviteOthers: boolean;
    guestCanSeeOtherGuests: boolean;
    organizer?: EventOrganizer;
    selfEmail?: string;
    description: string;
    readOnly?: boolean;
    expanded: boolean;
    onchange: () => void;
    ondescriptionchange: (html: string) => void;
    onexpand: () => void;
    onsurfacestatuschange?: (status: EventSurfaceStatus | undefined) => void;
    ontoggle: () => void;
  } = $props();

  const hasContent = $derived(
    attendees.length > 0 || !!organizer || !!url || !!location,
  );

  const organizerEmail = $derived(organizer?.email.toLowerCase() ?? "");
  const normalizedSelfEmail = $derived(selfEmail?.toLowerCase() ?? "");
  const isOrganizerSelf = $derived(!!normalizedSelfEmail && organizerEmail === normalizedSelfEmail);
  const visibleAttendees = $derived(
    organizerEmail
      ? attendees.filter((attendee) => attendee.email.toLowerCase() !== organizerEmail)
      : attendees,
  );
  const selfAttendee = $derived(
    normalizedSelfEmail
      ? visibleAttendees.find((attendee) => attendee.email.toLowerCase() === normalizedSelfEmail)
      : undefined,
  );
  const guestAttendees = $derived(
    selfAttendee
      ? visibleAttendees.filter((attendee) => attendee.id !== selfAttendee.id)
      : visibleAttendees,
  );
  const showLocalSelfRow = $derived(enabled && !organizer && !selfAttendee);
  const effectiveLocalSelfStatus = $derived(localParticipationStatus ?? "accepted");
  const canEditGuests = $derived(!readOnly && !organizer);
  const surfaceStatus = $derived.by<EventSurfaceStatus | undefined>(() => {
    if (!enabled) return undefined;
    if (selfAttendee) return selfAttendee.status;
    if (showLocalSelfRow) return effectiveLocalSelfStatus;
    if (isOrganizerSelf) return "accepted";
    return undefined;
  });

  /** Collapsed summary: attendee count, location, URL host, joined with middle dots. */
  const summary = $derived.by(() => {
    if (!enabled || !hasContent) return "";
    const parts: string[] = [];
    const peopleCount = visibleAttendees.length + (organizer ? 1 : 0);
    if (peopleCount > 0) {
      parts.push(organizer ? `${peopleCount} people` : `${peopleCount} attendee${peopleCount === 1 ? "" : "s"}`);
    }
    if (location) parts.push(location);
    if (url) {
      let host = "";
      try { host = new URL(url).host; } catch { host = ""; }
      if (host) parts.push(host);
    }
    return parts.join(" · ");
  });

  let urlInput: HTMLInputElement | undefined = $state();

  // When the section opens into an empty state, focus the URL input so the
  // "start a meeting" shortcut drops the caret on the first field the user sees.
  let wasExpanded = false;
  $effect(() => {
    const nowExpanded = expanded;
    if (nowExpanded && !wasExpanded && !hasContent && !readOnly) {
      setTimeout(() => urlInput?.focus(), 220);
    }
    wasExpanded = nowExpanded;
  });

  let attendeeInput = $state("");

  $effect(() => {
    onsurfacestatuschange?.(surfaceStatus);
  });

  function addAttendee() {
    const email = attendeeInput.trim();
    const normalized = email.toLowerCase();
    if (!email || organizerEmail === normalized || attendees.some((a) => a.email.toLowerCase() === normalized)) return;
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

  function attendeeStatusLabel(status: EventAttendee["status"]): string {
    return status === "needs-action" ? "pending" : status;
  }

  function optionalActionClass(disabled: boolean, optional: boolean): string {
    if (disabled) return "cursor-not-allowed rounded p-0.5 text-muted-foreground/20";
    return `rounded p-0.5 active:scale-75 ${optional ? "text-muted-foreground/40" : "text-foreground"}`;
  }

  function removeActionClass(disabled: boolean): string {
    if (disabled) return "cursor-not-allowed rounded p-0.5 text-muted-foreground/20";
    return "rounded p-0.5 text-muted-foreground active:scale-75 hover:text-destructive";
  }

  function nextRsvpStatus(status: EventAttendee["status"]): EventAttendee["status"] {
    if (status === "accepted") return "tentative";
    if (status === "tentative") return "declined";
    if (status === "declined") return "needs-action";
    return "accepted";
  }

  function toggleLocalSelfRsvp() {
    const nextStatus = nextRsvpStatus(effectiveLocalSelfStatus);
    localParticipationStatus = nextStatus === "accepted" ? undefined : nextStatus;
    onchange();
  }

  let scrollEl: HTMLDivElement | undefined = $state();
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

  const onWheel = createSmoothScroll(() => scrollEl, 2, 8);
</script>

<div class="flex flex-col rounded-none overflow-hidden" style="background-color: var(--panel-contrast);">
  <div class="section-header flex items-stretch">
    <button onclick={(e) => { bounceIcon(e); ontoggle(); }}
      disabled={readOnly}
      class="flex w-9 shrink-0 items-center justify-center
        {enabled ? 'bg-black/3 dark:bg-black/30 text-foreground' : 'text-muted-foreground/50'}">
      <Users size={13} />
    </button>
    <button onclick={onexpand}
      disabled={readOnly}
      class="flex flex-1 items-center gap-2 px-2.5 py-2 text-left">
      <span class="translate-y-[1.13px] text-[11px] {enabled ? 'text-foreground' : 'text-muted-foreground'}">Meeting</span>
      {#if enabled && summary}
        <span class="ml-auto translate-y-[1.13px] truncate text-[10px] text-muted-foreground">{summary}</span>
      {/if}
    </button>
  </div>
  {#if expanded}
    <div transition:slide={{ duration: 180, easing: cubicOut }} data-section="meeting" class="flex flex-col gap-2.5 px-3 pt-3 pb-3" style="background-color: var(--panel-bg);">
      <!-- URL -->
      <div class="flex items-center gap-2.5 text-[11px] leading-none">
        <Video size={13} class="shrink-0 text-foreground" />
        <input bind:this={urlInput} type="url" bind:value={url} placeholder="Add call link"
          disabled={readOnly}
          class="min-w-0 flex-1 bg-transparent leading-none text-foreground outline-none placeholder:text-muted-foreground/40"
          oninput={onchange} onkeydown={panelInputKeydown} />
      </div>
      <!-- Location -->
      <div class="flex items-center gap-2.5 text-[11px] leading-none">
        <MapPin size={13} class="shrink-0 text-foreground" />
        <input type="text" bind:value={location} placeholder="Add location"
          disabled={readOnly}
          class="min-w-0 flex-1 bg-transparent leading-none text-foreground outline-none placeholder:text-muted-foreground/40"
          oninput={onchange} onkeydown={panelInputKeydown} />
        {#if geo}
          <span class="shrink-0 text-[10px] text-muted-foreground/60">({geo.lat.toFixed(2)}, {geo.lng.toFixed(2)})</span>
        {/if}
      </div>
      <!-- Description -->
      <DescriptionEditor {description} {readOnly} onchange={ondescriptionchange} />
      <!-- Guests divider -->
      <div class="-mx-3 border-t border-border/40"></div>
      <!-- Guests -->
      <div class="flex flex-col">
        <div class="flex items-center gap-2 pb-1">
          <span class="text-[9px] uppercase tracking-wider text-muted-foreground">Guests</span>
          {#if canEditGuests && guestAttendees.length > 0}
            <div class="ml-auto flex flex-wrap items-center justify-end gap-1">
              {#each [
                { icon: Pencil, label: "Edit", title: "Modify event", get: () => guestCanModify, set: (v: boolean) => { guestCanModify = v; onchange(); } },
                { icon: UserPlus, label: "Invite", title: "Invite others", get: () => guestCanInviteOthers, set: (v: boolean) => { guestCanInviteOthers = v; onchange(); } },
                { icon: Eye, label: "See list", title: "See guest list", get: () => guestCanSeeOtherGuests, set: (v: boolean) => { guestCanSeeOtherGuests = v; onchange(); } },
              ] as perm}
                <button onclick={() => perm.set(!perm.get())} title={perm.title}
                  class="flex items-center gap-1 rounded px-1 py-0.5 active:scale-95
                    {perm.get() ? 'bg-foreground/10 text-foreground' : 'bg-foreground/5 text-muted-foreground/30 hover:text-muted-foreground/50'}">
                  <perm.icon size={11} strokeWidth={2} />
                  <span class="text-[9px] max-[320px]:hidden">{perm.label}</span>
                </button>
              {/each}
            </div>
          {/if}
        </div>
        {#if organizer}
          <div class="flex items-center gap-2 py-0.5 text-[11px]">
            <span class="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] bg-status-accepted"><Check size={10} strokeWidth={2.5} class="block text-status-accepted-foreground" /></span>
            <span class="min-w-0 flex-1 truncate text-foreground">
              {isOrganizerSelf ? `You (${organizer.email})` : organizer.name ?? organizer.email}
            </span>
            <span class="shrink-0 text-[10px] text-muted-foreground/60">organizer</span>
            <div class="flex shrink-0 items-center gap-0.5">
              <button
                disabled
                title="Organizer cannot be marked optional"
                aria-label="Organizer cannot be marked optional"
                class={optionalActionClass(true, false)}>
                <Flag size={11} />
              </button>
              <button
                disabled
                title="Organizer cannot be removed"
                aria-label="Organizer cannot be removed"
                class={removeActionClass(true)}>
                <X size={11} />
              </button>
            </div>
          </div>
        {/if}
        {#if selfAttendee}
          {@const selfStatus = selfAttendee.status}
          {@const selfBg = selfStatus === "accepted" ? "bg-status-accepted" : selfStatus === "tentative" ? "bg-status-tentative" : selfStatus === "declined" ? "bg-status-declined" : "bg-muted-foreground/30"}
          {@const selfFg = selfStatus === "accepted" ? "text-status-accepted-foreground" : selfStatus === "tentative" ? "text-status-tentative-foreground" : selfStatus === "declined" ? "text-status-declined-foreground" : "text-foreground"}
          {@const SelfIcon = selfStatus === "accepted" ? Check : selfStatus === "tentative" ? CircleHelp : selfStatus === "declined" ? X : Minus}
          {@const selfStatusLabel = attendeeStatusLabel(selfStatus)}
          <div class="flex items-center gap-2 py-0.5 text-[11px]">
            <span
              class="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] {selfBg}"
              title={`Your RSVP status: ${selfStatusLabel}`}>
              <SelfIcon size={10} strokeWidth={2.5} class="block {selfFg}" />
            </span>
            <span class="min-w-0 flex-1 truncate text-foreground">You ({selfAttendee.email})</span>
            <span class="shrink-0 text-[10px] text-muted-foreground/60">{selfStatusLabel}</span>
            <div class="flex shrink-0 items-center gap-0.5">
              <button
                disabled
                title="Your imported attendee row cannot be marked optional yet"
                aria-label="Your imported attendee row cannot be marked optional yet"
                class={optionalActionClass(true, selfAttendee.role === "opt-participant")}>
                <Flag size={11} />
              </button>
              <button
                disabled
                title="Your imported attendee row cannot be removed yet"
                aria-label="Your imported attendee row cannot be removed yet"
                class={removeActionClass(true)}>
                <X size={11} />
              </button>
            </div>
          </div>
        {/if}
        {#if showLocalSelfRow}
          {@const localSelfBg = effectiveLocalSelfStatus === "accepted" ? "bg-status-accepted" : effectiveLocalSelfStatus === "tentative" ? "bg-status-tentative" : effectiveLocalSelfStatus === "declined" ? "bg-status-declined" : "bg-muted-foreground/30"}
          {@const localSelfFg = effectiveLocalSelfStatus === "accepted" ? "text-status-accepted-foreground" : effectiveLocalSelfStatus === "tentative" ? "text-status-tentative-foreground" : effectiveLocalSelfStatus === "declined" ? "text-status-declined-foreground" : "text-foreground"}
          {@const LocalSelfIcon = effectiveLocalSelfStatus === "accepted" ? Check : effectiveLocalSelfStatus === "tentative" ? CircleHelp : effectiveLocalSelfStatus === "declined" ? X : Minus}
          {@const localSelfStatusLabel = attendeeStatusLabel(effectiveLocalSelfStatus)}
          <div class="flex items-center gap-2 py-0.5 text-[11px]">
            <button
              type="button"
              onclick={toggleLocalSelfRsvp}
              disabled={readOnly}
              class="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] {localSelfBg} {readOnly ? 'cursor-not-allowed opacity-60' : 'active:scale-90'}"
              title={`Toggle local RSVP: ${localSelfStatusLabel}`}
              aria-label={`Toggle local RSVP: ${localSelfStatusLabel}`}>
              <LocalSelfIcon size={10} strokeWidth={2.5} class="block {localSelfFg}" />
            </button>
            <span class="min-w-0 flex-1 truncate text-foreground">You (Local, no email provided)</span>
            <span class="shrink-0 text-[10px] text-muted-foreground/60">{localSelfStatusLabel}</span>
            <div class="flex shrink-0 items-center gap-0.5">
              <button
                disabled
                title="Local user cannot be marked optional until an email is configured"
                aria-label="Local user cannot be marked optional until an email is configured"
                class={optionalActionClass(true, false)}>
                <Flag size={11} />
              </button>
              <button
                disabled
                title="Local user cannot be removed"
                aria-label="Local user cannot be removed"
                class={removeActionClass(true)}>
                <X size={11} />
              </button>
            </div>
          </div>
        {/if}
        {#if guestAttendees.length > 0}
          <!-- svelte-ignore binding_property_non_reactive -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div bind:this={scrollEl} onscroll={updateFade} onwheel={onWheel}
            use:observeResize
            class="relative max-h-18 overflow-y-auto scrollbar-thin"
            style:mask-image={fadeTop && fadeBottom ? 'linear-gradient(to bottom, transparent, black 10px, black calc(100% - 10px), transparent)' : fadeTop ? 'linear-gradient(to bottom, transparent, black 10px)' : fadeBottom ? 'linear-gradient(to bottom, black calc(100% - 10px), transparent)' : 'none'}
            style:-webkit-mask-image={fadeTop && fadeBottom ? 'linear-gradient(to bottom, transparent, black 10px, black calc(100% - 10px), transparent)' : fadeTop ? 'linear-gradient(to bottom, transparent, black 10px)' : fadeBottom ? 'linear-gradient(to bottom, black calc(100% - 10px), transparent)' : 'none'}>
            {#each guestAttendees as att (att.id)}
              {@const sqBg = att.status === "accepted" ? "bg-status-accepted" : att.status === "tentative" ? "bg-status-tentative" : att.status === "declined" ? "bg-status-declined" : "bg-muted-foreground/30"}
              {@const sqFg = att.status === "accepted" ? "text-status-accepted-foreground" : att.status === "tentative" ? "text-status-tentative-foreground" : att.status === "declined" ? "text-status-declined-foreground" : "text-foreground"}
              {@const StatusIcon = att.status === "accepted" ? Check : att.status === "tentative" ? CircleHelp : att.status === "declined" ? X : Minus}
              {@const statusLabel = attendeeStatusLabel(att.status)}
              {@const guestActionsDisabled = !canEditGuests}
              <div class="flex items-center gap-2 py-0.5 text-[11px]">
                <span
                  class="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] {sqBg}"
                  title={`RSVP status: ${statusLabel}`}>
                  <StatusIcon size={10} strokeWidth={2.5} class="block {sqFg}" />
                </span>
                <span class="min-w-0 flex-1 truncate text-foreground">{att.name ?? att.email}</span>
                <span class="shrink-0 text-[10px] text-muted-foreground/60">{statusLabel}</span>
                {#if att.role === "opt-participant"}
                  <span class="shrink-0 text-[10px] text-muted-foreground/60 italic">(optional)</span>
                {/if}
                <div class="flex shrink-0 items-center gap-0.5">
                  <button onclick={() => toggleAttendeeOptional(att.id)}
                    disabled={guestActionsDisabled}
                    title={guestActionsDisabled ? "Attendee roles are read-only for this event" : att.role === "opt-participant" ? "Mark required" : "Mark optional"}
                    aria-label={guestActionsDisabled ? "Attendee roles are read-only for this event" : att.role === "opt-participant" ? "Mark required" : "Mark optional"}
                    class={optionalActionClass(guestActionsDisabled, att.role === "opt-participant")}>
                    <Flag size={11} />
                  </button>
                  <button onclick={() => removeAttendee(att.id)}
                    disabled={guestActionsDisabled}
                    title={guestActionsDisabled ? "Attendees cannot be removed from this event" : "Remove attendee"}
                    aria-label={guestActionsDisabled ? "Attendees cannot be removed from this event" : "Remove attendee"}
                    class={removeActionClass(guestActionsDisabled)}>
                    <X size={11} />
                  </button>
                </div>
              </div>
            {/each}
          </div>
        {/if}
        {#if canEditGuests}
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
                class="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground">
                <Plus size={11} />
              </button>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .scrollbar-thin {
    scrollbar-width: thin;
  }
</style>
