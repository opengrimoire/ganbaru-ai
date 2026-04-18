const STORAGE_KEY = "ganbaruai-calendar-zoom";
const ZOOM_LEVELS = [30, 45, 67, 100, 150, 200];
const DEFAULT_INDEX = 2; // 67px
const ANIM_DURATION = 150; // ms for smooth zoom animation
const WHEEL_COOLDOWN = 120; // ms between wheel-triggered zoom steps

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

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

let levelIndex = findClosestIndex(loadSaved());
let hourHeight = $state(ZOOM_LEVELS[levelIndex]);

// Zoom state
let scrollRef: HTMLElement | null = null;
let stickyH = 0;
let zoomRaf = 0;
let gestureActive = false;
let commitTimer = 0;
let lastWheelZoom = 0;

// Animation state
let animating = false;
let animStartTime = 0;
let animFromH = 0;
let animToH = 0;
let animFromScroll = 0;
let animToScroll = 0;

function computeScrollForH(
  h: number,
  centerMinute: number,
  viewportH: number,
): number {
  const centerOffset = (viewportH - stickyH) / 2;
  const newScrollTop = (centerMinute / 60) * h - centerOffset;
  const maxScroll = Math.max(0, 24 * h - viewportH);
  return Math.max(0, Math.min(newScrollTop, maxScroll));
}

function animateTick() {
  const sc = scrollRef;
  if (!sc) {
    zoomRaf = 0;
    animating = false;
    return;
  }

  const elapsed = performance.now() - animStartTime;
  const t = Math.min(1, elapsed / ANIM_DURATION);
  const eased = easeOutCubic(t);

  const currentH = animFromH + (animToH - animFromH) * eased;
  const currentScroll = animFromScroll + (animToScroll - animFromScroll) * eased;

  sc.style.setProperty("--hour-h", String(currentH));
  sc.scrollTop = currentScroll;

  if (t < 1) {
    zoomRaf = requestAnimationFrame(animateTick);
  } else {
    zoomRaf = 0;
    animating = false;
  }
}

function startOrRetargetAnimation(toH: number) {
  const sc = scrollRef;
  if (!sc) return;

  const viewportH = sc.clientHeight;
  const centerOffset = (viewportH - stickyH) / 2;

  // Get current state (either mid-animation or static)
  const currentHStr = sc.style.getPropertyValue("--hour-h");
  const fromH = currentHStr ? parseFloat(currentHStr) : ZOOM_LEVELS[levelIndex];
  const fromScroll = sc.scrollTop;

  // Compute center time at current state
  const centerMinute = (fromScroll + centerOffset) / fromH * 60;

  // Compute target scroll for target H
  const toScroll = computeScrollForH(toH, centerMinute, viewportH);

  // Start animation
  animFromH = fromH;
  animToH = toH;
  animFromScroll = fromScroll;
  animToScroll = toScroll;
  animStartTime = performance.now();
  animating = true;

  if (!zoomRaf) {
    zoomRaf = requestAnimationFrame(animateTick);
  }
}

function commitZoom() {
  commitTimer = 0;

  // If still animating, wait for it to finish
  if (animating) {
    commitTimer = window.setTimeout(commitZoom, 30);
    return;
  }

  gestureActive = false;
  const sc = scrollRef;
  const finalH = ZOOM_LEVELS[levelIndex];

  // Ensure final state is exact
  if (sc) {
    sc.style.setProperty("--hour-h", String(finalH));
  }

  // Update Svelte state (triggers reactivity)
  hourHeight = finalH;

  // Dispatch custom event for components that need to update after zoom
  if (sc) {
    sc.dispatchEvent(new CustomEvent("zoomcommit", { bubbles: true }));
  }
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
      return gestureActive || animating;
    },
    /** Register scroll container so buttons/keyboard can animate. */
    registerScrollContainer(container: HTMLElement, stickyHeight: number) {
      scrollRef = container;
      stickyH = stickyHeight;
    },
    /** Ctrl+Scroll handler: triggers zoomStep with a short cooldown. */
    zoomAt(deltaY: number, stickyHeight: number, scrollContainer: HTMLElement) {
      const now = performance.now();
      if (now - lastWheelZoom < WHEEL_COOLDOWN) return;
      lastWheelZoom = now;

      // Capture scroll container reference
      if (!scrollRef) {
        scrollRef = scrollContainer;
        stickyH = stickyHeight;
      }

      const direction = deltaY > 0 ? -1 : 1;
      this.zoomStep(direction);
    },
    reset() {
      if (zoomRaf) {
        cancelAnimationFrame(zoomRaf);
        zoomRaf = 0;
      }
      clearTimeout(commitTimer);
      commitTimer = 0;
      gestureActive = false;
      animating = false;
      lastWheelZoom = 0;
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
    get isDefault() {
      return hourHeight === ZOOM_LEVELS[DEFAULT_INDEX];
    },
    /** Percent relative to the default hour height. Default row = 100%. */
    get zoomPercent() {
      return Math.round((hourHeight / ZOOM_LEVELS[DEFAULT_INDEX]) * 100);
    },
    /** Zoom one level with smooth animation. */
    zoomStep(direction: 1 | -1) {
      const targetIndex = Math.max(
        0,
        Math.min(ZOOM_LEVELS.length - 1, levelIndex + direction),
      );
      if (targetIndex === levelIndex) return;

      levelIndex = targetIndex;
      const newH = ZOOM_LEVELS[targetIndex];
      persist(newH);

      if (scrollRef) {
        gestureActive = true;
        startOrRetargetAnimation(newH);
        clearTimeout(commitTimer);
        commitTimer = window.setTimeout(commitZoom, ANIM_DURATION + 50);
      } else {
        hourHeight = newH;
      }
    },
  };
}
