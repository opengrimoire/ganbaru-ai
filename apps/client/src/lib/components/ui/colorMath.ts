/**
 * Pure color math helpers used by the in-house color picker.
 *
 * The picker stores state as HSV internally because the SV square plus hue
 * slider maps directly onto those three components. RGB and hex are derived
 * for display and persistence. Conversions are lossless within rounding
 * tolerance: hex round-trips through HSV with at most a one-count delta on
 * each channel due to integer rounding.
 */

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

/** RGB with an alpha channel in 0..255 (255 = fully opaque). */
export interface RgbaColor extends RgbColor {
  a: number;
}

export interface HsvColor {
  h: number;
  s: number;
  v: number;
}

const HEX8_RE = /^#?([0-9a-fA-F]{8})$/;
const HEX6_RE = /^#?([0-9a-fA-F]{6})$/;
const HEX4_RE = /^#?([0-9a-fA-F]{4})$/;
const HEX3_RE = /^#?([0-9a-fA-F]{3})$/;

/** Clamp a channel to 0..255 and round to the nearest integer. */
export function clampChannel(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 255) return 255;
  return Math.round(value);
}

/** Clamp hue to 0..360 (wrapping around). */
export function clampHue(value: number): number {
  if (!Number.isFinite(value)) return 0;
  let h = value % 360;
  if (h < 0) h += 360;
  return h;
}

/** Clamp saturation/value to 0..100. */
export function clampPercent(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 100) return 100;
  return value;
}

/**
 * Normalize a hex input. Accepts 3, 4, 6, and 8 digit hex with or without a
 * leading #. Returns "#rrggbb" when fully opaque, "#rrggbbaa" otherwise.
 * Returns null when the input cannot be parsed.
 */
export function normalizeHex(input: string): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  const match8 = HEX8_RE.exec(trimmed);
  if (match8) {
    const lower = match8[1].toLowerCase();
    const alpha = lower.slice(6, 8);
    return alpha === "ff" ? `#${lower.slice(0, 6)}` : `#${lower}`;
  }
  const match6 = HEX6_RE.exec(trimmed);
  if (match6) return `#${match6[1].toLowerCase()}`;
  const match4 = HEX4_RE.exec(trimmed);
  if (match4) {
    const [r, g, b, a] = match4[1].toLowerCase();
    if (a === "f") return `#${r}${r}${g}${g}${b}${b}`;
    return `#${r}${r}${g}${g}${b}${b}${a}${a}`;
  }
  const match3 = HEX3_RE.exec(trimmed);
  if (match3) {
    const [r, g, b] = match3[1].toLowerCase();
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return null;
}

/** Convert a hex string to RGB components (alpha, if any, is discarded). */
export function hexToRgb(input: string): RgbColor | null {
  const rgba = hexToRgba(input);
  if (!rgba) return null;
  return { r: rgba.r, g: rgba.g, b: rgba.b };
}

/**
 * Convert a hex string to RGBA components. Inputs without alpha default to
 * a = 255 (fully opaque).
 */
export function hexToRgba(input: string): RgbaColor | null {
  const normalized = normalizeHex(input);
  if (!normalized) return null;
  const r = parseInt(normalized.slice(1, 3), 16);
  const g = parseInt(normalized.slice(3, 5), 16);
  const b = parseInt(normalized.slice(5, 7), 16);
  const a = normalized.length === 9 ? parseInt(normalized.slice(7, 9), 16) : 255;
  return { r, g, b, a };
}

/** Convert RGB components to a 6-digit lowercase hex string. */
export function rgbToHex(r: number, g: number, b: number): string {
  const cr = clampChannel(r).toString(16).padStart(2, "0");
  const cg = clampChannel(g).toString(16).padStart(2, "0");
  const cb = clampChannel(b).toString(16).padStart(2, "0");
  return `#${cr}${cg}${cb}`;
}

/**
 * Convert RGBA components to a hex string. Emits 6 digits when a = 255
 * (fully opaque), 8 digits otherwise. Keeps fully-opaque colors in their
 * canonical short form.
 */
export function rgbaToHex(r: number, g: number, b: number, a: number): string {
  const cr = clampChannel(r).toString(16).padStart(2, "0");
  const cg = clampChannel(g).toString(16).padStart(2, "0");
  const cb = clampChannel(b).toString(16).padStart(2, "0");
  const ca = clampChannel(a);
  if (ca === 255) return `#${cr}${cg}${cb}`;
  const caHex = ca.toString(16).padStart(2, "0");
  return `#${cr}${cg}${cb}${caHex}`;
}

/** Convert RGB (0..255) to HSV (h: 0..360, s/v: 0..100). */
export function rgbToHsv(r: number, g: number, b: number): HsvColor {
  const rN = clampChannel(r) / 255;
  const gN = clampChannel(g) / 255;
  const bN = clampChannel(b) / 255;
  const max = Math.max(rN, gN, bN);
  const min = Math.min(rN, gN, bN);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === rN) h = ((gN - bN) / delta) % 6;
    else if (max === gN) h = (bN - rN) / delta + 2;
    else h = (rN - gN) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : (delta / max) * 100;
  const v = max * 100;
  return { h, s, v };
}

/** Convert HSV (h: 0..360, s/v: 0..100) to RGB (0..255). */
export function hsvToRgb(h: number, s: number, v: number): RgbColor {
  const hue = clampHue(h);
  const sat = clampPercent(s) / 100;
  const val = clampPercent(v) / 100;
  const c = val * sat;
  const hPrime = hue / 60;
  const x = c * (1 - Math.abs((hPrime % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hPrime < 1) {
    r1 = c;
    g1 = x;
  } else if (hPrime < 2) {
    r1 = x;
    g1 = c;
  } else if (hPrime < 3) {
    g1 = c;
    b1 = x;
  } else if (hPrime < 4) {
    g1 = x;
    b1 = c;
  } else if (hPrime < 5) {
    r1 = x;
    b1 = c;
  } else {
    r1 = c;
    b1 = x;
  }
  const m = val - c;
  return {
    r: clampChannel((r1 + m) * 255),
    g: clampChannel((g1 + m) * 255),
    b: clampChannel((b1 + m) * 255),
  };
}

/** Convert a hex color directly to HSV. Returns null on bad input. */
export function hexToHsv(input: string): HsvColor | null {
  const rgb = hexToRgb(input);
  if (!rgb) return null;
  return rgbToHsv(rgb.r, rgb.g, rgb.b);
}

/** Convert HSV directly to a hex color string. */
export function hsvToHex(h: number, s: number, v: number): string {
  const { r, g, b } = hsvToRgb(h, s, v);
  return rgbToHex(r, g, b);
}
