import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

const STORAGE_KEY = "ganbaruai-zoom";
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.0;
const ZOOM_STEP = 0.1;
const DEFAULT_ZOOM = 1.0;

function round(v: number): number {
  return Math.round(v * 10) / 10;
}

function clamp(v: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, round(v)));
}

function loadSavedZoom(): number {
  if (typeof localStorage === "undefined") return DEFAULT_ZOOM;
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return DEFAULT_ZOOM;
  const parsed = parseFloat(saved);
  if (Number.isNaN(parsed)) return DEFAULT_ZOOM;
  return clamp(parsed);
}

const initialZoom = loadSavedZoom();
let level = $state<number>(initialZoom);

// Apply zoom at module load so there's no flash of default zoom
if (initialZoom !== DEFAULT_ZOOM) {
  getCurrentWebviewWindow().setZoom(initialZoom);
}

function persist() {
  localStorage.setItem(STORAGE_KEY, String(level));
}

function applyZoom() {
  getCurrentWebviewWindow().setZoom(level);
}

export function getZoom() {
  return {
    get level() {
      return level;
    },
    zoomIn() {
      level = clamp(level + ZOOM_STEP);
      persist();
      applyZoom();
    },
    zoomOut() {
      level = clamp(level - ZOOM_STEP);
      persist();
      applyZoom();
    },
    reset() {
      level = DEFAULT_ZOOM;
      persist();
      applyZoom();
    },
    /** Re-assert the current zoom level (counteracts external zoom changes). */
    reapply() {
      applyZoom();
    },
  };
}
