import { describe, expect, it } from "vitest";
import {
	MISSING_PRESERVED_COMPONENT_WARNING,
	deriveIcalendarProjectionState,
} from "./projection-state";

describe("deriveIcalendarProjectionState", () => {
	it("keeps linked preservation status and warnings unchanged", () => {
		const state = deriveIcalendarProjectionState({
			sourceUid: "event@example.com",
			componentId: "component-1",
			preservationStatus: "partial",
			projectionWarnings: ["warning"],
		});

		expect(state).toEqual({
			preservationStatus: "partial",
			projectionWarnings: ["warning"],
		});
	});

	it("marks old imported rows without preserved components as regenerated", () => {
		const state = deriveIcalendarProjectionState({
			sourceUid: "old-import@example.com",
			componentId: null,
			preservationStatus: null,
			projectionWarnings: undefined,
		});

		expect(state).toEqual({
			preservationStatus: "regenerated",
			projectionWarnings: [MISSING_PRESERVED_COMPONENT_WARNING],
		});
	});

	it("does not mark local rows without source UIDs as imported regeneration", () => {
		const state = deriveIcalendarProjectionState({
			sourceUid: null,
			componentId: null,
			preservationStatus: null,
			projectionWarnings: undefined,
		});

		expect(state).toEqual({
			projectionWarnings: undefined,
		});
	});
});
