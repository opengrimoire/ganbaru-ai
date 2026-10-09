<script lang="ts">
  import { untrack } from "svelte";
  import { normalizePeopleError, type PeopleContact } from "$lib/api/people";
  import Select from "$lib/components/ui/Select.svelte";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { peopleMutationErrorKey, type PeopleMutationErrorKey } from "$lib/people/presentation";
  import { trustDurationForKind, trustKindForDuration } from "$lib/people/trust";
  import { isPeopleTrustDuration, PEOPLE_TRUST_DURATIONS, type PeopleTrustDuration } from "$lib/stores/preference-options";
  import { getPeople } from "$lib/stores/people.svelte";
  import PeopleDialog from "./PeopleDialog.svelte";

  /** Edits what one contact may do without asking. Timed grants restart from the moment they are saved. */
  let {
    contact,
    onClose,
  }: {
    contact: PeopleContact;
    onClose: () => void;
  } = $props();

  const { t } = getLocalization();
  const people = getPeople();
  let invite = $state<PeopleTrustDuration>(untrack(() => trustDurationForKind(contact.inviteTrust)));
  let message = $state<PeopleTrustDuration>(untrack(() => trustDurationForKind(contact.messageTrust)));
  let saving = $state(false);
  let error = $state<PeopleMutationErrorKey | null>(null);
  const durationOptions = $derived(PEOPLE_TRUST_DURATIONS.map((value) => ({ value, label: t(`people.trust.duration.${value}`) })));

  async function save(): Promise<void> {
    if (saving) return;
    saving = true;
    error = null;
    try {
      await people.updateTrust(
        { id: contact.id, expectedRevision: contact.revision },
        { inviteTrust: trustKindForDuration(invite), messageTrust: trustKindForDuration(message) },
      );
      onClose();
    } catch (cause: unknown) {
      error = peopleMutationErrorKey(normalizePeopleError(cause).code);
    } finally {
      saving = false;
    }
  }
</script>

<PeopleDialog
  title={t("people.contacts.editTrust")}
  description={t("people.contacts.editTrustDescription", contact.displayName)}
  cancelLabel={t("people.invite.cancel")}
  confirmLabel={t("people.contacts.save")}
  confirmDisabled={saving}
  onConfirm={() => { void save(); }}
  {onClose}
>
  <Select
    label={t("people.trust.inviteMe")}
    description={t("people.trust.inviteMeDescription")}
    value={invite}
    options={durationOptions}
    onChange={(value) => { if (isPeopleTrustDuration(value)) invite = value; }}
  />
  <Select
    label={t("people.trust.messageMe")}
    description={t("people.trust.messageMeDescription")}
    value={message}
    options={durationOptions}
    onChange={(value) => { if (isPeopleTrustDuration(value)) message = value; }}
  />
  {#if error}
    <p class="text-panel-detail text-destructive" aria-live="polite">{t(`people.contacts.error.${error}`)}</p>
  {/if}
</PeopleDialog>
