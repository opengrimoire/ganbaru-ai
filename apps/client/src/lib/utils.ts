import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
	if (!(target instanceof Element)) return false;
	return target.closest("input, textarea, select, [contenteditable='true'], [contenteditable='plaintext-only']") !== null;
}

export function isAppShortcutBlockedTarget(target: EventTarget | null): boolean {
	if (!(target instanceof Element)) return false;
	return target.closest("[data-app-shortcuts='ignore']") !== null;
}
