const STORAGE_KEY = "ganbaruai-calendar-zoom";
const ZOOM_LEVELS = [30, 45, 67, 100, 150, 200];
const DEFAULT_INDEX = 2; // 67px
const GESTURE_QUIET = 500; // ms of silence before accepting the next gesture
const ANIM_DURATION = 300; // ms

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

function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

let levelIndex = findClosestIndex(loadSaved());
let hourHeight = $state(ZOOM_LEVELS[levelIndex]);
let liveHeight = ZOOM_LEVELS[levelIndex];

let locked = false;
let gestureTimer = 0;
let frozenContainer: HTMLElement | null = null;

// Animation state
let animRaf = 0;
let animStart = 0;
let animFrom = 0;
let animTo = 0;
let animVY = 0;
let animSH = 0;
let animInitScrollTop = 0;
let animInitHeight = 0;

function persist() {
  localStorage.setItem(STORAGE_KEY, String(hourHeight));
}

function animTick(now: number) {
  const sc = frozenContainer;
  if (!sc) { animRaf = 0; return; }

  const t = Math.min(1, (now - animStart) / ANIM_DURATION);
  const eased = easeOut(t);
  const newH = Math.round(animFrom + (animTo - animFrom) * eased);

  if (newH !== liveHeight) {
    const scale = newH / animInitHeight;
    const contentY = animInitScrollTop + animVY;
    const timeContentY = Math.max(0, contentY - animSH);
    sc.scrollTop = animSH + timeContentY * scale - animVY;
    sc.style.setProperty("--hour-h", String(newH));
    liveHeight = newH;
  }

  if (t < 1) {
    animRaf = requestAnimationFrame(animTick);
  } else {
    animRaf = 0;
    liveHeight = animTo;
  }
}

function commitState() {
  gestureTimer = 0;
  locked = false;
  hourHeight = ZOOM_LEVELS[levelIndex];
  persist();
  if (frozenContainer) {
    const sc = frozenContainer;
    frozenContainer = null;
    requestAnimationFrame(() => {
      if (frozenContainer) return;
      sc.style.overflowY = "";
    });
  }
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
      return gestureTimer !== 0;
    },
    /** Step to the next/previous zoom level, once per scroll gesture. */
    zoomAt(deltaY: number, viewportY: number, stickyHeight: number, scrollContainer: HTMLElement) {
      clearTimeout(gestureTimer);
      // Wait for both the gesture to settle AND the animation to finish
      const commitDelay = Math.max(GESTURE_QUIET, ANIM_DURATION + 50);
      gestureTimer = window.setTimeout(commitState, commitDelay);

      if (locked) return;
      locked = true;

      const direction = deltaY > 0 ? -1 : 1;
      const targetIndex = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, levelIndex + direction));
      if (targetIndex === levelIndex) return;

      levelIndex = targetIndex;

      // Freeze the container so the compositor cannot scroll it
      scrollContainer.style.overflowY = "hidden";
      frozenContainer = scrollContainer;

      // Capture state for scroll-position preservation across frames
      animInitScrollTop = scrollContainer.scrollTop;
      animInitHeight = liveHeight;
      animFrom = liveHeight;
      animTo = ZOOM_LEVELS[targetIndex];
      animStart = performance.now();
      animVY = viewportY;
      animSH = stickyHeight;

      if (!animRaf) {
        animRaf = requestAnimationFrame(animTick);
      }
    },
    reset() {
      if (animRaf) {
        cancelAnimationFrame(animRaf);
        animRaf = 0;
      }
      clearTimeout(gestureTimer);
      gestureTimer = 0;
      locked = false;
      if (frozenContainer) {
        frozenContainer.style.overflowY = "";
        frozenContainer = null;
      }
      levelIndex = DEFAULT_INDEX;
      liveHeight = ZOOM_LEVELS[DEFAULT_INDEX];
      hourHeight = ZOOM_LEVELS[DEFAULT_INDEX];
      persist();
    },
  };
}
