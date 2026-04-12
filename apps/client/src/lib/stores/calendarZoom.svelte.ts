const STORAGE_KEY = "ganbaruai-calendar-zoom";
const ZOOM_LEVELS = [30, 45, 67, 100, 150, 200];
const DEFAULT_INDEX = 2; // 67px
const COMMIT_DELAY = 150; // ms after last wheel event to commit reactive state
const STEP_COOLDOWN = 150; // ms between zoom level changes (prevents multi-level jumps per frame)

function findClosestIndex(height: number): number {
  let best = 0;
  let bestDist = Math.abs(ZOOM_LEVELS[0] - height);
  for (let i = 1; i < ZOOM_LEVELS.length; i++) {
    const dist = Math.abs(ZOOM_LEVELS[i] - height);
    if (dist < bestDist) {
      best = i;
      bestDist = dist;
    }
  }
  return best;
}

function loadSaved(): number {
  if (typeof localStorage === "undefined") return ZOOM_LEVELS[DEFAULT_INDEX];
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return ZOOM_LEVELS[DEFAULT_INDEX];
  const parsed = parseFloat(saved);
  if (Number.isNaN(parsed)) return ZOOM_LEVELS[DEFAULT_INDEX];
  return parsed;
}

function deriveGridMinutes(h: number): number {
  if (h >= 120) return 5;
  if (h >= 60) return 10;
  if (h >= 40) return 15;
  return 30;
}

let levelIndex = findClosestIndex(loadSaved());
let hourHeight = $state(ZOOM_LEVELS[levelIndex]);

// --- Zoom gesture state ---
//
// During Ctrl+Scroll zoom, we batch updates via rAF. Each frame:
// 1. Read old --hour-h and scrollTop to compute center time
// 2. Set new --hour-h
// 3. Adjust scrollTop to keep center time stable
//
// This matches what button-driven zoom does (via the $effect in views),
// but batched for wheel events. No transforms needed.
let scrollRef: HTMLElement | null = null;
let stickyH = 0;
let pendingH = 0;
let zoomRaf = 0;
let gestureActive = false;
let commitTimer = 0;
let lastStepTime = 0;

function applyZoom() {
  zoomRaf = 0;
  const sc = scrollRef;
  if (!sc) return;

  // Read current state
  const oldHStr = sc.style.getPropertyValue("--hour-h");
  const oldH = oldHStr ? parseFloat(oldHStr) : pendingH;
  const viewportH = sc.clientHeight;
  const centerOffset = (viewportH - stickyH) / 2;

  // Compute center time at old zoom level
  const centerMinute = (sc.scrollTop + centerOffset) / oldH * 60;

  // Apply new zoom
  sc.style.setProperty("--hour-h", String(pendingH));

  // Adjust scrollTop to keep center time stable
  const newScrollTop = (centerMinute / 60) * pendingH - centerOffset;
  const maxScroll = Math.max(0, 24 * pendingH - viewportH);
  sc.scrollTop = Math.max(0, Math.min(newScrollTop, maxScroll));
}

function commitZoom() {
  commitTimer = 0;
  gestureActive = false;
  const sc = scrollRef;

  // Ensure --hour-h is exact (redundant but safe)
  if (sc) sc.style.setProperty("--hour-h", String(pendingH));

  // Update Svelte state (triggers reactivity for thresholds like blockPixelHeight)
  hourHeight = pendingH;
}

function persist(h: number) {
  localStorage.setItem(STORAGE_KEY, String(h));
}

export function getCalendarZoom() {
  return {
    get hourHeight() {
      return hourHeight;
    },
    get gridMinutes() {
      return deriveGridMinutes(hourHeight);
    },
    get isAnimating() {
      return gestureActive;
    },
    /** Snap to the next/previous zoom level. Anchor is the vertical center of the visible time grid. */
    zoomAt(deltaY: number, stickyHeight: number, scrollContainer: HTMLElement) {
      const direction = deltaY > 0 ? -1 : 1;
      const targetIndex = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, levelIndex + direction));
      if (targetIndex === levelIndex) return;

      // Enforce minimum interval between level changes so each step gets
      // its own paint frame. Without this, fast scrolling batches multiple
      // level jumps into one rAF, causing a large layout flash.
      const now = performance.now();
      if (gestureActive && now - lastStepTime < STEP_COOLDOWN) {
        // Still reset commit timer so the gesture stays alive
        clearTimeout(commitTimer);
        commitTimer = window.setTimeout(commitZoom, COMMIT_DELAY);
        return;
      }
      lastStepTime = now;

      // Capture refs on first event of the gesture
      if (!gestureActive) {
        scrollRef = scrollContainer;
        stickyH = stickyHeight;
        gestureActive = true;
      }

      levelIndex = targetIndex;
      pendingH = ZOOM_LEVELS[targetIndex];

      if (!zoomRaf) {
        zoomRaf = requestAnimationFrame(applyZoom);
      }

      clearTimeout(commitTimer);
      commitTimer = window.setTimeout(commitZoom, COMMIT_DELAY);
      persist(pendingH);
    },
    reset() {
      if (zoomRaf) {
        cancelAnimationFrame(zoomRaf);
        zoomRaf = 0;
      }
      clearTimeout(commitTimer);
      commitTimer = 0;
      gestureActive = false;
      levelIndex = DEFAULT_INDEX;
      hourHeight = ZOOM_LEVELS[DEFAULT_INDEX];
      if (scrollRef) {
        scrollRef.style.setProperty("--hour-h", String(ZOOM_LEVELS[DEFAULT_INDEX]));
      }
      persist(ZOOM_LEVELS[DEFAULT_INDEX]);
    },
    get canZoomIn() {
      return hourHeight < ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
    },
    get canZoomOut() {
      return hourHeight > ZOOM_LEVELS[0];
    },
    /** Button-driven zoom: no transform dance, just update the level instantly. */
    zoomStep(direction: 1 | -1) {
      const targetIndex = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, levelIndex + direction));
      if (targetIndex === levelIndex) return;
      levelIndex = targetIndex;
      const newH = ZOOM_LEVELS[targetIndex];
      hourHeight = newH;
      persist(newH);
    },
  };
}
