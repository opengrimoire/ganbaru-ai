import {
  classifyViewport,
  isSizeClassAtLeast,
  type ViewportSizeClass,
} from "$lib/utils/responsive";

const DEFAULT_WIDTH = 1200;
const DEFAULT_HEIGHT = 800;

let width = $state(DEFAULT_WIDTH);
let height = $state(DEFAULT_HEIGHT);
let initialized = false;

const sizeClass = $derived(classifyViewport(width, height));
const isShort = $derived(height < 480);
const canShowDenseChrome = $derived(isSizeClassAtLeast(sizeClass, "regular") && !isShort);

function readViewport(): { width: number; height: number } {
  if (typeof window === "undefined") {
    return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
  }
  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

function refreshViewport(): void {
  const next = readViewport();
  width = next.width;
  height = next.height;
}

function initializeViewportTracking(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  refreshViewport();

  let rafId = 0;
  const onResize = () => {
    if (rafId !== 0) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      refreshViewport();
    });
  };

  window.addEventListener("resize", onResize);
}

export function getViewport() {
  initializeViewportTracking();
  return {
    get width(): number {
      return width;
    },
    get height(): number {
      return height;
    },
    get sizeClass(): ViewportSizeClass {
      return sizeClass;
    },
    get isShort(): boolean {
      return isShort;
    },
    get canShowDenseChrome(): boolean {
      return canShowDenseChrome;
    },
    atLeast(minimum: ViewportSizeClass): boolean {
      return isSizeClassAtLeast(sizeClass, minimum);
    },
    below(minimum: ViewportSizeClass): boolean {
      return !isSizeClassAtLeast(sizeClass, minimum);
    },
  };
}
