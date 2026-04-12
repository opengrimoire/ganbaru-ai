const STORAGE_KEY = "ganbaruai-calendar-zoom";
const ZOOM_LEVELS = [30, 45, 67, 100, 150, 200];
const DEFAULT_INDEX = 2; // 67px
const COMMIT_DELAY = 180; // ms after last wheel event to commit reactive state
const STEP_COOLDOWN = 100; // ms between zoom level changes
const ANIM_DURATION = 150; // ms for smooth zoom animation

// Anti-flash protection for extremely fast scrolling
const REJECTION_WINDOW = 200; // ms window to count rejections
const REJECTION_THRESHOLD = 5; // rejections in window to trigger pause
const PAUSE_DURATION = 120; // ms pause when threshold hit
const POWER_SCROLL_THRESHOLD = 200; // deltaY magnitude indicating a power scroll

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

// Zoom gesture state
let scrollRef: HTMLElement | null = null;
let stickyH = 0;
let zoomRaf = 0;
let gestureActive = false;
let commitTimer = 0;
let lastStepTime = 0;

// Animation state
let animating = false;
let animStartTime = 0;
let animFromH = 0;
let animToH = 0;
let animFromScroll = 0;
let animToScroll = 0;

// Anti-flash: track rapid rejections
let rejectionCount = 0;
let rejectionWindowStart = 0;
let pausedUntil = 0;

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
    // Animation complete
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

/** Instant snap without animation (flash-free for power scrolls) */
function instantSnap(toH: number) {
  const sc = scrollRef;
  if (!sc) return;

  // Cancel any running animation
  if (zoomRaf) {
    cancelAnimationFrame(zoomRaf);
    zoomRaf = 0;
  }
  animating = false;

  const viewportH = sc.clientHeight;
  const centerOffset = (viewportH - stickyH) / 2;

  // Get current state
  const currentHStr = sc.style.getPropertyValue("--hour-h");
  const fromH = currentHStr ? parseFloat(currentHStr) : toH;
  const fromScroll = sc.scrollTop;

  // Compute center time at current state
  const centerMinute = (fromScroll + centerOffset) / fromH * 60;

  // Apply instantly
  sc.style.setProperty("--hour-h", String(toH));
  const newScroll = computeScrollForH(toH, centerMinute, viewportH);
  sc.scrollTop = newScroll;
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

  // Update Svelte state (triggers reactivity for thresholds)
  hourHeight = finalH;
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
    /** Snap to the next/previous zoom level with smooth animation. */
    zoomAt(deltaY: number, stickyHeight: number, scrollContainer: HTMLElement) {
      const direction = deltaY > 0 ? -1 : 1;
      const targetIndex = Math.max(
        0,
        Math.min(ZOOM_LEVELS.length - 1, levelIndex + direction),
      );
      if (targetIndex === levelIndex) return;

      const now = performance.now();

      // Check if we're in a forced pause (anti-flash for extreme speed)
      if (now < pausedUntil) {
        clearTimeout(commitTimer);
        commitTimer = window.setTimeout(commitZoom, COMMIT_DELAY);
        return;
      }

      // Enforce minimum interval between level changes
      if (gestureActive && now - lastStepTime < STEP_COOLDOWN) {
        // Track rejections to detect extremely fast scrolling
        if (now - rejectionWindowStart > REJECTION_WINDOW) {
          rejectionWindowStart = now;
          rejectionCount = 0;
        }
        rejectionCount++;

        // Too many rejections = user scrolling extremely fast, force a pause
        if (rejectionCount >= REJECTION_THRESHOLD) {
          pausedUntil = now + PAUSE_DURATION;
          rejectionCount = 0;
        }

        clearTimeout(commitTimer);
        commitTimer = window.setTimeout(commitZoom, COMMIT_DELAY);
        return;
      }
      lastStepTime = now;
      rejectionCount = 0; // Reset on successful step

      // Capture refs on first event of the gesture
      if (!gestureActive) {
        scrollRef = scrollContainer;
        stickyH = stickyHeight;
        gestureActive = true;
      }

      levelIndex = targetIndex;
      const targetH = ZOOM_LEVELS[targetIndex];

      // Power scroll detection: large deltaY = user scrolling very hard
      // Use instant snap for power scrolls to avoid animation-related flash
      const isPowerScroll = Math.abs(deltaY) > POWER_SCROLL_THRESHOLD;

      if (isPowerScroll) {
        instantSnap(targetH);
      } else {
        startOrRetargetAnimation(targetH);
      }

      clearTimeout(commitTimer);
      commitTimer = window.setTimeout(commitZoom, COMMIT_DELAY);
      persist(targetH);
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
      rejectionCount = 0;
      pausedUntil = 0;
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
    /** Button-driven zoom: animates if scroll container is known, else instant. */
    zoomStep(direction: 1 | -1) {
      const targetIndex = Math.max(
        0,
        Math.min(ZOOM_LEVELS.length - 1, levelIndex + direction),
      );
      if (targetIndex === levelIndex) return;

      levelIndex = targetIndex;
      const newH = ZOOM_LEVELS[targetIndex];
      persist(newH);

      // If we have a scroll reference (from a previous Ctrl+Scroll), animate
      if (scrollRef) {
        gestureActive = true;
        startOrRetargetAnimation(newH);
        clearTimeout(commitTimer);
        commitTimer = window.setTimeout(commitZoom, COMMIT_DELAY);
      } else {
        // No scroll ref yet, instant update (let $effect in views handle DOM)
        hourHeight = newH;
      }
    },
  };
}
