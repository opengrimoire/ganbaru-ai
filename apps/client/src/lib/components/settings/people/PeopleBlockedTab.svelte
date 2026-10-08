<script lang="ts">
  import Ban from "@lucide/svelte/icons/ban";
  import PeopleEmptyState from "$lib/components/people/PeopleEmptyState.svelte";
  import { getLocalization } from "$lib/i18n/translator.svelte";

  /** People the local person blocked. Blocking is silent and reversible only by a new contact request. */
  const { t } = getLocalization();
</script>

<section class="flex flex-col gap-4">
  <h2 class="px-1 text-[0.866667rem] font-semibold text-foreground">{t("people.blocked.heading")}</h2>
  <div class="px-1">
    <PeopleEmptyState title={t("people.blocked.emptyTitle")} description={t("people.blocked.emptyDescription")}>
      {#snippet icon()}<Ban size={24} strokeWidth={1.5} />{/snippet}
    </PeopleEmptyState>
  </div>
</section>
