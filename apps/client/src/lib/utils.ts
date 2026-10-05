import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

/** A callback result that may be returned directly or through a promise. */
export type MaybePromise<T = void> = T | Promise<T>;

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
	if (!(target instanceof Element)) return false;
	return target.closest("input, textarea, select, [contenteditable='true'], [contenteditable='plaintext-only']") !== null;
}

export function isAppShortcutBlockedTarget(target: EventTarget | null): boolean {
	if (!(target instanceof Element)) return false;
	return target.closest("[data-app-shortcuts='ignore']") !== null;
}

export const APP_FLOATING_SURFACE_SELECTOR = "[data-app-floating-surface]";

/**
 * Returns whether the event target belongs to a portaled app surface.
 */
export function isAppFloatingSurfaceTarget(target: EventTarget | null): boolean {
	if (!(target instanceof Node)) return false;
	const element = target instanceof Element ? target : target.parentElement;
	return element?.closest(APP_FLOATING_SURFACE_SELECTOR) !== null;
}

export type FocusIntentKeydown = Pick<KeyboardEvent, "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey">;

export function shouldUseKeyboardFocusIntent(event: FocusIntentKeydown): boolean {
	return event.key === "Tab" && !event.altKey && !event.ctrlKey && !event.metaKey;
}
