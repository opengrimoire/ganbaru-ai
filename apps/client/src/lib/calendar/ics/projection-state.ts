import type { IcalendarPreservationStatus } from "$lib/components/calendar/types";

export const MISSING_PRESERVED_COMPONENT_WARNING =
	"No preserved iCalendar component is linked. Export will regenerate this event from normalized fields.";

export interface IcalendarProjectionStateInput {
	sourceUid: string | null;
	componentId: string | null;
	preservationStatus: IcalendarPreservationStatus | null;
	projectionWarnings: string[] | undefined;
}

export interface IcalendarProjectionState {
	preservationStatus?: IcalendarPreservationStatus;
	projectionWarnings?: string[];
}

export function deriveIcalendarProjectionState(
	input: IcalendarProjectionStateInput,
): IcalendarProjectionState {
	if (input.preservationStatus) {
		return {
			preservationStatus: input.preservationStatus,
			projectionWarnings: input.projectionWarnings,
		};
	}
	if (!input.sourceUid || input.componentId) {
		return {
			projectionWarnings: input.projectionWarnings,
		};
	}
	return {
		preservationStatus: "regenerated",
		projectionWarnings: [
			...(input.projectionWarnings ?? []),
			MISSING_PRESERVED_COMPONENT_WARNING,
		],
	};
}
