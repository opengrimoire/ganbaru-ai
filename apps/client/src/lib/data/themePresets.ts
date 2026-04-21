/**
 * Curated theme presets surfaced by the "New theme" picker.
 *
 * Each preset is a full set of sources (the seven colors that feed
 * `deriveAppTokens` / `deriveCalendarTokens`) plus a base mode. A user that
 * picks a preset starts from a palette pre-validated to meet AA contrast
 * across every derived foreground / border / gridline: see
 * `themePresets.test.ts`, which fails the build if a preset regresses.
 *
 * Keep the list short and distinctive. Six cards map to a 2x3 grid in the
 * picker; a seventh "Start blank" affordance keeps the original empty-start
 * path available for users who want to build from scratch.
 */

import type { ThemeSources } from "$lib/stores/themes";

export type ThemePreset = {
  id: string;
  displayName: string;
  base: "light" | "dark";
  description: string;
  sources: ThemeSources;
};

export const THEME_PRESETS: readonly ThemePreset[] = [
  {
    id: "sunrise",
    displayName: "Sunrise",
    base: "light",
    description: "Warm light canvas with a confident blue primary.",
    sources: {
      canvas: "#FAF7F2",
      ink: "#1F1B16",
      primary: "#2563EB",
      destructive: "#B42318",
      confirm: "#047857",
      warning: "#B45309",
      calCanvas: "#FFFFFF",
    },
  },
  {
    id: "graphite",
    displayName: "Graphite",
    base: "dark",
    description: "Neutral dark slate, soft accents, easy on the eyes.",
    sources: {
      canvas: "#1B1C1F",
      ink: "#E9EAEE",
      primary: "#90A5FF",
      destructive: "#F06060",
      confirm: "#44C48A",
      warning: "#F5B143",
      calCanvas: "#0E0F11",
    },
  },
  {
    id: "sepia",
    displayName: "Sepia",
    base: "light",
    description: "Warm reading paper with muted earth accents.",
    sources: {
      canvas: "#F4E9D3",
      ink: "#3A2A17",
      primary: "#7A4D1F",
      destructive: "#922D18",
      confirm: "#5A6B1C",
      warning: "#B07410",
      calCanvas: "#FBF3E0",
    },
  },
  {
    id: "nordic",
    displayName: "Nordic",
    base: "light",
    description: "Cool light tones inspired by the Nord palette.",
    sources: {
      canvas: "#ECEFF4",
      ink: "#2E3440",
      primary: "#5E81AC",
      destructive: "#BF616A",
      confirm: "#6A8B5C",
      warning: "#B58F3C",
      calCanvas: "#FFFFFF",
    },
  },
  {
    id: "contrast-dark",
    displayName: "High-contrast Dark",
    base: "dark",
    description: "Pure black canvas with saturated accents.",
    sources: {
      canvas: "#000000",
      ink: "#FFFFFF",
      primary: "#8AB4F8",
      destructive: "#FF6B6B",
      confirm: "#3BD482",
      warning: "#FFD666",
      calCanvas: "#0A0A0A",
    },
  },
  {
    id: "lavender",
    displayName: "Lavender Pastel",
    base: "light",
    description: "Soft lavender canvas with playful purple primary.",
    sources: {
      canvas: "#F7F4FC",
      ink: "#2A1F4A",
      primary: "#7C5AC7",
      destructive: "#C24567",
      confirm: "#4F8365",
      warning: "#AC7330",
      calCanvas: "#FFFFFF",
    },
  },
];
