import { describe, expect, it } from "vitest";

import { cn, shouldUseKeyboardFocusIntent, type FocusIntentKeydown } from "./utils";

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

describe("cn", () => {
	it("keeps custom theme text sizes alongside text colors", () => {
		expect(cn("text-paragraph", "text-muted-foreground")).toBe("text-paragraph text-muted-foreground");
		expect(cn("text-identity font-medium", "text-foreground")).toBe("text-identity font-medium text-foreground");
	});

	it("lets a later custom text size replace an earlier size", () => {
		expect(cn("text-[0.8rem]", "text-paragraph")).toBe("text-paragraph");
		expect(cn("text-sm", "text-identity")).toBe("text-identity");
	});
});
