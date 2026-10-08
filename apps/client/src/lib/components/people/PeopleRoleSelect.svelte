<script lang="ts">
  import Select from "$lib/components/ui/Select.svelte";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { PEOPLE_INVITABLE_ROLES, PEOPLE_ROLES, type PeopleRole } from "./model";

  /**
   * Quiet role control shown next to a member. It renders the final look of a role change and stays unavailable
   * until a caller provides `onChange`.
   */
  let {
    value = "member",
    ariaLabel,
    roles = PEOPLE_INVITABLE_ROLES,
    onChange,
  }: {
    value?: PeopleRole;
    ariaLabel: string;
    roles?: readonly PeopleRole[];
    onChange?: (role: PeopleRole) => void;
  } = $props();

  const { t } = getLocalization();
  const options = $derived(roles.map((role) => ({
    value: role,
    label: t(`people.role.${role}`),
    summary: t(`people.role.summary.${role}`),
  })));

  function changeRole(next: string): void {
    const role = PEOPLE_ROLES.find((entry) => entry === next);
    if (role) onChange?.(role);
  }
</script>

<Select inline appearance="quiet" contentAlign="end" {value} {options} {ariaLabel} unavailable={!onChange} onChange={changeRole} />
