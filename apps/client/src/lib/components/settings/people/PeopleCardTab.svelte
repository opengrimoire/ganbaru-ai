<script lang="ts">
  import ContactCard from "$lib/components/people/ContactCard.svelte";
  import Select from "$lib/components/ui/Select.svelte";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { isPeopleTrustDuration, PEOPLE_TRUST_DURATIONS } from "$lib/stores/preference-options";
  import { getPreferences } from "$lib/stores/preferences.svelte";

  /** Contact card plus the trust scopes every new contact starts with. Asking every time is the privacy-first default. */
  const { t } = getLocalization();
  const preferences = getPreferences();
  const durationOptions = $derived(PEOPLE_TRUST_DURATIONS.map((value) => ({ value, label: t(`people.trust.duration.${value}`) })));
</script>

<section class="flex flex-col gap-4">
  <h2 class="px-1 text-[0.866667rem] font-semibold text-foreground">{t("people.card.heading")}</h2>
  <div class="px-1 py-1">
    <ContactCard />
  </div>
</section>

<section class="flex flex-col gap-4">
  <h2 class="px-1 text-[0.866667rem] font-semibold text-foreground">{t("people.trust.heading")}</h2>
  <div class="flex flex-col gap-3">
    <Select
      label={t("people.trust.inviteMe")}
      description={t("people.trust.inviteMeDescription")}
      value={preferences.peopleInviteTrustDefault}
      options={durationOptions}
      onChange={(value) => { if (isPeopleTrustDuration(value)) preferences.setPeopleInviteTrustDefault(value); }}
    />
    <Select
      label={t("people.trust.messageMe")}
      description={t("people.trust.messageMeDescription")}
      value={preferences.peopleMessageTrustDefault}
      options={durationOptions}
      onChange={(value) => { if (isPeopleTrustDuration(value)) preferences.setPeopleMessageTrustDefault(value); }}
    />
  </div>
</section>
