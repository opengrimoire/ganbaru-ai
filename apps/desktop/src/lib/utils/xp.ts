/**
 * Calculates activity XP earned from a completed focus session.
 * Base: 2 XP per minute of focus. Multiplied by will focus score.
 */
export function calculateActivityXp(
  focusMinutes: number,
  willFocusScore: number = 1.0,
): number {
  return Math.round(focusMinutes * 2 * willFocusScore);
}
