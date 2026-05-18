export type TooltipPlacement = "top" | "bottom";

export interface TooltipRect {
  left: number;
  top: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

export interface TooltipViewport {
  width: number;
  height: number;
}

export interface TooltipPositionOptions {
  gap?: number;
  margin?: number;
  arrowInset?: number;
}

export interface TooltipPosition {
  left: number;
  top: number;
  arrowLeft: number;
  placement: TooltipPlacement;
}

export interface CssRgbColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface TooltipPaletteTokens {
  background?: string;
  foreground?: string;
  popover?: string;
  popoverForeground?: string;
}

export interface TooltipPalette {
  background: string;
  foreground: string;
  border: string;
  shadow: string;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function roundPx(value: number): number {
  return Math.round(value * 100) / 100;
}

function parseHexColor(value: string): CssRgbColor | null {
  const hex = value.slice(1);
  if (![3, 4, 6, 8].includes(hex.length)) return null;

  const parts = hex.length <= 4
    ? hex.split("").map((part) => `${part}${part}`)
    : [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6), hex.slice(6, 8)].filter(Boolean);
  const channels = parts.map((part) => Number.parseInt(part, 16));
  if (channels.some((channel) => Number.isNaN(channel))) return null;

  return {
    r: channels[0] ?? 0,
    g: channels[1] ?? 0,
    b: channels[2] ?? 0,
    a: channels[3] === undefined ? 1 : clamp(channels[3] / 255, 0, 1),
  };
}

function splitColorParts(value: string): { channels: string[]; alpha?: string } {
  if (value.includes(",")) {
    const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
    return { channels: parts.slice(0, 3), alpha: parts[3] };
  }

  const [channelPart, alphaPart] = value.split("/", 2);
  return {
    channels: channelPart.trim().split(/\s+/).filter(Boolean),
    alpha: alphaPart?.trim(),
  };
}

function parseRgbChannel(value: string): number | null {
  if (value.endsWith("%")) {
    const parsed = Number.parseFloat(value.slice(0, -1));
    return Number.isFinite(parsed) ? clamp((parsed / 100) * 255, 0, 255) : null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? clamp(parsed, 0, 255) : null;
}

function parseSrgbChannel(value: string): number | null {
  if (value.endsWith("%")) {
    const parsed = Number.parseFloat(value.slice(0, -1));
    return Number.isFinite(parsed) ? clamp((parsed / 100) * 255, 0, 255) : null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? clamp(parsed * 255, 0, 255) : null;
}

function parseAlpha(value: string | undefined): number | null {
  if (value === undefined) return 1;
  if (value.endsWith("%")) {
    const parsed = Number.parseFloat(value.slice(0, -1));
    return Number.isFinite(parsed) ? clamp(parsed / 100, 0, 1) : null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? clamp(parsed, 0, 1) : null;
}

function parseRgbFunction(value: string): CssRgbColor | null {
  const match = value.match(/^rgba?\((.*)\)$/i);
  if (!match) return null;

  const parts = splitColorParts(match[1] ?? "");
  if (parts.channels.length !== 3) return null;
  const channels = parts.channels.map(parseRgbChannel);
  const alpha = parseAlpha(parts.alpha);
  if (channels.some((channel) => channel === null) || alpha === null) return null;

  return {
    r: channels[0] ?? 0,
    g: channels[1] ?? 0,
    b: channels[2] ?? 0,
    a: alpha,
  };
}

function parseSrgbFunction(value: string): CssRgbColor | null {
  const match = value.match(/^color\(\s*srgb\s+(.*)\)$/i);
  if (!match) return null;

  const parts = splitColorParts(match[1] ?? "");
  if (parts.channels.length !== 3) return null;
  const channels = parts.channels.map(parseSrgbChannel);
  const alpha = parseAlpha(parts.alpha);
  if (channels.some((channel) => channel === null) || alpha === null) return null;

  return {
    r: channels[0] ?? 0,
    g: channels[1] ?? 0,
    b: channels[2] ?? 0,
    a: alpha,
  };
}

export function parseCssColor(value: string | undefined): CssRgbColor | null {
  const color = value?.trim();
  if (!color || color === "transparent") return null;
  if (color.startsWith("#")) return parseHexColor(color);
  return parseRgbFunction(color) ?? parseSrgbFunction(color);
}

export function isVisibleCssColor(value: string | undefined): boolean {
  const color = parseCssColor(value);
  return color !== null && color.a > 0.02;
}

function channelToLinear(value: number): number {
  const channel = clamp(value, 0, 255) / 255;
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(color: CssRgbColor): number {
  return 0.2126 * channelToLinear(color.r)
    + 0.7152 * channelToLinear(color.g)
    + 0.0722 * channelToLinear(color.b);
}

function contrastRatio(a: CssRgbColor, b: CssRgbColor): number {
  const lighter = Math.max(relativeLuminance(a), relativeLuminance(b));
  const darker = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

function formatCssColor(color: CssRgbColor): string {
  const r = Math.round(clamp(color.r, 0, 255));
  const g = Math.round(clamp(color.g, 0, 255));
  const b = Math.round(clamp(color.b, 0, 255));
  if (color.a < 1) return `rgba(${r}, ${g}, ${b}, ${roundPx(clamp(color.a, 0, 1))})`;
  return `rgb(${r}, ${g}, ${b})`;
}

function candidatesFrom(values: Array<string | undefined>): CssRgbColor[] {
  return values
    .map(parseCssColor)
    .filter((color): color is CssRgbColor => color !== null && color.a > 0.02);
}

function pickLightest(candidates: CssRgbColor[], fallback: CssRgbColor): CssRgbColor {
  return candidates.reduce(
    (lightest, candidate) =>
      relativeLuminance(candidate) > relativeLuminance(lightest) ? candidate : lightest,
    fallback,
  );
}

function pickDarkest(candidates: CssRgbColor[], fallback: CssRgbColor): CssRgbColor {
  return candidates.reduce(
    (darkest, candidate) =>
      relativeLuminance(candidate) < relativeLuminance(darkest) ? candidate : darkest,
    fallback,
  );
}

function pickReadableText(background: CssRgbColor, candidates: CssRgbColor[]): CssRgbColor {
  const black = parseCssColor("#111111")!;
  const white = parseCssColor("#FFFFFF")!;
  const readableCandidates = [...candidates, black, white];
  return readableCandidates.reduce((best, candidate) =>
    contrastRatio(background, candidate) > contrastRatio(background, best) ? candidate : best,
  );
}

export function deriveTooltipPalette(
  surfaceColor: string | undefined,
  tokens: TooltipPaletteTokens = {},
): TooltipPalette {
  const fallbackDark = parseCssColor("#202020")!;
  const fallbackLight = parseCssColor("#FFFFFF")!;
  const surface = parseCssColor(surfaceColor)
    ?? parseCssColor(tokens.background)
    ?? parseCssColor(tokens.popover)
    ?? fallbackDark;
  const surfaceIsLight = relativeLuminance(surface) > 0.52;
  const tokenCandidates = candidatesFrom([
    tokens.background,
    tokens.foreground,
    tokens.popover,
    tokens.popoverForeground,
  ]);
  const background = surfaceIsLight
    ? pickDarkest(candidatesFrom([tokens.foreground, tokens.popoverForeground]), fallbackDark)
    : pickLightest(tokenCandidates, fallbackLight);
  const foreground = pickReadableText(background, tokenCandidates);
  const tooltipIsLight = relativeLuminance(background) > 0.52;

  return {
    background: formatCssColor(background),
    foreground: formatCssColor(foreground),
    border: tooltipIsLight ? "rgba(0, 0, 0, 0.18)" : "rgba(255, 255, 255, 0.2)",
    shadow: tooltipIsLight ? "0 8px 28px rgba(0, 0, 0, 0.22)" : "0 8px 28px rgba(0, 0, 0, 0.35)",
  };
}

/**
 * Calculates a stable tooltip position from the target element, not the
 * pointer position. The arrow still points at the target center after the
 * bubble is clamped inside the viewport.
 */
export function calculateTooltipPosition(
  anchor: TooltipRect,
  tooltip: TooltipRect,
  viewport: TooltipViewport,
  options: TooltipPositionOptions = {},
): TooltipPosition {
  const gap = options.gap ?? 10;
  const margin = options.margin ?? 8;
  const arrowInset = options.arrowInset ?? 12;
  const viewportWidth = Math.max(0, viewport.width);
  const viewportHeight = Math.max(0, viewport.height);
  const anchorCenter = anchor.left + anchor.width / 2;
  const leftMax = Math.max(margin, viewportWidth - margin - tooltip.width);
  const left = clamp(anchorCenter - tooltip.width / 2, margin, leftMax);
  const topSpace = anchor.top - margin;
  const bottomSpace = viewportHeight - anchor.bottom - margin;
  const placement: TooltipPlacement =
    topSpace >= tooltip.height + gap || topSpace >= bottomSpace ? "top" : "bottom";
  const preferredTop = placement === "top"
    ? anchor.top - gap - tooltip.height
    : anchor.bottom + gap;
  const topMax = Math.max(margin, viewportHeight - margin - tooltip.height);
  const top = clamp(preferredTop, margin, topMax);
  const arrowMax = Math.max(arrowInset, tooltip.width - arrowInset);
  const arrowLeft = clamp(anchorCenter - left, arrowInset, arrowMax);

  return {
    left: roundPx(left),
    top: roundPx(top),
    arrowLeft: roundPx(arrowLeft),
    placement,
  };
}
