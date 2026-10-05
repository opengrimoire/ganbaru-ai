/** Returns the first grapheme-like character from each of the first two name words. */
export function profileInitials(displayName: string): string {
  const initials = displayName
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => Array.from(part)[0] ?? "")
    .join("")
    .toLocaleUpperCase();
  return initials || "?";
}
