import { describe, expect, it } from "vitest";

import { shouldUseKeyboardFocusIntent, type FocusIntentKeydown } from "./utils";

function keydown(overrides: Partial<FocusIntentKeydown>): FocusIntentKeydown {
	return {
		altKey: false,
		ctrlKey: false,
		key: "Tab",
		metaKey: false,
		shiftKey: false,
		...overrides,
	};
}

describe("shouldUseKeyboardFocusIntent", () => {
	it("treats plain tab as keyboard focus navigation", () => {
		expect(shouldUseKeyboardFocusIntent(keydown({ key: "Tab" }))).toBe(true);
	});

	it("keeps shift tab as keyboard focus navigation", () => {
		expect(shouldUseKeyboardFocusIntent(keydown({ shiftKey: true }))).toBe(true);
	});

	it("ignores modified tab app shortcuts", () => {
		expect(shouldUseKeyboardFocusIntent(keydown({ ctrlKey: true }))).toBe(false);
		expect(shouldUseKeyboardFocusIntent(keydown({ ctrlKey: true, shiftKey: true }))).toBe(false);
		expect(shouldUseKeyboardFocusIntent(keydown({ altKey: true }))).toBe(false);
		expect(shouldUseKeyboardFocusIntent(keydown({ metaKey: true }))).toBe(false);
	});

	it("ignores non-tab keys", () => {
		expect(shouldUseKeyboardFocusIntent(keydown({ key: "PageDown" }))).toBe(false);
	});
});
