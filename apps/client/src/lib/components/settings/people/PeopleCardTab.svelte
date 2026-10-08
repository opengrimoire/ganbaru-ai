<script lang="ts">
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
  <div class="px-1 py-1">
    <ContactCard />
  </div>
</section>

<section class="flex flex-col gap-4">
  <h2 class="px-1 text-[0.866667rem] font-semibold text-foreground">{t("people.trust.heading")}</h2>
  <div class="flex flex-col gap-3">
    <Select label={t("people.trust.inviteMe")} description={t("people.trust.inviteMeDescription")} value={DEFAULT_TRUST} options={durationOptions} unavailable onChange={() => undefined} />
    <Select label={t("people.trust.messageMe")} description={t("people.trust.messageMeDescription")} value={DEFAULT_TRUST} options={durationOptions} unavailable onChange={() => undefined} />
  </div>
</section>
