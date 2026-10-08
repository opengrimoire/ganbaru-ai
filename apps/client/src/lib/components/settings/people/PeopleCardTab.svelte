<script lang="ts">
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import ContactCard from "$lib/components/people/ContactCard.svelte";
  import { PEOPLE_TRUST_DURATIONS, type PeopleTrustDuration } from "$lib/components/people/model";
  import Select from "$lib/components/ui/Select.svelte";
  import { getLocalization } from "$lib/i18n/translator.svelte";

  /** Contact card plus the trust scopes every new contact starts with. Asking every time is the privacy-first default. */
  const DEFAULT_TRUST: PeopleTrustDuration = "notAllowed";
  const { t } = getLocalization();
  const durationOptions = $derived(PEOPLE_TRUST_DURATIONS.map((value) => ({ value, label: t(`people.trust.duration.${value}`) })));
</script>

<section class="flex flex-col gap-4">
  <h2 class="px-1 text-[0.866667rem] font-semibold text-foreground">{t("people.card.heading")}</h2>
  <div class="flex flex-col gap-3">
    <div class="px-1 py-1">
      <ContactCard />
    </div>
    <div class="flex items-center justify-between gap-4 px-1 py-1 max-[480px]:flex-col max-[480px]:items-stretch max-[480px]:gap-2">
      <div class="min-w-0 flex-1">
        <div class="text-[0.866667rem] text-foreground">{t("people.card.regenerate")}</div>
        <div class="mt-0.5 text-[0.8rem] text-muted-foreground">{t("people.card.regenerateDescription")}</div>
      </div>
      <button type="button" class="people-settings-action control-unavailable" aria-disabled="true"><RefreshCw size={13} />{t("people.card.regenerateAction")}</button>
    </div>
  </div>
</section>

<section class="flex flex-col gap-4">
  <h2 class="px-1 text-[0.866667rem] font-semibold text-foreground">{t("people.trust.heading")}</h2>
  <div class="flex flex-col gap-3">
    <Select label={t("people.trust.inviteMe")} description={t("people.trust.inviteMeDescription")} value={DEFAULT_TRUST} options={durationOptions} unavailable onChange={() => undefined} />
    <Select label={t("people.trust.messageMe")} description={t("people.trust.messageMeDescription")} value={DEFAULT_TRUST} options={durationOptions} unavailable onChange={() => undefined} />
  </div>
</section>

<style>
  .people-settings-action { display: inline-flex; height: 1.75rem; flex: 0 0 auto; align-items: center; justify-content: center; gap: 0.375rem; border: 1px solid var(--border); border-radius: 0.375rem; padding-inline: 0.625rem; color: var(--foreground); font-size: calc(0.8rem * var(--type-scale)); font-weight: 500; transition: background-color 120ms ease; }
  .people-settings-action:hover { background: var(--accent); }
</style>
